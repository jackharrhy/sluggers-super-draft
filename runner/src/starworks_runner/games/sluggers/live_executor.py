from __future__ import annotations

import time
from collections.abc import Callable
from pathlib import Path
from typing import Any

from starworks_runner.execution import BoundMatchExecution, bind_match_execution
from starworks_runner.games.sluggers.adapter import AdapterManifest
from starworks_runner.games.sluggers.bridge.configuration import (
    RuntimeConfigurationBlock,
)
from starworks_runner.games.sluggers.bridge.layout import (
    EventType,
    attempt_nonce_digest,
)
from starworks_runner.games.sluggers.builder import BuildRequest, GameBuildService
from starworks_runner.games.sluggers.checkpoint import SeedCheckpoint
from starworks_runner.games.sluggers.content import ContentPackInput
from starworks_runner.games.sluggers.errors import SluggersAdapterError
from starworks_runner.games.sluggers.fingerprints import SupportedBaseRegistry
from starworks_runner.games.sluggers.session import (
    LiveSluggersSession,
    RuntimeGameObservation,
    RuntimeLineupObservation,
    load_game_build_manifest,
)
from starworks_runner.games.sluggers.tools import DtkDiscTool
from starworks_runner.games.sluggers.tracker import (
    SluggersGameTracker,
    TrackerEvent,
    match_character_ids,
)
from starworks_runner.orchestrator import AttemptExecutionError, ExecutionOutcome


def resolve_managed_build(cache_root: Path, game_build_sha256: str) -> Path:
    """Resolve one immutable local build by its public game-build identity."""

    builds_root = cache_root.expanduser().resolve() / "builds"
    matches: list[Path] = []
    if builds_root.is_dir():
        for candidate in sorted(builds_root.iterdir()):
            if not candidate.is_dir():
                continue
            try:
                manifest = load_game_build_manifest(candidate)
            except SluggersAdapterError:
                continue
            if manifest["buildSha256"] == game_build_sha256:
                matches.append(candidate)
    if not matches:
        raise AttemptExecutionError(
            f"Required managed game build {game_build_sha256} is not in the local cache",
            "build-failure",
        )
    if len(matches) != 1:
        raise AttemptExecutionError(
            f"Required managed game build {game_build_sha256} is ambiguous in the local cache",
            "build-failure",
        )
    return matches[0]


def memory_tracker_telemetry(
    event: TrackerEvent,
    envelope: dict[str, Any],
    configuration: dict[str, Any],
) -> dict[str, Any]:
    return {
        "schemaVersion": 1,
        "kind": "telemetry-envelope",
        "protocolVersion": 1,
        "correlationId": envelope["correlationId"],
        "leagueId": envelope["leagueId"],
        "matchId": envelope["matchId"],
        "attemptId": envelope["attemptId"],
        "attemptNonce": envelope["attemptNonce"],
        "sequence": event.sequence,
        "frame": event.frame,
        "eventType": event.event_type,
        "observationSource": "memory-observation",
        "payload": event.payload,
        "adapterVersion": configuration["adapterVersion"],
        "gameBuildSha256": envelope["requiredGameBuildSha256"],
    }


class LiveSluggersExecutor:
    """Incrementally execute one web-leased attempt through a real Dolphin bridge.

    The executor completes only after a nonce-bound semantic game-ended event.
    """

    def __init__(
        self,
        *,
        cache_root: Path,
        dolphin_executable: Path,
        profile_root: Path,
        game_image: Path | None = None,
        dtk_executable: Path | None = None,
        checkpoint_manifest: Path | None = None,
        seed_profile_directory: Path | None = None,
        timeout_seconds: float = 10.0,
        adapter: AdapterManifest | None = None,
        session_factory: Callable[..., LiveSluggersSession] = LiveSluggersSession,
        sleep: Callable[[float], None] = time.sleep,
    ) -> None:
        self.cache_root = cache_root.expanduser().resolve()
        self.dolphin_executable = dolphin_executable.expanduser().resolve()
        self.profile_root = profile_root.expanduser().resolve()
        self.game_image = game_image.expanduser().resolve() if game_image else None
        self.dtk_executable = (
            dtk_executable.expanduser().resolve() if dtk_executable else None
        )
        if (checkpoint_manifest is None) != (seed_profile_directory is None):
            raise SluggersAdapterError(
                "Checkpoint manifest and seed profile must be configured together"
            )
        self.checkpoint_manifest = (
            checkpoint_manifest.expanduser().resolve()
            if checkpoint_manifest is not None
            else None
        )
        self.seed_profile_directory = (
            seed_profile_directory.expanduser().resolve()
            if seed_profile_directory is not None
            else None
        )
        self.timeout_seconds = timeout_seconds
        self.adapter = adapter or AdapterManifest.load()
        self.session_factory = session_factory
        self.sleep = sleep
        self.bound: BoundMatchExecution | None = None
        self.runtime_configuration: RuntimeConfigurationBlock | None = None
        self.build_directory: Path | None = None
        self.session: LiveSluggersSession | None = None
        self.recovery_state: dict[str, Any] | None = None
        self.content_pack: ContentPackInput | None = None
        self.checkpoint: SeedCheckpoint | None = None
        self.tracker: SluggersGameTracker | None = None
        self.live_stage = "not-started"

    def supply_content_pack(self, content_pack: ContentPackInput | None) -> None:
        self.content_pack = content_pack

    def restore_runtime(self, metadata: dict[str, Any]) -> None:
        self.recovery_state = dict(metadata)
        live_stage = metadata.get("liveStage")
        if live_stage not in {
            "bridge-active",
            "configured",
            "stadium-confirmed",
            "captains-confirmed",
            "cpu-level-confirmed",
            "lineups-applied",
            "rules-confirmed",
            "running-unverified",
            "running",
        }:
            raise AttemptExecutionError(
                "Saved Dolphin recovery stage is invalid", "runner-crash"
            )
        self.live_stage = live_stage

    def runtime_metadata(self) -> dict[str, Any] | None:
        if self.session is None or self.session.process_id is None:
            return None
        if self.bound is None or self.build_directory is None:
            raise AttemptExecutionError(
                "Live session has no immutable match binding", "runner-crash"
            )
        identity = self.session.process_identity_sha256
        if identity is None:
            raise AttemptExecutionError(
                "Live Dolphin process has no recovery identity", "runner-crash"
            )
        envelope = self.bound.envelope
        return {
            "kind": "sluggers-live-session",
            "liveStage": self.live_stage,
            "adapterBuildSha256": self.adapter.adapter_build_sha256,
            "attemptId": envelope["attemptId"],
            "attemptNonceDigest": attempt_nonce_digest(envelope["attemptNonce"]).hex(),
            "buildDirectory": str(self.build_directory),
            "gameBuildSha256": envelope["requiredGameBuildSha256"],
            "memoryTransport": "dme",
            "processId": self.session.process_id,
            "processIdentitySha256": identity,
            "profileDirectory": str(self.profile_root / envelope["attemptId"]),
            "tracker": self.tracker.state() if self.tracker is not None else None,
        }

    def prepare(self, envelope: dict[str, Any], configuration: dict[str, Any]) -> None:
        try:
            bound = bind_match_execution(envelope, configuration)
            if configuration["adapterVersion"] != self.adapter.adapter_version:
                raise AttemptExecutionError(
                    "Match configuration requires a different Sluggers adapter version",
                    "build-failure",
                )
            build_directory = self._resolve_or_build(bound)
            manifest = load_game_build_manifest(build_directory)
            if manifest["adapterVersion"] != self.adapter.adapter_version:
                raise AttemptExecutionError(
                    "Managed game build uses a different Sluggers adapter version",
                    "build-failure",
                )
            if manifest["adapterBuildSha256"] != self.adapter.adapter_build_sha256:
                raise AttemptExecutionError(
                    "Managed game build uses different Sluggers adapter code",
                    "build-failure",
                )
            checkpoint = None
            if self.checkpoint_manifest is not None:
                assert self.seed_profile_directory is not None
                main_dol = next(
                    output
                    for output in manifest["outputs"]
                    if output["path"] == "sys/main.dol"
                )
                checkpoint = SeedCheckpoint.load(
                    self.checkpoint_manifest,
                    seed_profile_directory=self.seed_profile_directory,
                    expected_dolphin_version="2606",
                    expected_adapter_build_sha256=self.adapter.adapter_build_sha256,
                    expected_game_build_sha256=manifest["buildSha256"],
                    expected_main_dol_sha256=main_dol["sha256"],
                )
            runtime_configuration = RuntimeConfigurationBlock.from_operation_bundles(
                bound.compiled.home,
                bound.compiled.away,
                execution=configuration["execution"],
            )
            team_ids = {
                team["side"]: team["lineup"]["teamId"]
                for team in configuration["teams"]
            }
            tracker = SluggersGameTracker(
                away_team_id=team_ids["away"],
                home_team_id=team_ids["home"],
                character_ids=match_character_ids(configuration),
            )
            if self.recovery_state is not None:
                tracker_state = self.recovery_state.get("tracker")
                if tracker_state is not None:
                    if not isinstance(tracker_state, dict):
                        raise AttemptExecutionError(
                            "Saved game tracker state is invalid", "runner-crash"
                        )
                    tracker.restore(tracker_state)
        except AttemptExecutionError:
            raise
        except Exception as error:
            raise AttemptExecutionError(
                f"Match cannot be prepared for Sluggers: {error}", "build-failure"
            ) from error
        self.bound = bound
        self.build_directory = build_directory
        self.runtime_configuration = runtime_configuration
        self.checkpoint = checkpoint
        self.tracker = tracker

    def _resolve_or_build(self, bound: BoundMatchExecution) -> Path:
        required_build = bound.envelope["requiredGameBuildSha256"]
        try:
            return resolve_managed_build(self.cache_root, required_build)
        except AttemptExecutionError as error:
            if "not in the local cache" not in str(error):
                raise
        if self.game_image is None or self.dtk_executable is None:
            raise AttemptExecutionError(
                f"Required managed game build {required_build} is not in the local "
                "cache and this station has no game image/decomp-toolkit build inputs",
                "build-failure",
            )
        content_pack = self.content_pack or self._attempt_profile_content(bound)
        result = GameBuildService(
            DtkDiscTool(self.dtk_executable),
            SupportedBaseRegistry.load(),
            trusted_patch_set=self.adapter.trusted_patch_set(),
        ).build(
            BuildRequest(
                image_path=self.game_image,
                cache_root=self.cache_root,
                adapter_build_sha256=self.adapter.adapter_build_sha256,
                content_pack=content_pack,
                adapter_version=self.adapter.adapter_version,
                compiler_version="22.1.8",
            )
        )
        if result.manifest["buildSha256"] != required_build:
            raise AttemptExecutionError(
                "The deterministic local build does not match the immutable build "
                f"requested by the attempt: built {result.manifest['buildSha256']}, "
                f"required {required_build}",
                "build-failure",
            )
        return result.build_directory

    def _attempt_profile_content(self, bound: BoundMatchExecution) -> ContentPackInput:
        profile = bound.configuration["statProfile"]
        ruleset = bound.configuration["ruleset"]
        return ContentPackInput(
            manifest={
                "schemaVersion": 1,
                "kind": "content-pack-manifest",
                "contentPackId": profile["profileId"],
                "revisionId": profile["revisionId"],
                "targetGame": {
                    "gameId": "RMBE01",
                    "supportedRevisions": [
                        {
                            "region": "NTSC-U",
                            "revision": 0,
                            "mainDolSha256": "3018e262480ccbf0daa04fc96f1c3dfb340dc4007a13f007f9423751c1346151",
                        }
                    ],
                },
                "statProfileRevisionId": profile["revisionId"],
                "rulesetRevisionId": ruleset["revisionId"],
                "adapterVersion": self.adapter.adapter_version,
                "assets": [],
                "assignments": [
                    {
                        "assignmentType": "character-stats",
                        "characterId": assignment["characterId"],
                        "statProfileRevisionId": profile["revisionId"],
                    }
                    for assignment in profile["characterValues"]
                ],
                "createdAt": bound.configuration["generatedAt"],
            },
            operation_bundle=bound.compiled.home,
        )

    def execute(
        self,
        envelope: dict[str, Any],
        configuration: dict[str, Any],
        *,
        recovering: bool,
        emit_telemetry: Callable[[dict[str, Any]], None],
    ) -> ExecutionOutcome:
        bound = bind_match_execution(envelope, configuration)
        if self.bound is None:
            self.prepare(envelope, configuration)
        elif bound != self.bound:
            raise AttemptExecutionError(
                "Prepared match changed before live execution", "build-failure"
            )
        if self.session is None:
            if self.build_directory is None:
                raise AttemptExecutionError(
                    "Live Sluggers execution was not prepared", "runner-crash"
                )
            profile_directory = self.profile_root / envelope["attemptId"]
            initial_save_state = None
            if self.checkpoint is not None:
                try:
                    if recovering:
                        self.checkpoint.require_materialized_profile(profile_directory)
                    else:
                        self.checkpoint.materialize_profile(profile_directory)
                    initial_save_state = self.checkpoint.save_state_path
                except Exception as error:
                    raise AttemptExecutionError(
                        f"Dolphin seed checkpoint could not be prepared: {error}",
                        "build-failure",
                    ) from error
            self.session = self.session_factory(
                build_directory=self.build_directory,
                dolphin_executable=self.dolphin_executable,
                profile_directory=profile_directory,
                adapter_build_sha256=self.adapter.adapter_build_sha256,
                game_build_sha256=envelope["requiredGameBuildSha256"],
                initial_save_state=initial_save_state,
            )
            if recovering:
                try:
                    process_id, process_identity = self._require_recovery_state(
                        envelope
                    )
                    self.session.reattach(
                        envelope["attemptNonce"],
                        process_id=process_id,
                        expected_process_identity_sha256=process_identity,
                        timeout_seconds=self.timeout_seconds,
                    )
                    self.recovery_state = None
                except Exception as error:
                    self.stop()
                    raise AttemptExecutionError(
                        f"Live Dolphin session could not be reattached: {error}",
                        "runner-crash",
                    ) from error
            else:
                try:
                    self.session.start(
                        envelope["attemptNonce"],
                        timeout_seconds=self.timeout_seconds,
                    )
                    self.live_stage = "bridge-active"
                    if self.runtime_configuration is None:
                        raise AttemptExecutionError(
                            "Live Sluggers runtime configuration was not prepared",
                            "build-failure",
                        )
                    self.session.install_configuration(
                        self.runtime_configuration,
                        timeout_seconds=self.timeout_seconds,
                    )
                    self.live_stage = "configured"
                    self._verify_runtime_observation(
                        self.session.read_runtime_observation()
                    )
                    if self.checkpoint is not None:
                        self._advance_setup_menus()
                except Exception as error:
                    diagnostic = self._try_capture_diagnostic()
                    self.stop()
                    detail = (
                        f"; native Dolphin screenshot: {diagnostic}"
                        if diagnostic is not None
                        else ""
                    )
                    raise AttemptExecutionError(
                        f"Dolphin bridge failed to start: {error}{detail}",
                        "bridge-failure",
                    ) from error
        if not self.session.is_running:
            self.stop()
            raise AttemptExecutionError(
                "Dolphin exited before the match ended", "game-crash"
            )
        try:
            configured = self.session.read_configuration()
            if (
                self.runtime_configuration is None
                or configured.requested_epoch
                != self.runtime_configuration.requested_epoch
                or configured.runtime_applied_epoch
                != self.runtime_configuration.requested_epoch
            ):
                raise AttemptExecutionError(
                    "Dolphin bridge lost the attempt runtime configuration",
                    "bridge-failure",
                )
            bridge_events = self.session.poll_events()
            unexpected = [
                event
                for event in bridge_events
                if event.event_type is not EventType.SYNTHETIC
            ]
            if unexpected:
                raise AttemptExecutionError(
                    "Dolphin emitted semantic bridge events while the DME tracker owns "
                    "the v0 telemetry stream",
                    "bridge-failure",
                )
            if self.tracker is None:
                raise AttemptExecutionError(
                    "DME game tracker was not prepared", "runner-crash"
                )
            game_ended = False
            snapshot = self.session.read_game_snapshot()
            if self.live_stage != "running" and snapshot.state == 0x01:
                self._verify_runtime_lineups(
                    self.session.read_runtime_lineups(snapshot)
                )
                self.live_stage = "running"
            for event in self.tracker.observe(snapshot):
                telemetry = memory_tracker_telemetry(event, envelope, configuration)
                emit_telemetry(telemetry)
                game_ended = game_ended or event.event_type == "game-ended"
            if game_ended and self.live_stage != "running":
                raise AttemptExecutionError(
                    "Dolphin reached game end before immutable lineups were verified",
                    "bridge-failure",
                )
        except AttemptExecutionError as error:
            diagnostic = self._try_capture_diagnostic()
            self.stop()
            if diagnostic is None:
                raise
            raise AttemptExecutionError(
                f"{error}; native Dolphin screenshot: {diagnostic}",
                error.failure_kind,
            ) from error
        except Exception as error:
            diagnostic = self._try_capture_diagnostic()
            self.stop()
            detail = (
                f"; native Dolphin screenshot: {diagnostic}"
                if diagnostic is not None
                else ""
            )
            raise AttemptExecutionError(
                f"Dolphin bridge polling failed: {error}{detail}", "bridge-failure"
            ) from error
        if game_ended:
            self.stop()
        return ExecutionOutcome(action="complete" if game_ended else "continue")

    def _try_capture_diagnostic(self) -> Path | None:
        """Best-effort game-only frame capture while Dolphin is still alive."""

        if self.session is None or not self.session.is_running:
            return None
        capture = getattr(self.session, "capture_screenshot", None)
        if not callable(capture):
            return None
        try:
            return Path(capture(timeout_seconds=min(self.timeout_seconds, 5.0)))
        except Exception:  # noqa: BLE001 -- diagnostics are intentionally best-effort
            # The original execution failure remains authoritative. A diagnostic
            # path must never obscure it or alter retry classification.
            return None

    def _verify_runtime_observation(self, observation: RuntimeGameObservation) -> None:
        configuration = self.runtime_configuration
        if configuration is None:
            raise AttemptExecutionError(
                "Runtime configuration was not prepared", "build-failure"
            )
        for index, expected in enumerate(configuration.rules):
            if expected != 0xFF and observation.rules[index] != expected:
                raise AttemptExecutionError(
                    f"Dolphin rule byte {index} failed runtime read-back",
                    "bridge-failure",
                )
        expected_values = {
            "stadium": (observation.stadium_id, configuration.stadium_id),
            "stadium time": (observation.stadium_time, 0),
            "away captain": (
                observation.away_captain_brand_id,
                configuration.away.captain_brand_id,
            ),
            "home captain": (
                observation.home_captain_brand_id,
                configuration.home.captain_brand_id,
            ),
        }
        for label, (actual, expected) in expected_values.items():
            if actual != expected:
                raise AttemptExecutionError(
                    f"Dolphin {label} failed runtime read-back",
                    "bridge-failure",
                )

    def _advance_setup_menus(self) -> None:
        if self.session is None:
            raise AttemptExecutionError(
                "Dolphin session is not running", "runner-crash"
            )
        self._select_stadium()
        self._confirm_captains()
        self._select_cpu_level()
        self._fill_and_inject_lineups()
        self._start_game()

    def _select_stadium(self) -> None:
        assert self.session is not None
        # The checkpoint cursor begins between parks. Select one stable menu
        # target to advance; the bridge continuously enforces the scheduled
        # stadium byte and the runner verifies it again after transition.
        self.session.move_stick(0, 1)
        self.sleep(0.25)
        self.session.tap_button("A")
        self.sleep(0.75)
        self.session.tap_button("A")
        self.sleep(0.75)
        self._verify_runtime_observation(self.session.read_runtime_observation())
        self.live_stage = "stadium-confirmed"

    def _confirm_captains(self) -> None:
        assert self.session is not None
        self.session.tap_button("A")
        self.sleep(1.5)
        self.session.tap_button("A")
        self.session.tap_button("A")
        self.sleep(4.0)
        self._verify_runtime_observation(self.session.read_runtime_observation())
        self.live_stage = "captains-confirmed"

    def _select_cpu_level(self) -> None:
        assert self.session is not None
        self.session.move_stick(1, 0)
        self.session.move_stick(1, 0)
        self.session.tap_button("A")
        self.sleep(2.5)
        self.live_stage = "cpu-level-confirmed"

    def _fill_and_inject_lineups(self) -> None:
        assert self.session is not None
        # Level four is now confirmed and the roster cursor starts on Dixie
        # Kong. Move onto Random Fill, fill both teams, then advance through
        # the reviewed hook. CPU activation remains dormant so the runner keeps
        # control of the final setup screens.
        for _ in range(4):
            self.session.move_stick(1, 0)
        self.session.tap_button("A")
        self.sleep(0.75)
        self.session.tap_button("A")
        self._wait_for_lineup_receipt()
        self.session.wait_for_bridge_frames(120, timeout_seconds=self.timeout_seconds)
        self.session.apply_final_formation(self.runtime_configuration)
        self.live_stage = "lineups-applied"

    def _start_game(self) -> None:
        assert self.session is not None
        # The reviewed team hook leaves the cursor on a player in the custom
        # lineup. Three independently mapped right transitions move from the
        # deterministic Luigi cursor through Mario and Peach to Next. A reaches
        # the final rules screen, then the adapter recognizes Minus+A at Begin
        # and owns the CPU transition itself; no Gecko code is installed.
        for _ in range(3):
            self.session.move_stick(1, 0)
        self.session.tap_button("A")
        self.sleep(1.0)
        self._verify_runtime_observation(self.session.read_runtime_observation())
        self.live_stage = "rules-confirmed"
        self.session.hold_then_tap_buttons("Z", "A", hold_seconds=0.08)
        self._wait_for_game_start()
        self.live_stage = "running-unverified"

    def _verify_runtime_lineups(self, observation: RuntimeLineupObservation) -> None:
        configuration = self.runtime_configuration
        if configuration is None:
            raise AttemptExecutionError(
                "Runtime configuration was not prepared", "runner-crash"
            )
        expected_orders = {
            "away": tuple(entry[0] for entry in configuration.away.entries),
            "home": tuple(entry[0] for entry in configuration.home.entries),
        }
        actual_orders = {
            "away": observation.away_batting_order,
            "home": observation.home_batting_order,
        }
        for side in ("away", "home"):
            if actual_orders[side] != expected_orders[side]:
                raise AttemptExecutionError(
                    f"Dolphin {side} batting order does not match the scheduled lineup: "
                    f"expected {expected_orders[side]}, observed {actual_orders[side]}",
                    "bridge-failure",
                )
        team = (
            configuration.home
            if observation.defense_side == "home"
            else configuration.away
        )
        expected_defense = [0] * 9
        for game_id, _batting_slot, position in team.entries:
            expected_defense[position] = game_id
        if observation.defense_by_position != tuple(expected_defense):
            raise AttemptExecutionError(
                f"Dolphin {observation.defense_side} fielding positions do not "
                f"match the scheduled lineup: expected {tuple(expected_defense)}, "
                f"observed {observation.defense_by_position}",
                "bridge-failure",
            )

    def _wait_for_lineup_receipt(self) -> None:
        if self.session is None or self.runtime_configuration is None:
            raise AttemptExecutionError(
                "Dolphin lineup state is unavailable", "runner-crash"
            )
        attempts = max(1, int(self.timeout_seconds / 0.05))
        for _ in range(attempts):
            configured = self.session.read_configuration()
            if (
                configured.lineup_applied_epoch
                == self.runtime_configuration.requested_epoch
                and configured.lineup_applied_mask & 0x03 == 0x03
            ):
                return
            self.sleep(0.05)
        raise AttemptExecutionError(
            "Dolphin did not acknowledge both immutable team lineups",
            "bridge-failure",
        )

    def _wait_for_game_start(self) -> None:
        if self.session is None:
            raise AttemptExecutionError(
                "Dolphin game state is unavailable", "runner-crash"
            )
        attempts = max(1, int(self.timeout_seconds / 0.05))
        for _ in range(attempts):
            configured = self.session.read_configuration()
            if (
                configured.lineup_applied_mask & 0x07 == 0x07
                and self.session.read_game_snapshot().has_started
            ):
                return
            self.sleep(0.05)
        raise AttemptExecutionError(
            "Dolphin did not activate CPU control and enter a live game after Begin",
            "bridge-failure",
        )

    def _require_recovery_state(self, envelope: dict[str, Any]) -> tuple[int, str]:
        metadata = self.recovery_state
        if metadata is None:
            raise AttemptExecutionError(
                "The runner has no saved Dolphin process identity", "runner-crash"
            )
        expected = {
            "kind": "sluggers-live-session",
            "liveStage": self.live_stage,
            "adapterBuildSha256": self.adapter.adapter_build_sha256,
            "attemptId": envelope["attemptId"],
            "attemptNonceDigest": attempt_nonce_digest(envelope["attemptNonce"]).hex(),
            "buildDirectory": str(self.build_directory),
            "gameBuildSha256": envelope["requiredGameBuildSha256"],
            "memoryTransport": "dme",
            "profileDirectory": str(self.profile_root / envelope["attemptId"]),
        }
        for key, value in expected.items():
            if metadata.get(key) != value:
                raise AttemptExecutionError(
                    f"Saved Dolphin recovery field {key} does not match the attempt",
                    "runner-crash",
                )
        process_id = metadata.get("processId")
        identity = metadata.get("processIdentitySha256")
        if not isinstance(process_id, int) or process_id <= 0:
            raise AttemptExecutionError(
                "Saved Dolphin process ID is invalid", "runner-crash"
            )
        if (
            not isinstance(identity, str)
            or len(identity) != 64
            or any(character not in "0123456789abcdef" for character in identity)
        ):
            raise AttemptExecutionError(
                "Saved Dolphin process identity is invalid", "runner-crash"
            )
        return process_id, identity

    def stop(self) -> None:
        if self.session is not None:
            self.session.stop()
            self.session = None
