from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol

from starworks_runner.games.sluggers.bridge.layout import BridgeProtocolError
from starworks_runner.games.sluggers.task_graph import SluggersTaskGraphReader


class MemoryReader(Protocol):
    def read(self, address: int, size: int) -> bytes: ...


# Exact RMBE01 Rev 0 setup metadata. Each descriptor embeds the update
# function documented in docs/game-adapter/menu-observation.md. Live checkpoint
# runs paired these fields with the rendered screen once for labelling, then
# proved every production transition through task state and bridge receipts.
CAPTAIN_TASK_ADDRESS = 0x9032CF14
CAPTAIN_TASK_DESCRIPTOR = 0x806A1E40
CAPTAIN_STATE_OFFSET = 0x18
CPU_LEVEL_TASK_DESCRIPTOR = 0x806D37B0
CPU_LEVEL_STATE_OFFSET = 0x88
CPU_LEVEL_SELECTION_OFFSET = 0x9C
CPU_LEVEL_4_SELECTION = 3
MEMBER_SELECTION_TASK_DESCRIPTOR = 0x8063B1A8
MEMBER_SELECTION_STATE_OFFSET = 0x231
MEMBER_SELECTION_CURSOR_OFFSET = 0x36B
ORDER_SELECTION_TASK_DESCRIPTOR = 0x8063C208
ORDER_SELECTION_STATE_OFFSET = 0xB8
# COrderSelectTask::update at 0x80080010 loads these two fields before calling
# the formation helpers at 0x8006AEA4 and 0x80069CC0. Live DME inspection at
# state 5 proved that they point to the adjacent away/home 9x16-byte buffers.
# This replaces MSS-AutoTeam's useful but path-dependent 0x806D121E global
# pointer lead and Starworks' former whole-MEM2 discovery scan.
ORDER_AWAY_FORMATION_POINTER_OFFSET = 0xC0
ORDER_HOME_FORMATION_POINTER_OFFSET = 0xC4
GAME_SETTING_TASK_DESCRIPTOR = 0x8063CAB0
GAME_SETTING_STATE_OFFSET = 0x25


@dataclass(frozen=True)
class MemberSelectionObservation:
    task_address: int
    state: int
    cursor: int

    @property
    def is_random_fill_ready(self) -> bool:
        return self.state == 2 and self.cursor == 0xFF


@dataclass(frozen=True)
class CaptainSelectionObservation:
    task_address: int
    state: int


@dataclass(frozen=True)
class CpuLevelObservation:
    task_address: int
    state: int
    selection: int

    @property
    def is_input_ready(self) -> bool:
        return self.state == 2


@dataclass(frozen=True)
class OrderSelectionObservation:
    task_address: int
    state: int
    away_formation_address: int
    home_formation_address: int

    @property
    def is_next_ready(self) -> bool:
        # State 5 is the interactive order screen. With no intervening input,
        # the game opens it on the yellow Next button; A was live-proven to
        # advance to CGameSettingTask. Directional input leaves that button.
        return self.state == 5


@dataclass(frozen=True)
class GameSettingObservation:
    task_address: int
    state: int

    @property
    def is_begin_ready(self) -> bool:
        return self.state == 2


class SluggersSetupObserver:
    """Observe the proven Exhibition setup boundary from game-owned state."""

    def __init__(self, transport: MemoryReader) -> None:
        self.transport = transport

    def read_captain_selection(self) -> CaptainSelectionObservation | None:
        # CExhiCaptainTask owns the anchor while its registered display child
        # handles rendering. The descriptor guard is mandatory because several
        # selection tasks reuse this address.
        header = self._read(CAPTAIN_TASK_ADDRESS, CAPTAIN_STATE_OFFSET + 1)
        descriptor = int.from_bytes(header[4:8], "big")
        if descriptor != CAPTAIN_TASK_DESCRIPTOR:
            return None
        return CaptainSelectionObservation(
            task_address=CAPTAIN_TASK_ADDRESS,
            state=header[CAPTAIN_STATE_OFFSET],
        )

    def read_cpu_level(self) -> CpuLevelObservation | None:
        task_address = self._active_task(CPU_LEVEL_TASK_DESCRIPTOR, "CPU-level")
        if task_address is None:
            return None
        return CpuLevelObservation(
            task_address=task_address,
            state=self._byte(
                task_address + CPU_LEVEL_STATE_OFFSET,
                "CPU-level state",
            ),
            selection=int.from_bytes(
                self._read(task_address + CPU_LEVEL_SELECTION_OFFSET, 4),
                "big",
                signed=True,
            ),
        )

    def read_member_selection(self) -> MemberSelectionObservation | None:
        task_address = self._active_task(
            MEMBER_SELECTION_TASK_DESCRIPTOR, "member-selection"
        )
        if task_address is None:
            return None
        state = self._byte(task_address + MEMBER_SELECTION_STATE_OFFSET, "state")
        cursor = self._byte(task_address + MEMBER_SELECTION_CURSOR_OFFSET, "cursor")
        return MemberSelectionObservation(
            task_address=task_address,
            state=state,
            cursor=cursor,
        )

    def read_order_selection(self) -> OrderSelectionObservation | None:
        task_address = self._active_task(
            ORDER_SELECTION_TASK_DESCRIPTOR, "order-selection"
        )
        if task_address is None:
            return None
        return OrderSelectionObservation(
            task_address=task_address,
            state=self._byte(
                task_address + ORDER_SELECTION_STATE_OFFSET,
                "order-selection state",
            ),
            away_formation_address=int.from_bytes(
                self._read(
                    task_address + ORDER_AWAY_FORMATION_POINTER_OFFSET,
                    4,
                    "order-selection away formation pointer",
                ),
                "big",
            ),
            home_formation_address=int.from_bytes(
                self._read(
                    task_address + ORDER_HOME_FORMATION_POINTER_OFFSET,
                    4,
                    "order-selection home formation pointer",
                ),
                "big",
            ),
        )

    def read_game_setting(self) -> GameSettingObservation | None:
        task_address = self._active_task(GAME_SETTING_TASK_DESCRIPTOR, "game-setting")
        if task_address is None:
            return None
        return GameSettingObservation(
            task_address=task_address,
            state=self._byte(
                task_address + GAME_SETTING_STATE_OFFSET,
                "game-setting state",
            ),
        )

    def _active_task(self, descriptor: int, label: str) -> int | None:
        matches = [
            task
            for task in SluggersTaskGraphReader(self.transport).read()
            if task.active and task.descriptor == descriptor
        ]
        if len(matches) > 1:
            addresses = ", ".join(f"0x{task.task_address:08X}" for task in matches)
            raise BridgeProtocolError(
                f"Sluggers registered multiple active {label} tasks: {addresses}"
            )
        return matches[0].task_address if matches else None

    def _byte(self, address: int, label: str) -> int:
        return self._read(address, 1, label=label)[0]

    def _read(self, address: int, size: int, label: str = "object") -> bytes:
        value = self.transport.read(address, size)
        if len(value) != size:
            raise BridgeProtocolError(f"Sluggers setup {label} read was short")
        return value
