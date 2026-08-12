from __future__ import annotations

import json
from pathlib import Path
from typing import Any, ClassVar

import pytest
from starworks_runner.games.sluggers.adapter import AdapterManifest
from starworks_runner.games.sluggers.bridge.configuration import (
    RuntimeConfigurationBlock,
)
from starworks_runner.games.sluggers.bridge.layout import (
    BridgeEvent,
    EventType,
    attempt_nonce_digest,
)
from starworks_runner.games.sluggers.checkpoint import seed_profile_sha256
from starworks_runner.games.sluggers.hashing import sha256_file
from starworks_runner.games.sluggers.live_executor import (
    LiveSluggersExecutor,
    resolve_managed_build,
)
from starworks_runner.games.sluggers.session import (
    RuntimeGameObservation,
    RuntimeLineupObservation,
)
from starworks_runner.games.sluggers.game_observation import GameSnapshot
from starworks_runner.orchestrator import AttemptExecutionError


class FakeLiveSession:
    instances: ClassVar[list[FakeLiveSession]] = []
    last_configuration: ClassVar[RuntimeConfigurationBlock | None] = None

    def __init__(self, **values: Any) -> None:
        self.values = values
        self.started: list[tuple[str, float]] = []
        self.running = True
        self.stopped = 0
        self.events: list[BridgeEvent] = []
        self.configuration: RuntimeConfigurationBlock | None = None
        self.process_id = 4242
        self.process_identity_sha256 = "c" * 64
        self.reattached: list[tuple[str, int, str, float]] = []
        self.movements: list[tuple[int, int]] = []
        self.tapped: list[str] = []
        self.chords: list[tuple[str, str, float]] = []
        self.bridge_frame_waits: list[tuple[int, float]] = []
        self.final_formations: list[RuntimeConfigurationBlock] = []
        self.screenshots: list[Path] = []
        self.snapshot = GameSnapshot(
            frame=0,
            state=0,
            inning=0,
            half=0,
            away_score=0,
            home_score=0,
            away_hits=0,
            home_hits=0,
            balls=0,
            strikes=0,
            outs=0,
            pitches=0,
            batter_game_id=0,
            pitcher_game_id=1,
            runs_this_play=0,
            outs_this_play=0,
        )
        self.__class__.instances.append(self)

    def start(self, attempt_nonce: str, *, timeout_seconds: float) -> None:
        self.started.append((attempt_nonce, timeout_seconds))
        self.events.append(
            BridgeEvent(
                sequence=1,
                frame=61,
                attempt_nonce_digest=attempt_nonce_digest(attempt_nonce),
                event_type=EventType.SYNTHETIC,
                flags=0,
                payload_value=1,
            )
        )

    @property
    def is_running(self) -> bool:
        return self.running

    def poll_events(self) -> list[BridgeEvent]:
        events, self.events = self.events, []
        return events

    def install_configuration(
        self,
        configuration: RuntimeConfigurationBlock,
        *,
        timeout_seconds: float,
    ) -> RuntimeConfigurationBlock:
        self.configuration = RuntimeConfigurationBlock(
            **{
                **configuration.__dict__,
                "runtime_applied_epoch": configuration.requested_epoch,
            }
        )
        self.__class__.last_configuration = self.configuration
        return self.configuration

    def reattach(
        self,
        attempt_nonce: str,
        *,
        process_id: int,
        expected_process_identity_sha256: str,
        timeout_seconds: float,
    ) -> None:
        self.reattached.append(
            (
                attempt_nonce,
                process_id,
                expected_process_identity_sha256,
                timeout_seconds,
            )
        )
        self.configuration = self.__class__.last_configuration

    def read_configuration(self) -> RuntimeConfigurationBlock:
        assert self.configuration is not None
        return self.configuration

    def read_runtime_observation(self) -> RuntimeGameObservation:
        assert self.configuration is not None
        return RuntimeGameObservation(
            rules=self.configuration.rules,
            stadium_id=self.configuration.stadium_id,
            stadium_time=0,
            away_captain_brand_id=self.configuration.away.captain_brand_id,
            home_captain_brand_id=self.configuration.home.captain_brand_id,
        )

    def read_runtime_lineups(self, snapshot: GameSnapshot) -> RuntimeLineupObservation:
        assert self.configuration is not None
        home_by_position = [0] * 9
        for game_id, _slot, position in self.configuration.home.entries:
            home_by_position[position] = game_id
        return RuntimeLineupObservation(
            away_batting_order=tuple(
                entry[0] for entry in self.configuration.away.entries
            ),
            home_batting_order=tuple(
                entry[0] for entry in self.configuration.home.entries
            ),
            defense_side="home",
            defense_by_position=tuple(home_by_position),
        )

    def move_stick(self, x: int, y: int) -> None:
        self.movements.append((x, y))

    def tap_button(self, button: str) -> None:
        self.tapped.append(button)
        if len(self.tapped) == 8 and self.configuration is not None:
            self.configuration = RuntimeConfigurationBlock(
                **{
                    **self.configuration.__dict__,
                    "lineup_applied_epoch": self.configuration.requested_epoch,
                    "lineup_applied_mask": self.configuration.lineup_applied_mask | 3,
                }
            )

    def hold_then_tap_buttons(
        self, held_button: str, tapped_button: str, *, hold_seconds: float
    ) -> None:
        self.chords.append((held_button, tapped_button, hold_seconds))
        if self.configuration is not None:
            self.configuration = RuntimeConfigurationBlock(
                **{
                    **self.configuration.__dict__,
                    "lineup_applied_mask": self.configuration.lineup_applied_mask | 4,
                }
            )
            self.snapshot = GameSnapshot(
                **{
                    **self.snapshot.__dict__,
                    "frame": 1,
                    "state": 0x04,
                    "inning": 1,
                }
            )

    def wait_for_bridge_frames(self, frames: int, *, timeout_seconds: float) -> None:
        self.bridge_frame_waits.append((frames, timeout_seconds))

    def apply_final_formation(
        self, configuration: RuntimeConfigurationBlock
    ) -> None:
        self.final_formations.append(configuration)

    def stop(self) -> None:
        self.stopped += 1
        self.running = False

    def capture_screenshot(self, *, timeout_seconds: float) -> Path:
        screenshot = Path(self.values["profile_directory"]) / "ScreenShots/failure.png"
        self.screenshots.append(screenshot)
        return screenshot

    def read_game_snapshot(self) -> GameSnapshot:
        return self.snapshot


def test_live_executor_starts_once_and_keeps_real_attempt_running(
    tmp_path: Path,
) -> None:
    envelope, configuration = execution_fixtures()
    adapter = AdapterManifest.load()
    configuration["adapterVersion"] = adapter.adapter_version
    create_build_manifest(
        tmp_path, envelope["requiredGameBuildSha256"], adapter.adapter_version
    )
    FakeLiveSession.instances = []
    executor = LiveSluggersExecutor(
        cache_root=tmp_path,
        dolphin_executable=tmp_path / "Dolphin",
        profile_root=tmp_path / "profiles",
        adapter=adapter,
        session_factory=FakeLiveSession,  # type: ignore[arg-type]
        sleep=lambda _: None,
    )
    telemetry: list[dict[str, Any]] = []

    executor.prepare(envelope, configuration)
    first = executor.execute(
        envelope,
        configuration,
        recovering=False,
        emit_telemetry=telemetry.append,
    )
    second = executor.execute(
        envelope,
        configuration,
        recovering=True,
        emit_telemetry=telemetry.append,
    )

    assert first.action == second.action == "continue"
    assert len(FakeLiveSession.instances) == 1
    session = FakeLiveSession.instances[0]
    assert session.started == [(envelope["attemptNonce"], 10.0)]
    assert session.values["game_build_sha256"] == envelope["requiredGameBuildSha256"]
    assert session.configuration is not None
    assert session.configuration.rules[0] == 7
    assert telemetry == []


def test_live_executor_materializes_and_loads_the_exact_seed_checkpoint(
    tmp_path: Path,
) -> None:
    envelope, configuration = execution_fixtures()
    adapter = AdapterManifest.load()
    configuration["adapterVersion"] = adapter.adapter_version
    create_build_manifest(
        tmp_path, envelope["requiredGameBuildSha256"], adapter.adapter_version
    )
    seed = tmp_path / "seed"
    (seed / "Config").mkdir(parents=True)
    (seed / "Config/Dolphin.ini").write_text("[Core]\n", encoding="utf-8")
    (seed / "Wii/title/rmbe/data").mkdir(parents=True)
    (seed / "Wii/title/rmbe/data/gamedata").write_bytes(b"unlocked")
    package = tmp_path / "checkpoint"
    package.mkdir()
    save_state = package / "pre-roster.sav"
    save_state.write_bytes(b"checkpoint")
    manifest_path = package / "checkpoint.json"
    manifest_path.write_text(
        json.dumps(
            {
                "kind": "sluggers-seed-checkpoint",
                "stage": "stadium-selection",
                "saveState": {
                    "path": save_state.name,
                    "sha256": sha256_file(save_state),
                },
                "dolphinVersion": "2606",
                "adapterBuildSha256": adapter.adapter_build_sha256,
                "gameBuildSha256": envelope["requiredGameBuildSha256"],
                "mainDolSha256": "f" * 64,
                "seedProfileSha256": seed_profile_sha256(seed),
            }
        ),
        encoding="utf-8",
    )
    FakeLiveSession.instances = []
    executor = LiveSluggersExecutor(
        cache_root=tmp_path,
        dolphin_executable=tmp_path / "Dolphin",
        profile_root=tmp_path / "profiles",
        checkpoint_manifest=manifest_path,
        seed_profile_directory=seed,
        adapter=adapter,
        session_factory=FakeLiveSession,  # type: ignore[arg-type]
        sleep=lambda _: None,
    )

    executor.prepare(envelope, configuration)
    outcome = executor.execute(
        envelope,
        configuration,
        recovering=False,
        emit_telemetry=lambda _: None,
    )

    attempt_profile = tmp_path / "profiles" / envelope["attemptId"]
    assert outcome.action == "continue"
    assert (
        attempt_profile / "Wii/title/rmbe/data/gamedata"
    ).read_bytes() == b"unlocked"
    assert FakeLiveSession.instances[0].values["initial_save_state"] == save_state
    assert FakeLiveSession.instances[0].movements == [
        (0, 1),
        (1, 0),
        (1, 0),
        (1, 0),
        (1, 0),
        (1, 0),
        (1, 0),
        (1, 0),
        (1, 0),
        (1, 0),
    ]
    assert FakeLiveSession.instances[0].tapped == [
        "A",
        "A",
        "A",
        "A",
        "A",
        "A",
        "A",
        "A",
        "A",
    ]
    assert FakeLiveSession.instances[0].chords == [("Z", "A", 0.08)]
    assert FakeLiveSession.instances[0].bridge_frame_waits == [(120, 10.0)]
    assert len(FakeLiveSession.instances[0].final_formations) == 1
    assert FakeLiveSession.instances[0].final_formations[0].away.entries[0][0] == 10
    assert FakeLiveSession.instances[0].final_formations[0].home.entries[0][0] == 0


def test_live_executor_fails_closed_when_process_ownership_was_lost(
    tmp_path: Path,
) -> None:
    envelope, configuration = execution_fixtures()
    adapter = AdapterManifest.load()
    configuration["adapterVersion"] = adapter.adapter_version
    create_build_manifest(
        tmp_path, envelope["requiredGameBuildSha256"], adapter.adapter_version
    )
    executor = LiveSluggersExecutor(
        cache_root=tmp_path,
        dolphin_executable=tmp_path / "Dolphin",
        profile_root=tmp_path / "profiles",
        adapter=adapter,
        session_factory=FakeLiveSession,  # type: ignore[arg-type]
    )

    with pytest.raises(
        AttemptExecutionError, match="no saved Dolphin process identity"
    ) as captured:
        executor.execute(
            envelope,
            configuration,
            recovering=True,
            emit_telemetry=lambda _: None,
        )

    assert captured.value.failure_kind == "runner-crash"


def test_live_executor_reattaches_only_with_exact_persisted_identity(
    tmp_path: Path,
) -> None:
    envelope, configuration = execution_fixtures()
    adapter = AdapterManifest.load()
    configuration["adapterVersion"] = adapter.adapter_version
    create_build_manifest(
        tmp_path, envelope["requiredGameBuildSha256"], adapter.adapter_version
    )
    FakeLiveSession.instances = []
    FakeLiveSession.last_configuration = None
    first = LiveSluggersExecutor(
        cache_root=tmp_path,
        dolphin_executable=tmp_path / "Dolphin",
        profile_root=tmp_path / "profiles",
        adapter=adapter,
        session_factory=FakeLiveSession,  # type: ignore[arg-type]
    )
    first.prepare(envelope, configuration)
    assert (
        first.execute(
            envelope,
            configuration,
            recovering=False,
            emit_telemetry=lambda _: None,
        ).action
        == "continue"
    )
    metadata = first.runtime_metadata()
    assert metadata is not None

    recovered = LiveSluggersExecutor(
        cache_root=tmp_path,
        dolphin_executable=tmp_path / "Dolphin",
        profile_root=tmp_path / "profiles",
        adapter=adapter,
        session_factory=FakeLiveSession,  # type: ignore[arg-type]
    )
    recovered.restore_runtime(metadata)
    assert (
        recovered.execute(
            envelope,
            configuration,
            recovering=True,
            emit_telemetry=lambda _: None,
        ).action
        == "continue"
    )
    assert FakeLiveSession.instances[-1].reattached == [
        (envelope["attemptNonce"], 4242, "c" * 64, 10.0)
    ]

    wrong = LiveSluggersExecutor(
        cache_root=tmp_path,
        dolphin_executable=tmp_path / "Dolphin",
        profile_root=tmp_path / "profiles",
        adapter=adapter,
        session_factory=FakeLiveSession,  # type: ignore[arg-type]
    )
    wrong.restore_runtime({**metadata, "gameBuildSha256": "d" * 64})
    with pytest.raises(AttemptExecutionError, match="gameBuildSha256") as captured:
        wrong.execute(
            envelope,
            configuration,
            recovering=True,
            emit_telemetry=lambda _: None,
        )
    assert captured.value.failure_kind == "runner-crash"


def test_live_executor_reports_dolphin_exit_as_game_crash(tmp_path: Path) -> None:
    envelope, configuration = execution_fixtures()
    adapter = AdapterManifest.load()
    configuration["adapterVersion"] = adapter.adapter_version
    create_build_manifest(
        tmp_path, envelope["requiredGameBuildSha256"], adapter.adapter_version
    )
    FakeLiveSession.instances = []
    executor = LiveSluggersExecutor(
        cache_root=tmp_path,
        dolphin_executable=tmp_path / "Dolphin",
        profile_root=tmp_path / "profiles",
        adapter=adapter,
        session_factory=FakeLiveSession,  # type: ignore[arg-type]
    )
    executor.prepare(envelope, configuration)
    executor.execute(
        envelope,
        configuration,
        recovering=False,
        emit_telemetry=lambda _: None,
    )
    FakeLiveSession.instances[0].running = False

    with pytest.raises(AttemptExecutionError, match="Dolphin exited") as captured:
        executor.execute(
            envelope,
            configuration,
            recovering=True,
            emit_telemetry=lambda _: None,
        )

    assert captured.value.failure_kind == "game-crash"


def test_live_executor_completes_from_real_dme_game_state(tmp_path: Path) -> None:
    envelope, configuration = execution_fixtures()
    adapter = AdapterManifest.load()
    configuration["adapterVersion"] = adapter.adapter_version
    create_build_manifest(
        tmp_path, envelope["requiredGameBuildSha256"], adapter.adapter_version
    )
    FakeLiveSession.instances = []
    executor = LiveSluggersExecutor(
        cache_root=tmp_path,
        dolphin_executable=tmp_path / "Dolphin",
        profile_root=tmp_path / "profiles",
        adapter=adapter,
        session_factory=FakeLiveSession,  # type: ignore[arg-type]
    )
    telemetry: list[dict[str, Any]] = []
    assert (
        executor.execute(
            envelope,
            configuration,
            recovering=False,
            emit_telemetry=telemetry.append,
        ).action
        == "continue"
    )
    session = FakeLiveSession.instances[0]
    session.snapshot = GameSnapshot(
        **{
            **session.snapshot.__dict__,
            "frame": 1_000,
            "state": 0x01,
            "inning": 1,
        }
    )
    assert (
        executor.execute(
            envelope,
            configuration,
            recovering=True,
            emit_telemetry=telemetry.append,
        ).action
        == "continue"
    )
    session.snapshot = GameSnapshot(
        **{
            **session.snapshot.__dict__,
            "frame": 50_000,
            "state": 0x09,
            "inning": 7,
            "half": 1,
            "away_score": 3,
            "home_score": 5,
        }
    )

    outcome = executor.execute(
        envelope,
        configuration,
        recovering=True,
        emit_telemetry=telemetry.append,
    )

    assert outcome.action == "complete"
    assert [event["eventType"] for event in telemetry] == [
        "game-started",
        "inning-started",
        "batter-changed",
        "pitcher-changed",
        "inning-started",
        "game-ended",
    ]
    assert telemetry[-1]["observationSource"] == "memory-observation"
    assert telemetry[-1]["payload"] == {
        "awayRuns": 3,
        "homeRuns": 5,
        "reason": "completed",
    }


def test_live_executor_rejects_a_hook_receipt_when_game_lineups_differ(
    tmp_path: Path,
) -> None:
    envelope, configuration = execution_fixtures()
    adapter = AdapterManifest.load()
    configuration["adapterVersion"] = adapter.adapter_version
    create_build_manifest(
        tmp_path, envelope["requiredGameBuildSha256"], adapter.adapter_version
    )
    FakeLiveSession.instances = []
    executor = LiveSluggersExecutor(
        cache_root=tmp_path,
        dolphin_executable=tmp_path / "Dolphin",
        profile_root=tmp_path / "profiles",
        adapter=adapter,
        session_factory=FakeLiveSession,  # type: ignore[arg-type]
    )
    assert (
        executor.execute(
            envelope,
            configuration,
            recovering=False,
            emit_telemetry=lambda _: None,
        ).action
        == "continue"
    )
    session = FakeLiveSession.instances[0]
    session.snapshot = GameSnapshot(
        **{**session.snapshot.__dict__, "frame": 1_000, "state": 0x01, "inning": 1}
    )
    expected = session.read_runtime_lineups(session.snapshot)
    session.read_runtime_lineups = lambda _snapshot: RuntimeLineupObservation(  # type: ignore[method-assign]
        away_batting_order=tuple(reversed(expected.away_batting_order)),
        home_batting_order=expected.home_batting_order,
        defense_side=expected.defense_side,
        defense_by_position=expected.defense_by_position,
    )

    with pytest.raises(
        AttemptExecutionError, match="away batting order does not match"
    ) as captured:
        executor.execute(
            envelope,
            configuration,
            recovering=True,
            emit_telemetry=lambda _: None,
        )

    assert captured.value.failure_kind == "bridge-failure"


def test_live_executor_attaches_a_native_frame_to_live_bridge_failures(
    tmp_path: Path,
) -> None:
    envelope, configuration = execution_fixtures()
    adapter = AdapterManifest.load()
    configuration["adapterVersion"] = adapter.adapter_version
    create_build_manifest(
        tmp_path, envelope["requiredGameBuildSha256"], adapter.adapter_version
    )
    FakeLiveSession.instances = []
    executor = LiveSluggersExecutor(
        cache_root=tmp_path,
        dolphin_executable=tmp_path / "Dolphin",
        profile_root=tmp_path / "profiles",
        adapter=adapter,
        session_factory=FakeLiveSession,  # type: ignore[arg-type]
    )
    executor.prepare(envelope, configuration)
    executor.execute(
        envelope,
        configuration,
        recovering=False,
        emit_telemetry=lambda _: None,
    )
    session = FakeLiveSession.instances[0]
    session.configuration = None

    with pytest.raises(
        AttemptExecutionError, match="native Dolphin screenshot: .*failure.png"
    ) as captured:
        executor.execute(
            envelope,
            configuration,
            recovering=True,
            emit_telemetry=lambda _: None,
        )

    assert captured.value.failure_kind == "bridge-failure"
    assert session.screenshots == [
        tmp_path / "profiles" / envelope["attemptId"] / "ScreenShots/failure.png"
    ]


def test_managed_build_resolution_requires_one_exact_build(tmp_path: Path) -> None:
    build_sha256 = "a" * 64
    expected = create_build_manifest(tmp_path, build_sha256, "0.2.0")
    stale = tmp_path / "builds/stale-v0-cache"
    stale.mkdir()
    (stale / "game-build-manifest.json").write_text(
        json.dumps({"kind": "game-build-manifest"}), encoding="utf-8"
    )

    assert resolve_managed_build(tmp_path, build_sha256) == expected
    with pytest.raises(AttemptExecutionError, match="not in the local cache"):
        resolve_managed_build(tmp_path, "b" * 64)


def create_build_manifest(
    cache_root: Path,
    build_sha256: str,
    adapter_version: str,
    *,
    adapter_build_sha256: str | None = None,
) -> Path:
    fixture = (
        Path(__file__).resolve().parents[2]
        / "contracts/fixtures/valid/game-build-manifest.json"
    )
    manifest = json.loads(fixture.read_text(encoding="utf-8"))
    manifest["buildSha256"] = build_sha256
    manifest["adapterVersion"] = adapter_version
    manifest["adapterBuildSha256"] = (
        adapter_build_sha256 or AdapterManifest.load().adapter_build_sha256
    )
    build_directory = cache_root / "builds" / "cache-key"
    build_directory.mkdir(parents=True, exist_ok=True)
    (build_directory / "game-build-manifest.json").write_text(
        json.dumps(manifest), encoding="utf-8"
    )
    return build_directory.resolve()


def execution_fixtures() -> tuple[dict[str, Any], dict[str, Any]]:
    root = Path(__file__).resolve().parents[2] / "contracts/fixtures/valid"
    envelope = json.loads((root / "run-envelope.json").read_text(encoding="utf-8"))
    configuration = json.loads(
        (root / "match-configuration-package.json").read_text(encoding="utf-8")
    )
    envelope.update(
        {
            "leagueId": configuration["leagueId"],
            "matchId": configuration["matchId"],
            "attemptId": configuration["attemptId"],
            "attemptNonce": configuration["attemptNonce"],
            "statProfileRevisionId": configuration["statProfile"]["revisionId"],
            "rulesetRevisionId": configuration["ruleset"]["revisionId"],
            "teams": [
                {
                    "side": team["side"],
                    "teamId": team["lineup"]["teamId"],
                    "rosterRevisionId": team["lineup"]["rosterRevisionId"],
                    "lineupRevisionId": team["lineup"]["lineupRevisionId"],
                }
                for team in configuration["teams"]
            ],
        }
    )
    return envelope, configuration
