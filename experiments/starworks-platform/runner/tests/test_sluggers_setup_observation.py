from __future__ import annotations

import pytest
from starworks_runner.games.sluggers.bridge.layout import BridgeProtocolError
from starworks_runner.games.sluggers.setup_observation import (
    CAPTAIN_STATE_OFFSET,
    CAPTAIN_TASK_ADDRESS,
    CAPTAIN_TASK_DESCRIPTOR,
    CPU_LEVEL_SELECTION_OFFSET,
    CPU_LEVEL_STATE_OFFSET,
    CPU_LEVEL_TASK_DESCRIPTOR,
    GAME_SETTING_STATE_OFFSET,
    GAME_SETTING_TASK_DESCRIPTOR,
    MEMBER_SELECTION_CURSOR_OFFSET,
    MEMBER_SELECTION_STATE_OFFSET,
    MEMBER_SELECTION_TASK_DESCRIPTOR,
    ORDER_AWAY_FORMATION_POINTER_OFFSET,
    ORDER_HOME_FORMATION_POINTER_OFFSET,
    ORDER_SELECTION_STATE_OFFSET,
    ORDER_SELECTION_TASK_DESCRIPTOR,
    SluggersSetupObserver,
)
from starworks_runner.games.sluggers.task_graph import TASK_MANAGER_POINTER_ADDRESS


class FakeMemory:
    def __init__(self) -> None:
        self.values: dict[tuple[int, int], bytes] = {}

    def read(self, address: int, size: int) -> bytes:
        return self.values.get((address, size), bytes(size))


def register_task(
    memory: FakeMemory, *, task: int, descriptor: int, active: bool = True
) -> None:
    manager = 0x811F5718
    wrapper = 0x811F6EAC
    node = 0x8120E238
    memory.values[(TASK_MANAGER_POINTER_ADDRESS, 4)] = manager.to_bytes(4, "big")
    memory.values[(manager, 0x24)] = bytes(0x24)
    memory.values[(manager + 8, 4)] = wrapper.to_bytes(4, "big")
    wrapper_header = bytearray(0x0C)
    wrapper_header[4:8] = (manager + 4).to_bytes(4, "big")
    wrapper_header[8:12] = node.to_bytes(4, "big")
    memory.values[(wrapper, 0x0C)] = bytes(wrapper_header)
    node_header = bytearray(0x20)
    node_header[0x14:0x18] = task.to_bytes(4, "big")
    memory.values[(node, 0x20)] = bytes(node_header)
    task_header = bytearray(8)
    task_header[0] = 0 if active else 1
    task_header[4:8] = descriptor.to_bytes(4, "big")
    memory.values[(task, 8)] = bytes(task_header)


def test_observes_the_live_proven_random_fill_boundary() -> None:
    memory = FakeMemory()
    task = 0x9032A9B4
    register_task(memory, task=task, descriptor=MEMBER_SELECTION_TASK_DESCRIPTOR)
    memory.values[(task + MEMBER_SELECTION_STATE_OFFSET, 1)] = bytes((2,))
    memory.values[(task + MEMBER_SELECTION_CURSOR_OFFSET, 1)] = bytes((0xFF,))

    observation = SluggersSetupObserver(memory).read_member_selection()

    assert observation is not None
    assert observation.task_address == task
    assert observation.is_random_fill_ready


def test_observes_captain_and_cpu_level_boundaries() -> None:
    captain_memory = FakeMemory()
    captain = bytearray(CAPTAIN_STATE_OFFSET + 1)
    captain[4:8] = CAPTAIN_TASK_DESCRIPTOR.to_bytes(4, "big")
    captain[CAPTAIN_STATE_OFFSET] = 2
    captain_memory.values[(CAPTAIN_TASK_ADDRESS, len(captain))] = bytes(captain)

    captain_observation = SluggersSetupObserver(captain_memory).read_captain_selection()

    assert captain_observation is not None
    assert captain_observation.state == 2

    cpu_memory = FakeMemory()
    cpu_task = 0x910E1FA0
    register_task(
        cpu_memory,
        task=cpu_task,
        descriptor=CPU_LEVEL_TASK_DESCRIPTOR,
    )
    cpu_memory.values[(cpu_task + CPU_LEVEL_STATE_OFFSET, 1)] = bytes((2,))
    cpu_memory.values[(cpu_task + CPU_LEVEL_SELECTION_OFFSET, 4)] = (3).to_bytes(
        4, "big", signed=True
    )

    cpu_observation = SluggersSetupObserver(cpu_memory).read_cpu_level()

    assert cpu_observation is not None
    assert cpu_observation.is_input_ready
    assert cpu_observation.selection == 3


@pytest.mark.parametrize("state,cursor", [(1, 0xFF), (2, 13)])
def test_does_not_claim_other_member_states_are_random_fill(
    state: int, cursor: int
) -> None:
    memory = FakeMemory()
    task = 0x9032A9B4
    register_task(memory, task=task, descriptor=MEMBER_SELECTION_TASK_DESCRIPTOR)
    memory.values[(task + MEMBER_SELECTION_STATE_OFFSET, 1)] = bytes((state,))
    memory.values[(task + MEMBER_SELECTION_CURSOR_OFFSET, 1)] = bytes((cursor,))

    observation = SluggersSetupObserver(memory).read_member_selection()

    assert observation is not None
    assert not observation.is_random_fill_ready


def test_ignores_an_inactive_member_task() -> None:
    memory = FakeMemory()
    register_task(
        memory,
        task=0x9032A9B4,
        descriptor=MEMBER_SELECTION_TASK_DESCRIPTOR,
        active=False,
    )

    assert SluggersSetupObserver(memory).read_member_selection() is None


def test_rejects_a_short_member_state_read() -> None:
    class ShortMemory(FakeMemory):
        def read(self, address: int, size: int) -> bytes:
            if address == 0x9032A9B4 + MEMBER_SELECTION_STATE_OFFSET:
                return b""
            return super().read(address, size)

    memory = ShortMemory()
    register_task(
        memory,
        task=0x9032A9B4,
        descriptor=MEMBER_SELECTION_TASK_DESCRIPTOR,
    )

    with pytest.raises(BridgeProtocolError, match="state read was short"):
        SluggersSetupObserver(memory).read_member_selection()


def test_observes_order_next_and_game_begin_ready_states() -> None:
    order_memory = FakeMemory()
    order_task = 0x9032A9B4
    register_task(
        order_memory,
        task=order_task,
        descriptor=ORDER_SELECTION_TASK_DESCRIPTOR,
    )
    order_memory.values[(order_task + ORDER_SELECTION_STATE_OFFSET, 1)] = bytes((5,))
    order_memory.values[(order_task + ORDER_AWAY_FORMATION_POINTER_OFFSET, 4)] = (
        0x9032CF3C
    ).to_bytes(4, "big")
    order_memory.values[(order_task + ORDER_HOME_FORMATION_POINTER_OFFSET, 4)] = (
        0x9032CFCC
    ).to_bytes(4, "big")

    order = SluggersSetupObserver(order_memory).read_order_selection()

    assert order is not None
    assert order.is_next_ready
    assert order.away_formation_address == 0x9032CF3C
    assert order.home_formation_address == 0x9032CFCC

    setting_memory = FakeMemory()
    setting_task = 0x9032A9B4
    register_task(
        setting_memory,
        task=setting_task,
        descriptor=GAME_SETTING_TASK_DESCRIPTOR,
    )
    setting_memory.values[(setting_task + GAME_SETTING_STATE_OFFSET, 1)] = bytes((2,))

    setting = SluggersSetupObserver(setting_memory).read_game_setting()

    assert setting is not None
    assert setting.is_begin_ready
