from __future__ import annotations

import importlib
import socket
import time
from collections import deque
from pathlib import Path
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


class GdbRemoteMemoryTransport:
    """Cross-platform transport over Dolphin's built-in GDB remote stub."""

    _MAX_TRANSFER_BYTES = 4096

    def __init__(
        self,
        *,
        socket_path: Path | None = None,
        host: str | None = None,
        port: int | None = None,
        timeout_seconds: float = 5.0,
        connection: socket.socket | None = None,
    ) -> None:
        if connection is None and (socket_path is None) == (host is None):
            raise BridgeProtocolError(
                "Choose exactly one Dolphin GDB endpoint: socket_path or host/port"
            )
        if host is not None and port is None:
            raise BridgeProtocolError("A Dolphin GDB TCP host requires a port")
        if timeout_seconds <= 0:
            raise BridgeProtocolError("Dolphin GDB timeout must be positive")
        self.socket_path = socket_path.expanduser().resolve() if socket_path else None
        self.host = host
        self.port = port
        self.timeout_seconds = timeout_seconds
        self._socket = connection
        self._pending_stop_replies: deque[bytes] = deque()

    def attach(self) -> None:
        if self._socket is not None:
            return
        deadline = time.monotonic() + self.timeout_seconds
        last_error: OSError | None = None
        while time.monotonic() < deadline:
            family = socket.AF_UNIX if self.socket_path else socket.AF_INET
            candidate = socket.socket(family, socket.SOCK_STREAM)
            candidate.settimeout(min(0.25, max(0.01, deadline - time.monotonic())))
            endpoint: str | tuple[str, int]
            if self.socket_path is not None:
                endpoint = str(self.socket_path)
            else:
                assert self.host is not None and self.port is not None
                endpoint = (self.host, self.port)
            try:
                candidate.connect(endpoint)
                candidate.settimeout(self.timeout_seconds)
                self._socket = candidate
                supported = self._request(b"qSupported")
                if b"swbreak+" not in supported:
                    raise BridgeProtocolError(
                        "Dolphin GDB endpoint did not identify its supported protocol"
                    )
                return
            except (OSError, BridgeProtocolError) as error:
                candidate.close()
                if isinstance(error, OSError):
                    last_error = error
                else:
                    raise
                time.sleep(min(0.05, max(0, deadline - time.monotonic())))
        detail = f": {last_error}" if last_error else ""
        raise BridgeProtocolError(
            f"Timed out connecting to Dolphin's GDB endpoint{detail}"
        )

    def close(self) -> None:
        if self._socket is not None:
            self._socket.close()
            self._socket = None

    def read(self, address: int, size: int) -> bytes:
        if address < 0 or address > 0xFFFFFFFF or size < 0:
            raise BridgeProtocolError("Dolphin GDB memory read range is invalid")
        result = bytearray()
        while len(result) < size:
            chunk_size = min(self._MAX_TRANSFER_BYTES, size - len(result))
            chunk_address = address + len(result)
            reply = self._request(f"m{chunk_address:x},{chunk_size:x}".encode("ascii"))
            if reply.startswith(b"E"):
                raise BridgeProtocolError(
                    f"Dolphin GDB memory read failed at 0x{chunk_address:08X}: "
                    f"{reply.decode('ascii', errors='replace')}"
                )
            try:
                chunk = bytes.fromhex(reply.decode("ascii"))
            except (UnicodeDecodeError, ValueError) as error:
                raise BridgeProtocolError(
                    "Dolphin GDB returned malformed memory bytes"
                ) from error
            if len(chunk) != chunk_size:
                raise BridgeProtocolError(
                    f"Dolphin GDB memory read was short: expected {chunk_size}, "
                    f"received {len(chunk)}"
                )
            result.extend(chunk)
        return bytes(result)

    def write(self, address: int, value: bytes) -> None:
        if address < 0 or address > 0xFFFFFFFF:
            raise BridgeProtocolError("Dolphin GDB memory write address is invalid")
        for offset in range(0, len(value), self._MAX_TRANSFER_BYTES):
            chunk = value[offset : offset + self._MAX_TRANSFER_BYTES]
            chunk_address = address + offset
            reply = self._request(
                f"M{chunk_address:x},{len(chunk):x}:".encode("ascii")
                + chunk.hex().encode()
            )
            if reply != b"OK":
                raise BridgeProtocolError(
                    f"Dolphin GDB memory write failed at 0x{chunk_address:08X}: "
                    f"{reply.decode('ascii', errors='replace')}"
                )

    def continue_execution(self) -> None:
        self._send_packet(b"c")
        self._require_ack()

    def interrupt_execution(self) -> bytes:
        """Pause the emulated CPU and return Dolphin's stop-reply packet."""

        connection = self._require_socket()
        try:
            connection.sendall(b"\x03")
        except OSError as error:
            raise BridgeProtocolError(
                f"Dolphin GDB interrupt failed: {error}"
            ) from error
        return self.wait_for_stop()

    def wait_for_stop(self) -> bytes:
        """Wait for an interrupt or breakpoint stop reply from Dolphin."""

        if self._pending_stop_replies:
            reply = self._pending_stop_replies.popleft()
        else:
            reply = self._receive_packet()
        if not reply.startswith((b"S", b"T")):
            raise BridgeProtocolError("Dolphin GDB returned an invalid CPU stop reply")
        return reply

    def read_register(self, register: int) -> int:
        if not 0 <= register <= 0xFF:
            raise BridgeProtocolError("Dolphin GDB register index is invalid")
        reply = self._request(f"p{register:x}".encode("ascii"))
        if reply.startswith(b"E"):
            raise BridgeProtocolError(
                f"Dolphin GDB register {register} read failed: "
                f"{reply.decode('ascii', errors='replace')}"
            )
        try:
            value = int(reply, 16)
        except ValueError as error:
            raise BridgeProtocolError(
                f"Dolphin GDB returned a malformed register {register} value"
            ) from error
        if not reply or len(reply) > 16:
            raise BridgeProtocolError(
                f"Dolphin GDB returned a malformed register {register} width"
            )
        return value

    def add_execute_breakpoint(self, address: int, *, size: int = 4) -> None:
        self._execute_breakpoint("Z", address, size)

    def remove_execute_breakpoint(self, address: int, *, size: int = 4) -> None:
        self._execute_breakpoint("z", address, size)

    def _execute_breakpoint(self, operation: str, address: int, size: int) -> None:
        if address < 0 or address > 0xFFFFFFFF or size <= 0:
            raise BridgeProtocolError("Dolphin GDB breakpoint range is invalid")
        reply = self._request(f"{operation}0,{address:x},{size:x}".encode("ascii"))
        if reply != b"OK":
            raise BridgeProtocolError(
                "Dolphin GDB refused an execute breakpoint at "
                f"0x{address:08X}: {reply.decode('ascii', errors='replace')}"
            )

    def _request(self, payload: bytes) -> bytes:
        self._send_packet(payload)
        self._require_ack()
        return self._receive_packet()

    def _send_packet(self, payload: bytes) -> None:
        connection = self._require_socket()
        checksum = sum(payload) & 0xFF
        try:
            connection.sendall(b"$" + payload + f"#{checksum:02x}".encode("ascii"))
        except OSError as error:
            raise BridgeProtocolError(f"Dolphin GDB send failed: {error}") from error

    def _require_ack(self) -> None:
        while True:
            acknowledgement = self._receive_byte()
            if acknowledgement == b"+":
                return
            if acknowledgement == b"$":
                # A stop can race the ACK for an unrelated command. Preserve
                # it for wait_for_stop() instead of losing the only notification
                # that the emulated CPU is paused. Dolphin 2606 also emits an
                # empty follow-up packet after handling an interrupt; that one
                # carries no state and is safe to discard.
                payload = self._receive_packet_body()
                if not payload:
                    continue
                if payload.startswith((b"S", b"T")):
                    self._pending_stop_replies.append(payload)
                    continue
                raise BridgeProtocolError(
                    "Dolphin GDB sent an unexpected packet while acknowledging "
                    f"a command: {payload!r}"
                )
            raise BridgeProtocolError(
                f"Dolphin GDB rejected a command with {acknowledgement!r}"
            )

    def _receive_packet(self) -> bytes:
        while self._receive_byte() != b"$":
            pass
        return self._receive_packet_body()

    def _receive_packet_body(self) -> bytes:
        payload = bytearray()
        while True:
            value = self._receive_byte()
            if value == b"#":
                break
            payload.extend(value)
        checksum_bytes = self._receive_exact(2)
        try:
            expected_checksum = int(checksum_bytes, 16)
        except ValueError as error:
            raise BridgeProtocolError(
                "Dolphin GDB reply checksum is malformed"
            ) from error
        actual_checksum = sum(payload) & 0xFF
        connection = self._require_socket()
        connection.sendall(b"+" if actual_checksum == expected_checksum else b"-")
        if actual_checksum != expected_checksum:
            raise BridgeProtocolError("Dolphin GDB reply checksum did not match")
        return bytes(payload)

    def _receive_byte(self) -> bytes:
        return self._receive_exact(1)

    def _receive_exact(self, size: int) -> bytes:
        connection = self._require_socket()
        result = bytearray()
        try:
            while len(result) < size:
                value = connection.recv(size - len(result))
                if not value:
                    raise BridgeProtocolError("Dolphin GDB connection closed")
                result.extend(value)
        except OSError as error:
            raise BridgeProtocolError(f"Dolphin GDB receive failed: {error}") from error
        return bytes(result)

    def _require_socket(self) -> socket.socket:
        if self._socket is None:
            raise BridgeProtocolError("Dolphin GDB transport is not attached")
        return self._socket


class DolphinMemoryEngineTransport:
    """Primary runtime transport using Dolphin's emulated-RAM process mapping."""

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

    def close(self) -> None:
        try:
            if self._backend.is_hooked():
                self._backend.un_hook()
        except Exception as error:
            raise BridgeProtocolError(f"Dolphin detach failed: {error}") from error

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
