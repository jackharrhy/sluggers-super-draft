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
from typing import Any, Protocol, Self, TypeVar

from starworks_runner.contracts import validate_contract
from starworks_runner.games.sluggers.boot import (
    BootNavigationResult,
    SluggersBootNavigator,
)
from starworks_runner.games.sluggers.bridge.client import BridgeClient
from starworks_runner.games.sluggers.bridge.configuration import (
    RuntimeConfigurationBlock,
    TeamSelection,
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
from starworks_runner.games.sluggers.errors import (
    BuildIntegrityError,
    DolphinLaunchError,
)
from starworks_runner.games.sluggers.game_observation import (
    GameSnapshot,
    SluggersMemoryReader,
)
from starworks_runner.games.sluggers.menu_observation import (
    MenuObservation,
    SluggersMenuObserver,
)
from starworks_runner.games.sluggers.setup_observation import (
    CaptainSelectionObservation,
    CpuLevelObservation,
    GameSettingObservation,
    MemberSelectionObservation,
    OrderSelectionObservation,
    SluggersSetupObserver,
)
from starworks_runner.games.sluggers.task_graph import (
    SluggersTaskGraphReader,
    TaskObservation,
)
from starworks_runner.games.sluggers.xfb import XfbFrameReader


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


FORMATION_SLOT_SIZE = 0x10
FORMATION_TEAM_SIZE = 9 * FORMATION_SLOT_SIZE
MEM2_START = 0x90000000
MEM2_END = 0x94000000

# Exact-RMBE01 runtime fields. MSS-AutoTeam supplied the rules/stadium/captain
# leads and Sluggers Stat Tracker supplied the two post-start team-order arrays
# (see PRIOR_ART.md). Starworks independently read each field back in Dolphin
# 2606 using the current DOL before treating it as an acceptance boundary.
RUNTIME_RULES_ADDRESS = 0x80794328
RUNTIME_STADIUM_ADDRESS = 0x811F769D
RUNTIME_CAPTAIN_BRANDS_ADDRESS = 0x811F76AC
RUNTIME_TEAM_ORDER_ADDRESSES = (0x8131B4B9, 0x8131B9B7)
RUNTIME_TEAM_ORDER_STRIDE = 0x8E
# These adjacent flags identify which order array is currently batting (0) or
# fielding (1); live reads are required to contain exactly one of each.
RUNTIME_TEAM_SIDE_FLAGS_ADDRESS = 0x900D5C22
# The nine active defender records are spaced 0x2EC bytes apart in the same
# Stat Tracker player-state family. Character ID is byte +2 in each record.
RUNTIME_DEFENDER_RECORD_ADDRESSES = tuple(
    0x900D9B45 + index * 0x2EC for index in range(9)
)
SetupObservation = TypeVar(
    "SetupObservation",
    CaptainSelectionObservation,
    CpuLevelObservation,
    MemberSelectionObservation,
    OrderSelectionObservation,
    GameSettingObservation,
)


def _formation_ids(value: bytes, offset: int) -> set[int]:
    return {value[offset + slot * FORMATION_SLOT_SIZE + 1] for slot in range(9)}


def _formation_positions(value: bytes, offset: int) -> set[int]:
    return {value[offset + slot * FORMATION_SLOT_SIZE + 12] for slot in range(9)}


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
        try:
            self.process_identity_sha256 = process_identity_sha256(
                self.launch.process.pid
            )
            if self.controller is not None:
                self.controller.connect(
                    timeout_seconds=timeout_seconds,
                    health_check=lambda: self._require_running_process(
                        "controller connection"
                    ),
                )
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
            if self.launch is not None:
                self.launch.require_running("memory transport attachment")
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

    def read_menu_observation(self) -> MenuObservation:
        if self.transport is None:
            raise BridgeProtocolError("Live Sluggers session is not started")
        return SluggersMenuObserver(self.transport).read()

    def wait_for_menu(
        self,
        predicate: Callable[[MenuObservation], bool],
        label: str,
        *,
        timeout_seconds: float = 10.0,
    ) -> MenuObservation:
        """Wait for one verified game-owned menu state while checking Dolphin."""

        if timeout_seconds <= 0:
            raise BridgeProtocolError("Menu wait timeout must be positive")
        deadline = time.monotonic() + timeout_seconds
        last: MenuObservation | None = None
        while True:
            self._require_running_process(f"menu wait: {label}")
            last = self.read_menu_observation()
            if predicate(last):
                return last
            if time.monotonic() >= deadline:
                raise BridgeProtocolError(
                    f"Dolphin did not reach {label} before timeout; last menu "
                    f"observation was {last}"
                )
            time.sleep(0.02)

    def wait_for_runtime_observation(
        self,
        predicate: Callable[[RuntimeGameObservation], bool],
        label: str,
        *,
        timeout_seconds: float = 10.0,
    ) -> RuntimeGameObservation:
        """Require a game-owned runtime value on two distinct bridge frames.

        The main-loop bridge reasserts immutable setup bytes once per frame,
        while a menu task can rewrite the same bytes later in that frame. A
        single asynchronous DME read can therefore land outside the bridge's
        write window. Two consecutive matching observations with advancing
        bridge heartbeats prove that the requested value is being reasserted;
        one lucky sub-frame sample is not sufficient.
        """

        if timeout_seconds <= 0:
            raise BridgeProtocolError("Runtime observation timeout must be positive")
        deadline = time.monotonic() + timeout_seconds
        matching_heartbeat: int | None = None
        last: RuntimeGameObservation | None = None
        while True:
            self._require_running_process(f"runtime observation: {label}")
            last = self.read_runtime_observation()
            heartbeat = self.read_control().heartbeat
            if predicate(last):
                if matching_heartbeat is not None and heartbeat > matching_heartbeat:
                    return last
                matching_heartbeat = heartbeat
            else:
                matching_heartbeat = None
            if time.monotonic() >= deadline:
                raise BridgeProtocolError(
                    f"Dolphin did not stably expose {label} before timeout; "
                    f"last runtime observation was {last}"
                )
            time.sleep(0.01)

    def read_task_graph(self) -> tuple[TaskObservation, ...]:
        if self.transport is None:
            raise BridgeProtocolError("Live Sluggers session is not started")
        return SluggersTaskGraphReader(self.transport).read()

    def wait_for_random_fill(
        self, *, timeout_seconds: float = 10.0
    ) -> MemberSelectionObservation:
        """Wait for the member screen's live-proven Random Fill boundary."""

        observer = self._setup_observer()
        return self._wait_for_setup(
            observer.read_member_selection,
            lambda observation: observation.is_random_fill_ready,
            "input-ready Random Fill",
            timeout_seconds=timeout_seconds,
        )

    def wait_for_captain_state(
        self, expected_state: int, *, timeout_seconds: float = 10.0
    ) -> CaptainSelectionObservation:
        """Wait for one exact captain-selection input boundary."""

        observer = self._setup_observer()
        return self._wait_for_setup(
            observer.read_captain_selection,
            lambda observation: observation.state == expected_state,
            f"captain state {expected_state}",
            timeout_seconds=timeout_seconds,
        )

    def wait_for_cpu_level(
        self,
        expected_selection: int | None = None,
        *,
        timeout_seconds: float = 10.0,
    ) -> CpuLevelObservation:
        """Wait for the CPU-level popup and optionally one exact selection."""

        observer = self._setup_observer()
        return self._wait_for_setup(
            observer.read_cpu_level,
            lambda observation: (
                observation.is_input_ready
                and (
                    expected_selection is None
                    or observation.selection == expected_selection
                )
            ),
            (
                "input-ready CPU level"
                if expected_selection is None
                else f"CPU level selection {expected_selection}"
            ),
            timeout_seconds=timeout_seconds,
        )

    def wait_for_order_next(
        self, *, timeout_seconds: float = 10.0
    ) -> OrderSelectionObservation:
        """Wait until the untouched batting-order screen highlights Next."""

        observer = self._setup_observer()
        return self._wait_for_setup(
            observer.read_order_selection,
            lambda observation: observation.is_next_ready,
            "input-ready order Next",
            timeout_seconds=timeout_seconds,
        )

    def wait_for_game_begin(
        self, *, timeout_seconds: float = 10.0
    ) -> GameSettingObservation:
        """Wait until the final game-setting screen accepts Begin."""

        observer = self._setup_observer()
        return self._wait_for_setup(
            observer.read_game_setting,
            lambda observation: observation.is_begin_ready,
            "input-ready game Begin",
            timeout_seconds=timeout_seconds,
        )

    def _setup_observer(self) -> SluggersSetupObserver:
        if self.transport is None:
            raise BridgeProtocolError("Live Sluggers session is not started")
        return SluggersSetupObserver(self.transport)

    def _wait_for_setup(
        self,
        read: Callable[[], SetupObservation | None],
        predicate: Callable[[SetupObservation], bool],
        label: str,
        *,
        timeout_seconds: float,
    ) -> SetupObservation:
        if timeout_seconds <= 0:
            raise BridgeProtocolError("Setup wait timeout must be positive")
        deadline = time.monotonic() + timeout_seconds
        last: SetupObservation | None = None
        while True:
            self._require_running_process(f"setup wait: {label}")
            last = read()
            if last is not None and predicate(last):
                return last
            if time.monotonic() >= deadline:
                raise BridgeProtocolError(
                    f"Dolphin did not reach {label} before timeout; "
                    f"last setup observation was {last}"
                )
            time.sleep(0.02)

    def read_runtime_observation(self) -> RuntimeGameObservation:
        if self.transport is None:
            raise BridgeProtocolError("Live Sluggers session is not started")
        rules = self.transport.read(RUNTIME_RULES_ADDRESS, 4)
        stadium = self.transport.read(RUNTIME_STADIUM_ADDRESS, 3)
        captains = self.transport.read(RUNTIME_CAPTAIN_BRANDS_ADDRESS, 2)
        return RuntimeGameObservation(
            rules=tuple(rules),  # type: ignore[arg-type]
            stadium_id=stadium[0],
            stadium_time=stadium[1],
            away_captain_brand_id=captains[0],
            home_captain_brand_id=captains[1],
        )

    def apply_final_formation(self, configuration: RuntimeConfigurationBlock) -> None:
        """Apply both immutable teams at the task-owned formation boundary.

        Random Fill is still the reliable way to make the game allocate and
        initialize both team buffers. The earlier selection hook replaces the
        roster sets, but Sluggers subsequently shuffles batting and fielding.
        This final DME write changes only the character and position bytes in
        the two initialized 9x16-byte buffers owned by the active
        COrderSelectTask, then reads them back before the runner advances.
        """

        if self.transport is None:
            raise BridgeProtocolError("Live Sluggers session is not started")
        order = self.wait_for_order_next()
        away_address = order.away_formation_address
        home_address = order.home_formation_address
        if not (
            MEM2_START <= away_address
            and home_address == away_address + FORMATION_TEAM_SIZE
            and home_address + FORMATION_TEAM_SIZE <= MEM2_END
        ):
            raise BridgeProtocolError(
                "COrderSelectTask formation pointers are invalid: "
                f"away=0x{away_address:08X}, home=0x{home_address:08X}"
            )
        if not self._formation_pair_matches(away_address, configuration):
            raise BridgeProtocolError(
                "COrderSelectTask formation buffers do not contain the scheduled rosters"
            )
        self._write_formation_team(away_address, configuration.away)
        self._write_formation_team(home_address, configuration.home)

    def _formation_pair_matches(
        self, away_address: int, configuration: RuntimeConfigurationBlock
    ) -> bool:
        assert self.transport is not None
        value = self.transport.read(away_address, FORMATION_TEAM_SIZE * 2)
        if len(value) != FORMATION_TEAM_SIZE * 2:
            raise BridgeProtocolError("Final formation pair read was short")
        return (
            _formation_ids(value, 0)
            == {entry[0] for entry in configuration.away.entries}
            and _formation_ids(value, FORMATION_TEAM_SIZE)
            == {entry[0] for entry in configuration.home.entries}
            and _formation_positions(value, 0) == set(range(9))
            and _formation_positions(value, FORMATION_TEAM_SIZE) == set(range(9))
        )

    def _write_formation_team(self, address: int, team: TeamSelection) -> None:
        assert self.transport is not None
        buffer = bytearray(self.transport.read(address, FORMATION_TEAM_SIZE))
        if len(buffer) != FORMATION_TEAM_SIZE:
            raise BridgeProtocolError("Final formation team buffer read was short")
        for game_id, batting_slot, fielding_position in team.entries:
            offset = batting_slot * FORMATION_SLOT_SIZE
            buffer[offset + 1] = game_id
            buffer[offset + 12] = fielding_position
        self.transport.write(address, bytes(buffer))
        observed = self.transport.read(address, FORMATION_TEAM_SIZE)
        for game_id, batting_slot, fielding_position in team.entries:
            offset = batting_slot * FORMATION_SLOT_SIZE
            if (
                observed[offset + 1] != game_id
                or observed[offset + 12] != fielding_position
            ):
                raise BridgeProtocolError(
                    "Dolphin did not retain the final formation buffer write"
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

        def read_team_order(address: int) -> tuple[int, ...]:
            return tuple(
                self.transport.read(address + index * RUNTIME_TEAM_ORDER_STRIDE, 1)[0]
                for index in range(9)
            )

        team_orders = tuple(
            read_team_order(address) for address in RUNTIME_TEAM_ORDER_ADDRESSES
        )
        team_states = tuple(self.transport.read(RUNTIME_TEAM_SIDE_FLAGS_ADDRESS, 2))
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
        return RuntimeLineupObservation(
            away_batting_order=away_order,
            home_batting_order=home_order,
            defense_side=defense_side,
            defense_by_position=tuple(
                self.transport.read(address + 2, 1)[0]
                for address in RUNTIME_DEFENDER_RECORD_ADDRESSES
            ),
        )

    def tap_button(self, button: str) -> None:
        if self.controller is None:
            raise BridgeProtocolError(
                "This runner platform has no automated Dolphin controller backend"
            )
        self.controller.tap(button)

    def navigate_cold_boot_to_main_menu(
        self,
        *,
        has_existing_save: bool,
        timeout_seconds: float = 60.0,
        diagnostic_directory: Path | None = None,
    ) -> BootNavigationResult:
        if self.controller is None or self.transport is None:
            raise BridgeProtocolError(
                "Cold-boot navigation requires live controller and DME connections"
            )
        return SluggersBootNavigator(
            frame_reader=XfbFrameReader(self.transport),
            controller=self.controller,
            has_existing_save=has_existing_save,
            menu_observer=SluggersMenuObserver(self.transport),
            health_check=lambda: self._require_running_process("cold-boot navigation"),
        ).navigate_to_main_menu(
            timeout_seconds=timeout_seconds,
            diagnostic_directory=diagnostic_directory,
        )

    def navigate_cold_boot_to_exhibition_stadium(
        self,
        *,
        has_existing_save: bool,
        timeout_seconds: float = 75.0,
        diagnostic_directory: Path | None = None,
    ) -> BootNavigationResult:
        """Reach the verified Exhibition stadium selector from a cold boot."""

        if self.controller is None or self.transport is None:
            raise BridgeProtocolError(
                "Cold-boot navigation requires live controller and DME connections"
            )
        return SluggersBootNavigator(
            frame_reader=XfbFrameReader(self.transport),
            controller=self.controller,
            has_existing_save=has_existing_save,
            menu_observer=SluggersMenuObserver(self.transport),
            health_check=lambda: self._require_running_process(
                "cold-boot Exhibition navigation"
            ),
        ).navigate_to_exhibition_stadium(
            timeout_seconds=timeout_seconds,
            diagnostic_directory=diagnostic_directory,
        )

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
        if self.launch is not None:
            self.launch.wait_for_native_capture_safety(timeout_seconds=timeout_seconds)
        return self.controller.capture_screenshot(
            timeout_seconds=timeout_seconds,
            health_check=lambda: self._require_running_process(
                "native screenshot capture"
            ),
        )

    def _require_running_process(self, stage: str) -> None:
        if self.launch is not None:
            self.launch.require_running(stage)
            return
        if not self.is_running:
            raise DolphinLaunchError(f"Dolphin exited during {stage}")

    def save_state_slot_one(self, *, timeout_seconds: float = 10.0) -> Path:
        if self.controller is None:
            raise BridgeProtocolError(
                "This runner platform has no native Dolphin save-state backend"
            )
        return self.controller.save_state_slot_one(timeout_seconds=timeout_seconds)

    def stop(self, *, timeout_seconds: float = 5.0) -> None:
        launch = self.launch
        process_id = self.attached_pid
        process_identity = self.process_identity_sha256
        self._release_connections()
        if launch is not None:
            process = launch.process
            if process.poll() is None:
                process.terminate()
                try:
                    process.wait(timeout=timeout_seconds)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait(timeout=timeout_seconds)
        elif process_id is not None and process_identity is not None:
            terminate_matching_process(
                process_id,
                process_identity,
                timeout_seconds=timeout_seconds,
            )
        self.launch = None
        self.attached_pid = None
        self.process_identity_sha256 = None

    def detach(self) -> None:
        """Release runner-owned handles without terminating live Dolphin."""

        if self.launch is not None:
            self.attached_pid = self.launch.process.pid
        self._release_connections()
        self.launch = None
        self.client = None

    def _release_connections(self) -> None:
        if self.controller is not None:
            self.controller.close()
        if self.transport is not None:
            self.transport.close()
            self.transport = None
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


def terminate_matching_process(
    process_id: int,
    expected_identity_sha256: str,
    *,
    timeout_seconds: float = 5.0,
) -> None:
    """Terminate only the exact persisted process owned by a lost attempt."""

    try:
        os.kill(process_id, 0)
    except ProcessLookupError:
        return
    except PermissionError as error:
        raise BridgeProtocolError(
            "The recorded Dolphin process cannot be inspected"
        ) from error
    try:
        actual_identity = process_identity_sha256(process_id)
    except BridgeProtocolError:
        try:
            os.kill(process_id, 0)
        except ProcessLookupError:
            return
        raise
    try:
        if actual_identity != expected_identity_sha256:
            raise BridgeProtocolError(
                "Running Dolphin process identity changed before teardown"
            )
        os.kill(process_id, signal.SIGTERM)
        deadline = time.monotonic() + timeout_seconds
        while time.monotonic() < deadline:
            try:
                process_identity_sha256(process_id)
            except BridgeProtocolError:
                return
            time.sleep(0.05)
        if process_identity_sha256(process_id) == expected_identity_sha256:
            os.kill(process_id, signal.SIGKILL)
    except ProcessLookupError:
        return
