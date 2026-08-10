from __future__ import annotations

from dataclasses import replace

from starworks_runner.games.sluggers.bridge.layout import (
    CONTROL_BLOCK_SIZE,
    BridgeEvent,
    BridgeLayout,
    BridgeState,
    ControlBlock,
    EventType,
)
from starworks_runner.games.sluggers.bridge.memory import BridgeMemory, MemoryTransport


class SyntheticGameBridge:
    """Behavioral game-side bridge used without copyrighted game code or data."""

    def __init__(
        self,
        transport: MemoryTransport,
        adapter_build_sha256: str,
        game_build_sha256: str,
        *,
        layout: BridgeLayout | None = None,
    ) -> None:
        self.layout = layout or BridgeLayout()
        self.memory = BridgeMemory(transport, self.layout)
        self.control = ControlBlock.initial(adapter_build_sha256, game_build_sha256)
        self._write_control()

    def observe_runner_request(self) -> None:
        requested = ControlBlock.unpack(
            self.memory.read(self.layout.base_address, CONTROL_BLOCK_SIZE)
        )
        if requested.request_epoch <= self.control.acknowledged_epoch:
            return
        self.control = replace(
            requested,
            state=BridgeState.ACTIVE,
            producer_sequence=0,
            consumer_sequence=0,
            dropped_events=0,
            acknowledged_epoch=requested.request_epoch,
        )
        ring_size = self.layout.event_capacity * self.layout.event_size
        self.memory.write(
            self.layout.base_address + CONTROL_BLOCK_SIZE, bytes(ring_size)
        )
        self._write_control()

    def tick(
        self,
        *,
        paused: bool = False,
        emit_synthetic: bool = False,
        payload_value: int = 0,
        nonce_digest: bytes | None = None,
    ) -> None:
        self.control = ControlBlock.unpack(
            self.memory.read(self.layout.base_address, CONTROL_BLOCK_SIZE)
        )
        if paused:
            self.control = replace(self.control, state=BridgeState.PAUSED)
            self._write_control()
            return
        self.control = replace(
            self.control,
            state=BridgeState.ACTIVE,
            heartbeat=self.control.heartbeat + 1,
        )
        if emit_synthetic:
            sequence = self.control.producer_sequence + 1
            dropped = self.control.dropped_events
            if sequence - self.control.consumer_sequence > self.layout.event_capacity:
                dropped += 1
            event = BridgeEvent(
                sequence=sequence,
                frame=self.control.heartbeat,
                attempt_nonce_digest=nonce_digest or self.control.attempt_nonce_digest,
                event_type=EventType.SYNTHETIC,
                flags=0,
                payload_value=payload_value,
            )
            self.memory.write(self.layout.event_address(sequence), event.pack())
            self.control = replace(
                self.control,
                producer_sequence=sequence,
                dropped_events=dropped,
            )
        self._write_control()

    def _write_control(self) -> None:
        self.memory.write(self.layout.base_address, self.control.pack())
