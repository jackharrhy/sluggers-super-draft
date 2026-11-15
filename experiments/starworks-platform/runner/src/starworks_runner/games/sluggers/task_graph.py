from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol

from starworks_runner.games.sluggers.bridge.layout import BridgeProtocolError


class MemoryReader(Protocol):
    def read(self, address: int, size: int) -> bytes: ...


# r13 (0x807961C0) - 0x72C. The word points to NpLib's task manager. The
# container/node derivation and exact-DOL provenance are documented in
# docs/game-adapter/menu-observation.md.
TASK_MANAGER_POINTER_ADDRESS = 0x80795A94
MAX_TASK_CONTAINERS = 16
MAX_TASKS_PER_CONTAINER = 64
MAX_TASK_CLASS_NAME_BYTES = 64


TASK_NAMES = {
    0x806CC8E8: "Opening::COpeningTask",
    0x806CC870: "Opening::COpMovieTask",
    0x806DA010: "Opening::CTitleTask",
    0x806A2640: "Opening::CFileSelTask",
    0x806D7E98: "Select::CSelectTask",
    0x806BEF60: "Select::CMainSelRootTask",
    0x806BEE58: "Select::CMainSelModeTask",
    0x806BF350: "Select::CMainSelStadiumTask",
    0x806BF1D0: "Select::CMainSelSetumeiTask",
    0x806A1E40: "Select::CExhiCaptainTask",
    0x806A1EB0: "Select::CExhiMainTask",
    0x8063B1A8: "Select::CMemberSelectTask",
    0x8063C208: "Select::COrderSelectTask",
    0x8063CAB0: "Select::CGameSettingTask",
    0x806D37B0: "popup_menu::CMenuPopUpTask",
    0x806DE3F8: "Select::CTrainingMainTask",
    0x806C8730: "Select::CMiniMainTask",
    0x8065DF30: "Select::CChalMainTask",
    0x806D52D0: "Select::CRecordMainTask",
    0x806B92F8: "Select::CGpMainTask",
}


@dataclass(frozen=True)
class TaskObservation:
    container_index: int
    node_address: int
    task_address: int
    descriptor: int
    name: str | None
    active: bool
    parent_node: int
    first_child_node: int
    next_sibling_node: int
    result: int


class SluggersTaskGraphReader:
    """Traverse the game's own bounded task registry without scanning RAM."""

    def __init__(self, transport: MemoryReader) -> None:
        self.transport = transport

    def read(self) -> tuple[TaskObservation, ...]:
        manager = self._pointer_at(TASK_MANAGER_POINTER_ADDRESS, "task manager pointer")
        header = self._read(manager, 0x24, "task manager")
        container_count = int.from_bytes(header[0x10:0x14], "big")
        if container_count > MAX_TASK_CONTAINERS:
            raise BridgeProtocolError(
                f"Sluggers task manager container count is invalid: {container_count}"
            )
        if container_count == 0:
            containers = (manager,)
        else:
            base = int.from_bytes(header[0x0C:0x10], "big")
            self._require_pointer(base, container_count * 0x0C, "task containers")
            containers = tuple(base + index * 0x0C for index in range(container_count))

        tasks: list[TaskObservation] = []
        for container_index, container in enumerate(containers):
            sentinel = container + 4
            wrapper = self._pointer_at(container + 8, "task-list head", allow=sentinel)
            visited: set[int] = set()
            while wrapper != sentinel:
                if wrapper in visited or len(visited) >= MAX_TASKS_PER_CONTAINER:
                    raise BridgeProtocolError(
                        "Sluggers task list is cyclic or too large"
                    )
                visited.add(wrapper)
                wrapper_header = self._read(wrapper, 0x0C, "task-list entry")
                next_wrapper = int.from_bytes(wrapper_header[4:8], "big")
                self._require_pointer(
                    next_wrapper, 1, "next task-list entry", allow=sentinel
                )
                node = int.from_bytes(wrapper_header[8:12], "big")
                self._require_pointer(node, 0x20, "task node")
                node_header = self._read(node, 0x20, "task node")
                task = int.from_bytes(node_header[0x14:0x18], "big")
                self._require_pointer(task, 8, "task object")
                task_header = self._read(task, 8, "task object")
                descriptor = int.from_bytes(task_header[4:8], "big")
                name = TASK_NAMES.get(descriptor)
                if name is None:
                    name = self._class_name(descriptor)
                tasks.append(
                    TaskObservation(
                        container_index=container_index,
                        node_address=node,
                        task_address=task,
                        descriptor=descriptor,
                        name=name,
                        active=task_header[0] == 0,
                        parent_node=int.from_bytes(node_header[8:12], "big"),
                        first_child_node=int.from_bytes(node_header[12:16], "big"),
                        next_sibling_node=int.from_bytes(node_header[16:20], "big"),
                        result=int.from_bytes(node_header[0x1C:0x20], "big"),
                    )
                )
                wrapper = next_wrapper
        return tuple(tasks)

    def _class_name(self, descriptor: int) -> str | None:
        """Decode the exact-DOL task name embedded in its class descriptor.

        Sluggers task descriptors store the update function at +0x08 and a
        NUL-terminated class name at +0x10. Known names remain catalogued as
        guards; this fallback makes later setup tasks self-describing without
        adding a new hard-coded address for every class.
        """

        self._require_pointer(
            descriptor,
            0x10 + MAX_TASK_CLASS_NAME_BYTES,
            "task class descriptor",
        )
        raw = self._read(
            descriptor + 0x10,
            MAX_TASK_CLASS_NAME_BYTES,
            "task class name",
        )
        encoded = raw.split(b"\0", 1)[0]
        if not encoded or any(value < 0x20 or value > 0x7E for value in encoded):
            return None
        return encoded.decode("ascii")

    def _pointer_at(self, address: int, label: str, *, allow: int | None = None) -> int:
        value = int.from_bytes(self._read(address, 4, label), "big")
        self._require_pointer(value, 1, label, allow=allow)
        return value

    def _require_pointer(
        self, address: int, size: int, label: str, *, allow: int | None = None
    ) -> None:
        if address == allow:
            return
        end = address + size
        if not (
            0x80000000 <= address < end <= 0x81800000
            or 0x90000000 <= address < end <= 0x94000000
        ):
            raise BridgeProtocolError(
                f"Sluggers {label} is not in Wii RAM: 0x{address:08X}"
            )

    def _read(self, address: int, size: int, label: str) -> bytes:
        value = self.transport.read(address, size)
        if len(value) != size:
            raise BridgeProtocolError(f"Sluggers {label} read was short")
        return value
