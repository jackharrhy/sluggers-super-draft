from __future__ import annotations

import hashlib
import struct
from dataclasses import dataclass
from enum import IntEnum

from starworks_runner.games.sluggers.errors import SluggersAdapterError

MAGIC = b"SWB1"
PROTOCOL_VERSION = 1
BRIDGE_BASE_ADDRESS = 0x80001900
BRIDGE_REGION_SIZE = 0x1700
CONTROL_BLOCK_SIZE = 0x100
EVENT_SIZE = 0x40
EVENT_CAPACITY = 64
EVENT_RING_OFFSET = CONTROL_BLOCK_SIZE

CONTROL_STRUCT = struct.Struct(">4sHHII32s32s32sQQQIHHIIQQ88x")
EVENT_STRUCT = struct.Struct(">QQ32sHHIQ")

ATTEMPT_NONCE_OFFSET = 0x50
PRODUCER_SEQUENCE_OFFSET = 0x78
CONSUMER_SEQUENCE_OFFSET = 0x80
REQUEST_EPOCH_OFFSET = 0x98
ACKNOWLEDGED_EPOCH_OFFSET = 0xA0


class BridgeProtocolError(SluggersAdapterError):
    """The game-side bridge violated or rejected protocol v1."""


class BridgeState(IntEnum):
    BOOTING = 0
    READY = 1
    ACTIVE = 2
    PAUSED = 3
    ERROR = 4


class EventType(IntEnum):
    SYNTHETIC = 1


def digest_from_hex(value: str, field_name: str) -> bytes:
    try:
        decoded = bytes.fromhex(value)
    except ValueError as error:
        raise BridgeProtocolError(
            f"{field_name} must be lowercase SHA-256 hex"
        ) from error
    if len(decoded) != 32 or value != value.lower():
        raise BridgeProtocolError(f"{field_name} must be lowercase SHA-256 hex")
    return decoded


def attempt_nonce_digest(attempt_nonce: str) -> bytes:
    if not 32 <= len(attempt_nonce) <= 128:
        raise BridgeProtocolError("Attempt nonce must contain 32 to 128 characters")
    if any(
        character
        not in "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-"
        for character in attempt_nonce
    ):
        raise BridgeProtocolError("Attempt nonce must be URL-safe base64 text")
    return hashlib.sha256(attempt_nonce.encode("ascii")).digest()


@dataclass(frozen=True)
class BridgeLayout:
    base_address: int = BRIDGE_BASE_ADDRESS
    region_size: int = BRIDGE_REGION_SIZE
    event_capacity: int = EVENT_CAPACITY
    event_size: int = EVENT_SIZE

    @property
    def end_address(self) -> int:
        return self.base_address + self.region_size

    def event_address(self, sequence: int) -> int:
        if sequence <= 0:
            raise BridgeProtocolError("Event sequences start at one")
        index = (sequence - 1) % self.event_capacity
        return self.base_address + EVENT_RING_OFFSET + index * self.event_size

    def require_range(self, address: int, size: int) -> None:
        if size < 0 or address < self.base_address or address + size > self.end_address:
            raise BridgeProtocolError(
                f"Memory access 0x{address:08X}+0x{size:X} is outside the bridge region"
            )


@dataclass(frozen=True)
class ControlBlock:
    magic: bytes
    protocol_version: int
    header_size: int
    total_size: int
    flags: int
    adapter_build_digest: bytes
    game_build_digest: bytes
    attempt_nonce_digest: bytes
    heartbeat: int
    producer_sequence: int
    consumer_sequence: int
    dropped_events: int
    event_capacity: int
    event_size: int
    state: BridgeState
    last_error: int
    request_epoch: int
    acknowledged_epoch: int

    @classmethod
    def initial(cls, adapter_build_sha256: str, game_build_sha256: str) -> ControlBlock:
        return cls(
            magic=MAGIC,
            protocol_version=PROTOCOL_VERSION,
            header_size=CONTROL_BLOCK_SIZE,
            total_size=BRIDGE_REGION_SIZE,
            flags=0,
            adapter_build_digest=digest_from_hex(
                adapter_build_sha256, "adapter build ID"
            ),
            game_build_digest=digest_from_hex(game_build_sha256, "game build ID"),
            attempt_nonce_digest=bytes(32),
            heartbeat=0,
            producer_sequence=0,
            consumer_sequence=0,
            dropped_events=0,
            event_capacity=EVENT_CAPACITY,
            event_size=EVENT_SIZE,
            state=BridgeState.READY,
            last_error=0,
            request_epoch=0,
            acknowledged_epoch=0,
        )

    @classmethod
    def unpack(cls, value: bytes) -> ControlBlock:
        if len(value) != CONTROL_BLOCK_SIZE:
            raise BridgeProtocolError(
                f"Control block must be {CONTROL_BLOCK_SIZE} bytes, got {len(value)}"
            )
        unpacked = CONTROL_STRUCT.unpack(value)
        try:
            state = BridgeState(unpacked[14])
        except ValueError as error:
            raise BridgeProtocolError(f"Unknown bridge state {unpacked[14]}") from error
        return cls(*unpacked[:14], state, *unpacked[15:])

    def pack(self) -> bytes:
        return CONTROL_STRUCT.pack(
            self.magic,
            self.protocol_version,
            self.header_size,
            self.total_size,
            self.flags,
            self.adapter_build_digest,
            self.game_build_digest,
            self.attempt_nonce_digest,
            self.heartbeat,
            self.producer_sequence,
            self.consumer_sequence,
            self.dropped_events,
            self.event_capacity,
            self.event_size,
            int(self.state),
            self.last_error,
            self.request_epoch,
            self.acknowledged_epoch,
        )

    def validate_layout(self, layout: BridgeLayout) -> None:
        if self.magic != MAGIC:
            raise BridgeProtocolError(
                f"Bridge magic mismatch: expected {MAGIC!r}, got {self.magic!r}"
            )
        if self.protocol_version != PROTOCOL_VERSION:
            raise BridgeProtocolError(
                f"Bridge protocol mismatch: runner={PROTOCOL_VERSION}, "
                f"game={self.protocol_version}"
            )
        expected = (
            CONTROL_BLOCK_SIZE,
            layout.region_size,
            layout.event_capacity,
            layout.event_size,
        )
        actual = (
            self.header_size,
            self.total_size,
            self.event_capacity,
            self.event_size,
        )
        if actual != expected:
            raise BridgeProtocolError(
                f"Bridge binary layout mismatch: expected {expected}, got {actual}"
            )


@dataclass(frozen=True)
class BridgeEvent:
    sequence: int
    frame: int
    attempt_nonce_digest: bytes
    event_type: EventType
    flags: int
    payload_value: int

    @classmethod
    def unpack(cls, value: bytes) -> BridgeEvent:
        if len(value) != EVENT_SIZE:
            raise BridgeProtocolError(
                f"Bridge event must be {EVENT_SIZE} bytes, got {len(value)}"
            )
        sequence, frame, nonce, event_type, payload_size, flags, payload = (
            EVENT_STRUCT.unpack(value)
        )
        if payload_size != 8:
            raise BridgeProtocolError(
                f"Unsupported bridge event payload size {payload_size}"
            )
        try:
            typed_event = EventType(event_type)
        except ValueError as error:
            raise BridgeProtocolError(
                f"Unknown bridge event type {event_type}"
            ) from error
        return cls(sequence, frame, nonce, typed_event, flags, payload)

    def pack(self) -> bytes:
        if len(self.attempt_nonce_digest) != 32:
            raise BridgeProtocolError("Event attempt nonce digest must be 32 bytes")
        return EVENT_STRUCT.pack(
            self.sequence,
            self.frame,
            self.attempt_nonce_digest,
            int(self.event_type),
            8,
            self.flags,
            self.payload_value,
        )


assert CONTROL_STRUCT.size == CONTROL_BLOCK_SIZE
assert EVENT_STRUCT.size == EVENT_SIZE
assert EVENT_RING_OFFSET + EVENT_CAPACITY * EVENT_SIZE <= BRIDGE_REGION_SIZE
