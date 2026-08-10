from __future__ import annotations

import importlib
from typing import Any, Protocol

from starworks_runner.games.sluggers.bridge.layout import (
    BridgeLayout,
    BridgeProtocolError,
)


class MemoryTransport(Protocol):
    def read(self, address: int, size: int) -> bytes: ...

    def write(self, address: int, value: bytes) -> None: ...


class BridgeMemory:
    """Bounds-check every emulator-memory operation against one reservation."""

    def __init__(self, transport: MemoryTransport, layout: BridgeLayout) -> None:
        self._transport = transport
        self.layout = layout

    def read(self, address: int, size: int) -> bytes:
        self.layout.require_range(address, size)
        value = self._transport.read(address, size)
        if len(value) != size:
            raise BridgeProtocolError(
                f"Short emulator-memory read: requested {size}, received {len(value)}"
            )
        return value

    def write(self, address: int, value: bytes) -> None:
        self.layout.require_range(address, len(value))
        self._transport.write(address, value)


class ByteArrayMemoryTransport:
    """Deterministic in-process transport used by protocol and recovery tests."""

    def __init__(self, layout: BridgeLayout) -> None:
        self.layout = layout
        self.data = bytearray(layout.region_size)

    def read(self, address: int, size: int) -> bytes:
        offset = address - self.layout.base_address
        if offset < 0 or offset + size > len(self.data):
            raise BridgeProtocolError(
                "Synthetic transport read outside allocated memory"
            )
        return bytes(self.data[offset : offset + size])

    def write(self, address: int, value: bytes) -> None:
        offset = address - self.layout.base_address
        if offset < 0 or offset + len(value) > len(self.data):
            raise BridgeProtocolError(
                "Synthetic transport write outside allocated memory"
            )
        self.data[offset : offset + len(value)] = value


class DolphinMemoryEngineTransport:
    """Optional Windows/Linux DME backend kept behind the adapter boundary."""

    def __init__(self, backend: Any | None = None) -> None:
        if backend is None:
            try:
                backend = importlib.import_module("dolphin_memory_engine")
            except ImportError as error:
                raise BridgeProtocolError(
                    "dolphin-memory-engine 1.3.1 is not installed; reinstall the "
                    "Starworks runner for this platform"
                ) from error
        self._backend = backend

    def attach(self) -> None:
        try:
            if not self._backend.is_hooked():
                self._backend.hook()
            attached = self._backend.is_hooked()
        except Exception as error:
            raise BridgeProtocolError(f"Dolphin attach failed: {error}") from error
        if not attached:
            raise BridgeProtocolError(
                "No compatible running Dolphin process with an active Wii game was found"
            )

    def read(self, address: int, size: int) -> bytes:
        try:
            return bytes(self._backend.read_bytes(address, size))
        except Exception as error:
            raise BridgeProtocolError(
                f"Dolphin memory read failed at 0x{address:08X}: {error}"
            ) from error

    def write(self, address: int, value: bytes) -> None:
        try:
            self._backend.write_bytes(address, value)
        except Exception as error:
            raise BridgeProtocolError(
                f"Dolphin memory write failed at 0x{address:08X}: {error}"
            ) from error
