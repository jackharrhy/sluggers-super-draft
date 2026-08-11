from __future__ import annotations

import hashlib
import json
import os
import signal
import subprocess
import time
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Protocol, Self

from starworks_runner.contracts import validate_contract
from starworks_runner.games.sluggers.bridge.client import BridgeClient
from starworks_runner.games.sluggers.bridge.configuration import (
    RuntimeConfigurationBlock,
)
from starworks_runner.games.sluggers.bridge.layout import (
    BRIDGE_ENTRY_ADDRESS,
    BRIDGE_ENTRY_SIGNATURE,
    BridgeEvent,
    BridgeLayout,
    BridgeProtocolError,
    ControlBlock,
)
from starworks_runner.games.sluggers.bridge.memory import (
    DolphinMemoryEngineTransport,
    GdbRemoteMemoryTransport,
    MemoryTransport,
)
from starworks_runner.games.sluggers.controller import DolphinPipeController
from starworks_runner.games.sluggers.dolphin import DolphinLaunch, DolphinLauncher
from starworks_runner.games.sluggers.errors import BuildIntegrityError
from starworks_runner.games.sluggers.tracker import GameSnapshot, SluggersMemoryReader


class LiveMemoryTransport(MemoryTransport, Protocol):
    def attach(self) -> None: ...

    def close(self) -> None: ...


@dataclass(frozen=True)
class RuntimeGameObservation:
    rules: tuple[int, int, int, int]
    stadium_id: int
    stadium_time: int
    away_captain_brand_id: int
    home_captain_brand_id: int


@dataclass(frozen=True)
class RuntimeLineupObservation:
    away_batting_order: tuple[int, ...]
    home_batting_order: tuple[int, ...]
    defense_side: str
    defense_by_position: tuple[int, ...]


def load_game_build_manifest(build_directory: Path) -> dict[str, Any]:
    manifest_path = build_directory.expanduser().resolve() / "game-build-manifest.json"
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise BuildIntegrityError(
            f"Managed game-build manifest is unreadable: {manifest_path}"
        ) from error
    try:
        validate_contract("game-build-manifest", manifest)
    except Exception as error:
        raise BuildIntegrityError(
            f"Managed game-build manifest does not satisfy the current contract: {manifest_path}"
        ) from error
    return manifest


def bootstrap_live_bridge(
    transport: GdbRemoteMemoryTransport,
    *,
    adapter_build_sha256: str,
    game_build_sha256: str,
    layout: BridgeLayout | None = None,
    timeout_seconds: float = 10.0,
    monotonic: Callable[[], float] = time.monotonic,
    sleep: Callable[[float], None] = time.sleep,
) -> BridgeClient:
    """Continue a GDB-held Dolphin, then initialize the current bridge."""

    transport.continue_execution()
    return initialize_running_bridge(
        transport,
        adapter_build_sha256=adapter_build_sha256,
        game_build_sha256=game_build_sha256,
        layout=layout,
        timeout_seconds=timeout_seconds,
        monotonic=monotonic,
        sleep=sleep,
    )


def initialize_running_bridge(
    transport: MemoryTransport,
    *,
    adapter_build_sha256: str,
    game_build_sha256: str,
    layout: BridgeLayout | None = None,
    timeout_seconds: float = 10.0,
    monotonic: Callable[[], float] = time.monotonic,
    sleep: Callable[[float], None] = time.sleep,
) -> BridgeClient:
    """Wait for the patched DOL and safely publish a complete control block."""

    if timeout_seconds <= 0:
        raise BridgeProtocolError("Bridge bootstrap timeout must be positive")
    selected_layout = layout or BridgeLayout()
    client = BridgeClient(
        transport,
        expected_adapter_build_sha256=adapter_build_sha256,
        expected_game_build_sha256=game_build_sha256,
        layout=selected_layout,
    )
    initial_control = ControlBlock.initial(
        adapter_build_sha256, game_build_sha256
    ).pack()
    deadline = monotonic() + timeout_seconds
    initialized = False
    stable_reads = 0
    while True:
        try:
            bridge_entry = transport.read(BRIDGE_ENTRY_ADDRESS, 4)
            if bridge_entry != BRIDGE_ENTRY_SIGNATURE:
                initialized = False
                stable_reads = 0
            elif not initialized:
                # DME observes a running CPU. Keep magic invalid while the body
                # is replaced, then publish it last so the game cannot consume
                # a partially initialized control block.
                transport.write(selected_layout.base_address, bytes(4))
                transport.write(selected_layout.base_address + 4, initial_control[4:])
                transport.write(selected_layout.base_address, initial_control[:4])
                initialized = True
                stable_reads = 0
            else:
                client.read_control()
                stable_reads += 1
                if stable_reads >= 2:
                    return client
        except BridgeProtocolError:
            initialized = False
            stable_reads = 0
        if monotonic() >= deadline:
            raise BridgeProtocolError(
                "Patched Sluggers bridge did not load before the bootstrap timeout"
            )
        sleep(0.05)


def wait_for_restored_bridge(
    transport: MemoryTransport,
    *,
    adapter_build_sha256: str,
    game_build_sha256: str,
    layout: BridgeLayout | None = None,
    timeout_seconds: float = 10.0,
    monotonic: Callable[[], float] = time.monotonic,
    sleep: Callable[[float], None] = time.sleep,
) -> ControlBlock:
    """Wait until Dolphin has restored the checkpoint RAM, not just its DOL.

    Dolphin briefly exposes the booted DOL before ``--save_state`` replaces
    emulated RAM. A checkpoint captured by Starworks already contains a valid
    bridge control block, so two advancing heartbeat reads are an exact and
    inexpensive restoration gate.
    """

    if timeout_seconds <= 0:
        raise BridgeProtocolError("Checkpoint restore timeout must be positive")
    selected_layout = layout or BridgeLayout()
    client = BridgeClient(
        transport,
        expected_adapter_build_sha256=adapter_build_sha256,
        expected_game_build_sha256=game_build_sha256,
        layout=selected_layout,
    )
    deadline = monotonic() + timeout_seconds
    previous_heartbeat: int | None = None
    while True:
        try:
            control = client.read_control()
            if (
                previous_heartbeat is not None
                and control.heartbeat > previous_heartbeat
            ):
                return control
            previous_heartbeat = control.heartbeat
        except BridgeProtocolError:
            previous_heartbeat = None
        if monotonic() >= deadline:
            raise BridgeProtocolError(
                "Dolphin did not finish restoring the pinned checkpoint"
            )
        sleep(0.05)


class LiveSluggersSession:
    """Own one verified Dolphin process and its attempt-attributed bridge client."""

    def __init__(
        self,
        *,
        build_directory: Path,
        dolphin_executable: Path,
        profile_directory: Path,
        adapter_build_sha256: str,
        game_build_sha256: str,
        initial_save_state: Path | None = None,
        launcher: DolphinLauncher | None = None,
        transport_factory: Callable[[float], LiveMemoryTransport] | None = None,
        controller_factory: Callable[[Path], DolphinPipeController] | None = None,
    ) -> None:
        self.build_directory = build_directory.expanduser().resolve()
        self.profile_directory = profile_directory.expanduser().resolve()
        self.adapter_build_sha256 = adapter_build_sha256
        self.game_build_sha256 = game_build_sha256
        self.initial_save_state = (
            initial_save_state.expanduser().resolve()
            if initial_save_state is not None
            else None
        )
        self.launcher = launcher or DolphinLauncher(dolphin_executable)
        if transport_factory is not None:
            self.transport_factory = transport_factory
        else:
            self.transport_factory = lambda _timeout: DolphinMemoryEngineTransport()
        self.controller = (
            (controller_factory or DolphinPipeController)(self.profile_directory)
            if os.name == "posix" or controller_factory is not None
            else None
        )
        self.launch: DolphinLaunch | None = None
        self.attached_pid: int | None = None
        self.process_identity_sha256: str | None = None
        self.transport: LiveMemoryTransport | None = None
        self.client: BridgeClient | None = None

    def start(
        self, attempt_nonce: str, *, timeout_seconds: float = 10.0
    ) -> ControlBlock:
        if self.launch is not None:
            raise BridgeProtocolError("Live Sluggers session is already started")
        manifest = load_game_build_manifest(self.build_directory)
        if manifest["buildSha256"] != self.game_build_sha256:
            raise BuildIntegrityError(
                "Selected managed build does not match the attempt game-build ID"
            )
        self.launcher.verify_dme_compatible()
        if self.controller is not None:
            self.controller.prepare()
        self.launch = self.launcher.launch(
            self.build_directory,
            self.profile_directory,
            save_state=self.initial_save_state,
            quiet_output=True,
        )
        self.process_identity_sha256 = process_identity_sha256(self.launch.process.pid)
        try:
            if self.controller is not None:
                self.controller.connect(timeout_seconds=timeout_seconds)
            self.transport = self.transport_factory(timeout_seconds)
            self._attach_transport(timeout_seconds=timeout_seconds)
            if self.initial_save_state is not None:
                wait_for_restored_bridge(
                    self.transport,
                    adapter_build_sha256=self.adapter_build_sha256,
                    game_build_sha256=self.game_build_sha256,
                    timeout_seconds=timeout_seconds,
                )
            self.client = initialize_running_bridge(
                self.transport,
                adapter_build_sha256=self.adapter_build_sha256,
                game_build_sha256=self.game_build_sha256,
                timeout_seconds=timeout_seconds,
            )
            return self.client.negotiate(
                attempt_nonce,
                timeout_seconds=timeout_seconds,
            )
        except Exception:
            self.stop()
            raise

    def reattach(
        self,
        attempt_nonce: str,
        *,
        process_id: int,
        expected_process_identity_sha256: str,
        timeout_seconds: float = 10.0,
    ) -> ControlBlock:
        if self.launch is not None or self.attached_pid is not None:
            raise BridgeProtocolError("Live Sluggers session is already started")
        manifest = load_game_build_manifest(self.build_directory)
        if manifest["buildSha256"] != self.game_build_sha256:
            raise BuildIntegrityError(
                "Selected managed build does not match the attempt game-build ID"
            )
        self.launcher.verify_dme_compatible()
        actual_identity = process_identity_sha256(process_id)
        if actual_identity != expected_process_identity_sha256:
            raise BridgeProtocolError(
                "Running Dolphin process identity changed before recovery"
            )
        try:
            if self.controller is not None:
                self.controller.connect(timeout_seconds=timeout_seconds)
            self.transport = self.transport_factory(timeout_seconds)
            self._attach_transport(timeout_seconds=timeout_seconds)
            self.client = BridgeClient(
                self.transport,
                expected_adapter_build_sha256=self.adapter_build_sha256,
                expected_game_build_sha256=self.game_build_sha256,
            )
            control = self.client.attach_existing(attempt_nonce)
            self.attached_pid = process_id
            self.process_identity_sha256 = actual_identity
            return control
        except Exception:
            self.stop()
            raise

    def _attach_transport(self, *, timeout_seconds: float) -> None:
        if self.transport is None:
            raise BridgeProtocolError("Live Sluggers memory transport is unavailable")
        deadline = time.monotonic() + timeout_seconds
        last_error: BridgeProtocolError | None = None
        while time.monotonic() <= deadline:
            try:
                self.transport.attach()
                return
            except BridgeProtocolError as error:
                last_error = error
                time.sleep(0.05)
        raise BridgeProtocolError(
            f"Dolphin memory transport did not attach: {last_error}"
        ) from last_error

    @property
    def is_running(self) -> bool:
        if self.launch is not None:
            return self.launch.process.poll() is None
        if self.attached_pid is None or self.process_identity_sha256 is None:
            return False
        try:
            return (
                process_identity_sha256(self.attached_pid)
                == self.process_identity_sha256
            )
        except BridgeProtocolError:
            return False

    @property
    def process_id(self) -> int | None:
        if self.launch is not None:
            return self.launch.process.pid
        return self.attached_pid

    def poll_events(self) -> list[BridgeEvent]:
        if self.client is None:
            raise BridgeProtocolError("Live Sluggers session is not started")
        return self.client.poll_events()

    def install_configuration(
        self,
        configuration: RuntimeConfigurationBlock,
        *,
        timeout_seconds: float = 5.0,
    ) -> RuntimeConfigurationBlock:
        if self.client is None:
            raise BridgeProtocolError("Live Sluggers session is not started")
        return self.client.install_configuration(
            configuration,
            timeout_seconds=timeout_seconds,
        )

    def read_configuration(self) -> RuntimeConfigurationBlock:
        if self.client is None:
            raise BridgeProtocolError("Live Sluggers session is not started")
        return self.client.read_configuration()

    def read_control(self) -> ControlBlock:
        if self.client is None:
            raise BridgeProtocolError("Live Sluggers session is not started")
        return self.client.read_control()

    def wait_for_bridge_frames(
        self, frames: int, *, timeout_seconds: float = 10.0
    ) -> None:
        if frames <= 0 or timeout_seconds <= 0:
            raise BridgeProtocolError("Bridge frame count and timeout must be positive")
        initial = self.read_control().heartbeat
        target = initial + frames
        deadline = time.monotonic() + timeout_seconds
        while self.read_control().heartbeat < target:
            if time.monotonic() >= deadline:
                raise BridgeProtocolError(
                    f"Dolphin did not advance {frames} bridge frames before timeout"
                )
            time.sleep(0.01)

    def read_game_snapshot(self) -> GameSnapshot:
        if self.transport is None:
            raise BridgeProtocolError("Live Sluggers session is not started")
        return SluggersMemoryReader(self.transport).read()

    def read_runtime_observation(self) -> RuntimeGameObservation:
        if self.transport is None:
            raise BridgeProtocolError("Live Sluggers session is not started")
        rules = self.transport.read(0x80794328, 4)
        stadium = self.transport.read(0x811F769D, 3)
        captains = self.transport.read(0x811F76AC, 2)
        return RuntimeGameObservation(
            rules=tuple(rules),  # type: ignore[arg-type]
            stadium_id=stadium[0],
            stadium_time=stadium[1],
            away_captain_brand_id=captains[0],
            home_captain_brand_id=captains[1],
        )

    def read_runtime_lineups(self, snapshot: GameSnapshot) -> RuntimeLineupObservation:
        """Read the game-owned lineups after match initialization.

        A hook receipt proves only that the hook ran. These structures prove
        what survived the remaining menus. Team one/team two are converted to
        baseball away/home using the current inning and game-owned side flags.
        """

        if self.transport is None:
            raise BridgeProtocolError("Live Sluggers session is not started")
        if snapshot.state != 0x01 or snapshot.batting_side is None:
            raise BridgeProtocolError(
                "Runtime lineups can only be verified during a live batting state"
            )
        team_orders = (
            tuple(
                self.transport.read(0x8131B4B9 + index * 0x8E, 1)[0]
                for index in range(9)
            ),
            tuple(
                self.transport.read(0x8131B9B7 + index * 0x8E, 1)[0]
                for index in range(9)
            ),
        )
        team_states = tuple(self.transport.read(0x900D5C22, 2))
        if sorted(team_states) != [0, 1]:
            raise BridgeProtocolError(
                "Game-owned team batting/fielding flags are inconsistent"
            )
        batting_team = team_states.index(0)
        fielding_team = 1 - batting_team
        if snapshot.batting_side == "away":
            away_order = team_orders[batting_team]
            home_order = team_orders[fielding_team]
            defense_side = "home"
        else:
            home_order = team_orders[batting_team]
            away_order = team_orders[fielding_team]
            defense_side = "away"
        position_bases = (
            0x900D9B45,
            0x900D9E31,
            0x900DA11D,
            0x900DA409,
            0x900DA6F5,
            0x900DA9E1,
            0x900DACCD,
            0x900DAFB9,
            0x900DB2A5,
        )
        return RuntimeLineupObservation(
            away_batting_order=away_order,
            home_batting_order=home_order,
            defense_side=defense_side,
            defense_by_position=tuple(
                self.transport.read(address + 2, 1)[0] for address in position_bases
            ),
        )

    def tap_button(self, button: str) -> None:
        if self.controller is None:
            raise BridgeProtocolError(
                "This runner platform has no automated Dolphin controller backend"
            )
        self.controller.tap(button)

    def chord_buttons(self, *buttons: str) -> None:
        if self.controller is None:
            raise BridgeProtocolError(
                "This runner platform has no automated Dolphin controller backend"
            )
        self.controller.chord(*buttons)

    def hold_then_tap_buttons(
        self,
        held_button: str,
        tapped_button: str,
        *,
        hold_seconds: float,
    ) -> None:
        if self.controller is None:
            raise BridgeProtocolError(
                "This runner platform has no automated Dolphin controller backend"
            )
        self.controller.hold_then_tap(
            held_button,
            tapped_button,
            hold_seconds=hold_seconds,
        )

    def move_stick(self, x: int, y: int) -> None:
        if self.controller is None:
            raise BridgeProtocolError(
                "This runner platform has no automated Dolphin controller backend"
            )
        self.controller.move_stick(x, y)

    def capture_screenshot(self, *, timeout_seconds: float = 5.0) -> Path:
        if self.controller is None:
            raise BridgeProtocolError(
                "This runner platform has no native Dolphin screenshot backend"
            )
        return self.controller.capture_screenshot(timeout_seconds=timeout_seconds)

    def save_state_slot_one(self, *, timeout_seconds: float = 10.0) -> Path:
        if self.controller is None:
            raise BridgeProtocolError(
                "This runner platform has no native Dolphin save-state backend"
            )
        return self.controller.save_state_slot_one(timeout_seconds=timeout_seconds)

    def stop(self, *, timeout_seconds: float = 5.0) -> None:
        if self.controller is not None:
            self.controller.close()
        if self.transport is not None:
            self.transport.close()
            self.transport = None
        if self.launch is not None:
            process = self.launch.process
            if process.poll() is None:
                process.terminate()
                try:
                    process.wait(timeout=timeout_seconds)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait(timeout=timeout_seconds)
            self.launch = None
        elif self.attached_pid is not None and self.process_identity_sha256 is not None:
            process_id = self.attached_pid
            try:
                if process_identity_sha256(process_id) == self.process_identity_sha256:
                    os.kill(process_id, signal.SIGTERM)
                    deadline = time.monotonic() + timeout_seconds
                    while time.monotonic() < deadline:
                        try:
                            process_identity_sha256(process_id)
                        except BridgeProtocolError:
                            break
                        time.sleep(0.05)
                    else:
                        if (
                            process_identity_sha256(process_id)
                            == self.process_identity_sha256
                        ):
                            os.kill(process_id, signal.SIGKILL)
            except (BridgeProtocolError, ProcessLookupError, PermissionError):
                pass
        self.attached_pid = None
        self.process_identity_sha256 = None
        self.client = None

    def __enter__(self) -> Self:
        return self

    def __exit__(self, *_: object) -> None:
        self.stop()


def process_identity_sha256(process_id: int) -> str:
    if process_id <= 0:
        raise BridgeProtocolError("Dolphin process ID must be positive")
    if os.name != "posix":
        raise BridgeProtocolError(
            "Live Dolphin process reattachment is currently supported on POSIX runners"
        )
    try:
        completed = subprocess.run(
            ["ps", "-p", str(process_id), "-o", "lstart=", "-o", "command="],
            check=False,
            capture_output=True,
            text=True,
            timeout=5,
        )
    except (OSError, subprocess.TimeoutExpired) as error:
        raise BridgeProtocolError(
            f"Unable to inspect Dolphin process: {error}"
        ) from error
    identity = completed.stdout.strip()
    if completed.returncode != 0 or not identity:
        raise BridgeProtocolError("The recorded Dolphin process is no longer running")
    return hashlib.sha256(identity.encode("utf-8")).hexdigest()
