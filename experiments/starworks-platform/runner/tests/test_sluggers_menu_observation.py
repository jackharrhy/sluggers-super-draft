from __future__ import annotations

from starworks_runner.games.sluggers.menu_observation import (
    FILE_SELECTION_ADDRESS,
    FILE_TASK_ADDRESS,
    FILE_TASK_DESCRIPTOR,
    MAIN_MODE_TASK_ADDRESS,
    MAIN_MODE_TASK_DESCRIPTOR,
    MAIN_SELECTION_ROOT_TASK_DESCRIPTOR,
    MAIN_STADIUM_CONFIRM_TASK_DESCRIPTOR,
    MAIN_STADIUM_TASK_DESCRIPTOR,
    OPENING_TASK_DESCRIPTOR,
    ROOT_TASK_ADDRESS,
    SELECT_TASK_DESCRIPTOR,
    MenuScene,
    SluggersMenuObserver,
)
from starworks_runner.games.sluggers.task_graph import TASK_MANAGER_POINTER_ADDRESS


class FakeMemory:
    def __init__(self) -> None:
        self.values: dict[tuple[int, int], bytes] = {}
        self.reads: list[tuple[int, int]] = []

    def read(self, address: int, size: int) -> bytes:
        self.reads.append((address, size))
        return self.values.get((address, size), bytes(size))


def task_header(descriptor: int, state_offset: int, state: int, size: int) -> bytes:
    value = bytearray(size)
    value[4:8] = descriptor.to_bytes(4, "big")
    value[state_offset] = state
    return bytes(value)


def install_registered_task(
    memory: FakeMemory, *, task_address: int, descriptor: int
) -> None:
    manager = 0x811F5718
    containers = 0x811F5B98
    wrapper = 0x811F6EAC
    node = 0x8120E238
    memory.values[(TASK_MANAGER_POINTER_ADDRESS, 4)] = manager.to_bytes(4, "big")
    manager_header = bytearray(0x24)
    manager_header[0x0C:0x10] = containers.to_bytes(4, "big")
    manager_header[0x10:0x14] = (1).to_bytes(4, "big")
    memory.values[(manager, 0x24)] = bytes(manager_header)
    memory.values[(containers + 8, 4)] = wrapper.to_bytes(4, "big")
    wrapper_header = bytearray(0x0C)
    wrapper_header[4:8] = (containers + 4).to_bytes(4, "big")
    wrapper_header[8:12] = node.to_bytes(4, "big")
    memory.values[(wrapper, 0x0C)] = bytes(wrapper_header)
    node_header = bytearray(0x20)
    node_header[0x14:0x18] = task_address.to_bytes(4, "big")
    memory.values[(node, 0x20)] = bytes(node_header)
    memory.values[(task_address, 8)] = task_header(descriptor, 0, 0, 8)


def test_observes_title_from_opening_task_state() -> None:
    memory = FakeMemory()
    memory.values[(ROOT_TASK_ADDRESS, 0x10)] = task_header(
        OPENING_TASK_DESCRIPTOR, 9, 6, 0x10
    )

    value = SluggersMenuObserver(memory).read()

    assert value.scene is MenuScene.TITLE
    assert value.root_state == 6
    assert memory.reads == [(ROOT_TASK_ADDRESS, 0x10)]


def test_observes_file_slot_from_game_owned_selection_word() -> None:
    memory = FakeMemory()
    memory.values[(ROOT_TASK_ADDRESS, 0x10)] = task_header(
        OPENING_TASK_DESCRIPTOR, 9, 9, 0x10
    )
    memory.values[(FILE_TASK_ADDRESS, 0x20)] = task_header(
        FILE_TASK_DESCRIPTOR, 0x1C, 6, 0x20
    )
    memory.values[(FILE_SELECTION_ADDRESS, 4)] = (0).to_bytes(4, "big", signed=True)

    value = SluggersMenuObserver(memory).read()

    assert value.scene is MenuScene.FILE_SELECT
    assert value.is_file_one_selected
    assert value.child_state == 6


def test_observes_file_action_without_pixel_classification() -> None:
    memory = FakeMemory()
    memory.values[(ROOT_TASK_ADDRESS, 0x10)] = task_header(
        OPENING_TASK_DESCRIPTOR, 9, 9, 0x10
    )
    memory.values[(FILE_TASK_ADDRESS, 0x20)] = task_header(
        FILE_TASK_DESCRIPTOR, 0x1C, 8, 0x20
    )

    value = SluggersMenuObserver(memory).read()

    assert value.scene is MenuScene.FILE_ACTION
    assert value.file_selection is None


def test_observes_main_mode_and_selected_mode() -> None:
    memory = FakeMemory()
    memory.values[(ROOT_TASK_ADDRESS, 0x10)] = task_header(
        SELECT_TASK_DESCRIPTOR, 0x0C, 7, 0x10
    )
    child = bytearray(task_header(MAIN_MODE_TASK_DESCRIPTOR, 0x1C, 4, 0x34))
    child[0x30:0x34] = (0).to_bytes(4, "big", signed=True)
    memory.values[(MAIN_MODE_TASK_ADDRESS, 0x34)] = bytes(child)

    value = SluggersMenuObserver(memory).read()

    assert value.scene is MenuScene.MAIN_MODE
    assert value.main_mode_selection == 0
    assert value.main_mode_result == 0
    assert value.child_state == 4
    assert value.is_main_mode_ready
    assert value.is_exhibition_selected


def test_distinguishes_stadium_task_reusing_main_selector_address() -> None:
    memory = FakeMemory()
    memory.values[(ROOT_TASK_ADDRESS, 0x10)] = task_header(
        SELECT_TASK_DESCRIPTOR, 0x0C, 7, 0x10
    )
    child = bytearray(task_header(MAIN_STADIUM_TASK_DESCRIPTOR, 0x21, 1, 0x34))
    child[0x1C:0x20] = (0).to_bytes(4, "big", signed=True)
    child[0x24:0x28] = (0).to_bytes(4, "big", signed=True)
    child[0x2C:0x30] = (2).to_bytes(4, "big", signed=True)
    child[0x30:0x34] = (3).to_bytes(4, "big", signed=True)
    memory.values[(MAIN_MODE_TASK_ADDRESS, 0x34)] = bytes(child)

    value = SluggersMenuObserver(memory).read()

    assert value.scene is MenuScene.STADIUM_SELECT
    assert value.child_descriptor == MAIN_STADIUM_TASK_DESCRIPTOR
    assert value.child_state == 1
    assert value.main_mode_selection is None
    assert value.stadium_previous_selection == 2
    assert value.stadium_selection == 3
    assert value.stadium_context == 0
    assert value.stadium_result == 0
    assert value.is_stadium_ready


def test_resolves_relocated_stadium_task_from_game_registry() -> None:
    memory = FakeMemory()
    memory.values[(ROOT_TASK_ADDRESS, 0x10)] = task_header(
        SELECT_TASK_DESCRIPTOR, 0x0C, 7, 0x10
    )
    memory.values[(MAIN_MODE_TASK_ADDRESS, 0x34)] = task_header(
        MAIN_SELECTION_ROOT_TASK_DESCRIPTOR, 0, 0, 0x34
    )
    relocated = 0x9032D03C
    install_registered_task(
        memory, task_address=relocated, descriptor=MAIN_STADIUM_TASK_DESCRIPTOR
    )
    child = bytearray(task_header(MAIN_STADIUM_TASK_DESCRIPTOR, 0x21, 1, 0x34))
    child[0x30:0x34] = (0).to_bytes(4, "big", signed=True)
    memory.values[(relocated, 0x34)] = bytes(child)

    value = SluggersMenuObserver(memory).read()

    assert value.is_stadium_ready
    assert value.stadium_selection == 0
    assert (relocated, 0x34) in memory.reads


def test_stadium_transition_is_not_reported_as_input_ready() -> None:
    memory = FakeMemory()
    memory.values[(ROOT_TASK_ADDRESS, 0x10)] = task_header(
        SELECT_TASK_DESCRIPTOR, 0x0C, 7, 0x10
    )
    child = bytearray(task_header(MAIN_STADIUM_TASK_DESCRIPTOR, 0x21, 2, 0x34))
    child[0x30:0x34] = (4).to_bytes(4, "big", signed=True)
    memory.values[(MAIN_MODE_TASK_ADDRESS, 0x34)] = bytes(child)

    value = SluggersMenuObserver(memory).read()

    assert value.scene is MenuScene.STADIUM_SELECT
    assert value.stadium_selection == 4
    assert not value.is_stadium_ready


def test_observes_ready_stadium_confirmation_panel() -> None:
    memory = FakeMemory()
    memory.values[(ROOT_TASK_ADDRESS, 0x10)] = task_header(
        SELECT_TASK_DESCRIPTOR, 0x0C, 7, 0x10
    )
    child = bytearray(task_header(MAIN_STADIUM_CONFIRM_TASK_DESCRIPTOR, 0x19, 2, 0x34))
    child[0x2C:0x30] = (0).to_bytes(4, "big", signed=True)
    memory.values[(MAIN_MODE_TASK_ADDRESS, 0x34)] = bytes(child)

    value = SluggersMenuObserver(memory).read()

    assert value.scene is MenuScene.STADIUM_CONFIRM
    assert value.child_state == 2
    assert value.stadium_confirmation_selection == 0
    assert value.is_stadium_confirmation_ready


def test_unknown_task_fails_closed_as_unknown_scene() -> None:
    memory = FakeMemory()
    memory.values[(ROOT_TASK_ADDRESS, 0x10)] = task_header(0xDEADBEEF, 9, 0xFF, 0x10)

    value = SluggersMenuObserver(memory).read()

    assert value.scene is MenuScene.UNKNOWN
    assert value.root_state is None
