from __future__ import annotations

import pytest
from starworks_runner.games.sluggers.bridge.layout import BridgeProtocolError
from starworks_runner.games.sluggers.task_graph import (
    TASK_MANAGER_POINTER_ADDRESS,
    SluggersTaskGraphReader,
)


class FakeMemory:
    def __init__(self) -> None:
        self.values: dict[tuple[int, int], bytes] = {}

    def read(self, address: int, size: int) -> bytes:
        return self.values.get((address, size), bytes(size))


def test_reads_registered_tasks_from_game_owned_container() -> None:
    memory = FakeMemory()
    manager = 0x811F5718
    containers = 0x811F5B98
    wrapper = 0x811F6EAC
    node = 0x8120E238
    task = 0x9032CF14
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
    node_header[0x14:0x18] = task.to_bytes(4, "big")
    node_header[0x1C:0x20] = (2).to_bytes(4, "big")
    memory.values[(node, 0x20)] = bytes(node_header)
    task_header = bytearray(8)
    task_header[4:8] = (0x806BEE58).to_bytes(4, "big")
    memory.values[(task, 8)] = bytes(task_header)

    tasks = SluggersTaskGraphReader(memory).read()

    assert len(tasks) == 1
    assert tasks[0].task_address == task
    assert tasks[0].name == "Select::CMainSelModeTask"
    assert tasks[0].active
    assert tasks[0].result == 2


def test_rejects_corrupt_task_manager_pointer() -> None:
    memory = FakeMemory()
    memory.values[(TASK_MANAGER_POINTER_ADDRESS, 4)] = (0x1234).to_bytes(4, "big")

    with pytest.raises(BridgeProtocolError, match="not in Wii RAM"):
        SluggersTaskGraphReader(memory).read()


def test_decodes_uncatalogued_class_name_from_task_descriptor() -> None:
    memory = FakeMemory()
    manager = 0x811F5718
    wrapper = 0x811F6EAC
    node = 0x8120E238
    task = 0x9032D000
    descriptor = 0x806A2000
    memory.values[(TASK_MANAGER_POINTER_ADDRESS, 4)] = manager.to_bytes(4, "big")
    manager_header = bytearray(0x24)
    memory.values[(manager, 0x24)] = bytes(manager_header)
    memory.values[(manager + 8, 4)] = wrapper.to_bytes(4, "big")
    wrapper_header = bytearray(0x0C)
    wrapper_header[4:8] = (manager + 4).to_bytes(4, "big")
    wrapper_header[8:12] = node.to_bytes(4, "big")
    memory.values[(wrapper, 0x0C)] = bytes(wrapper_header)
    node_header = bytearray(0x20)
    node_header[0x14:0x18] = task.to_bytes(4, "big")
    memory.values[(node, 0x20)] = bytes(node_header)
    task_header = bytearray(8)
    task_header[4:8] = descriptor.to_bytes(4, "big")
    memory.values[(task, 8)] = bytes(task_header)
    class_name = bytearray(64)
    class_name[: len(b"Select::CExhiMemOrdTask")] = b"Select::CExhiMemOrdTask"
    memory.values[(descriptor + 0x10, 64)] = bytes(class_name)

    tasks = SluggersTaskGraphReader(memory).read()

    assert tasks[0].name == "Select::CExhiMemOrdTask"
