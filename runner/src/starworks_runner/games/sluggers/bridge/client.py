from __future__ import annotations

import struct
import time
from collections.abc import Callable
from dataclasses import dataclass, field

from starworks_runner.games.sluggers.bridge.configuration import (
    CONFIGURATION_OFFSET,
    CONFIGURATION_SIZE,
    RuntimeConfigurationBlock,
)
from starworks_runner.games.sluggers.bridge.layout import (
    ATTEMPT_NONCE_OFFSET,
    CONSUMER_SEQUENCE_OFFSET,
    CONTROL_BLOCK_SIZE,
    REQUEST_EPOCH_OFFSET,
    BridgeEvent,
    BridgeLayout,
    BridgeProtocolError,
    BridgeState,
    ControlBlock,
    attempt_nonce_digest,
    digest_from_hex,
)
from starworks_runner.games.sluggers.bridge.memory import BridgeMemory, MemoryTransport


class AttemptAttributionError(BridgeProtocolError):
    """An event cannot safely be attributed to the negotiated match attempt."""


class EventOverflowError(BridgeProtocolError):
    """The game overwrote unread events and automatic finalization is unsafe."""


@dataclass
class PollMetrics:
    polls: int = 0
    events: int = 0
    empty_polls: int = 0
    elapsed_seconds: float = 0.0
    max_poll_seconds: float = 0.0

    @property
    def mean_poll_seconds(self) -> float:
        return self.elapsed_seconds / self.polls if self.polls else 0.0

    def report_value(self) -> dict[str, float | int]:
        return {
            "polls": self.polls,
            "events": self.events,
            "emptyPolls": self.empty_polls,
            "elapsedSeconds": self.elapsed_seconds,
            "meanPollSeconds": self.mean_poll_seconds,
            "maxPollSeconds": self.max_poll_seconds,
        }


@dataclass
class BridgeClient:
    transport: MemoryTransport
    expected_adapter_build_sha256: str
    expected_game_build_sha256: str
    layout: BridgeLayout = field(default_factory=BridgeLayout)
    metrics: PollMetrics = field(default_factory=PollMetrics)
    _nonce_digest: bytes | None = field(default=None, init=False, repr=False)
    _consumer_sequence: int = field(default=0, init=False, repr=False)

    def __post_init__(self) -> None:
        self.memory = BridgeMemory(self.transport, self.layout)
        self._expected_adapter_digest = digest_from_hex(
            self.expected_adapter_build_sha256, "adapter build ID"
        )
        self._expected_game_digest = digest_from_hex(
            self.expected_game_build_sha256, "game build ID"
        )

    def read_control(self) -> ControlBlock:
        control = ControlBlock.unpack(
            self.memory.read(self.layout.base_address, CONTROL_BLOCK_SIZE)
        )
        control.validate_layout(self.layout)
        if control.adapter_build_digest != self._expected_adapter_digest:
            raise BridgeProtocolError(
                "Game bridge adapter build ID does not match the runner"
            )
        if control.game_build_digest != self._expected_game_digest:
            raise BridgeProtocolError(
                "Game bridge game-build ID does not match the run"
            )
        if control.state == BridgeState.ERROR:
            raise BridgeProtocolError(
                f"Game bridge reported fatal error 0x{control.last_error:08X}"
            )
        return control

    def negotiate(
        self,
        attempt_nonce: str,
        *,
        timeout_seconds: float = 5.0,
        progress: Callable[[], None] | None = None,
        monotonic: Callable[[], float] = time.monotonic,
        sleep: Callable[[float], None] = time.sleep,
    ) -> ControlBlock:
        control = self.read_control()
        if control.state not in {
            BridgeState.READY,
            BridgeState.ACTIVE,
            BridgeState.PAUSED,
        }:
            raise BridgeProtocolError(
                f"Bridge is not ready for negotiation: {control.state.name}"
            )
        nonce_digest = attempt_nonce_digest(attempt_nonce)
        request_epoch = control.request_epoch + 1
        self.memory.write(self.layout.base_address + ATTEMPT_NONCE_OFFSET, nonce_digest)
        self.memory.write(
            self.layout.base_address + REQUEST_EPOCH_OFFSET,
            struct.pack(">Q", request_epoch),
        )

        deadline = monotonic() + timeout_seconds
        while monotonic() <= deadline:
            if progress is not None:
                progress()
            acknowledged = self.read_control()
            if (
                acknowledged.acknowledged_epoch == request_epoch
                and acknowledged.attempt_nonce_digest == nonce_digest
                and acknowledged.state in {BridgeState.ACTIVE, BridgeState.PAUSED}
            ):
                self._nonce_digest = nonce_digest
                self._consumer_sequence = acknowledged.consumer_sequence
                return acknowledged
            sleep(0.01)
        raise BridgeProtocolError(
            f"Game bridge did not acknowledge nonce request epoch {request_epoch}"
        )

    def attach_existing(self, attempt_nonce: str) -> ControlBlock:
        """Bind to a previously negotiated attempt without resetting its ring."""

        control = self.read_control()
        nonce_digest = attempt_nonce_digest(attempt_nonce)
        if control.state not in {BridgeState.ACTIVE, BridgeState.PAUSED}:
            raise BridgeProtocolError(
                f"Existing bridge is not active: {control.state.name}"
            )
        if (
            control.request_epoch == 0
            or control.acknowledged_epoch != control.request_epoch
        ):
            raise BridgeProtocolError(
                "Existing bridge request epoch is not acknowledged"
            )
        if control.attempt_nonce_digest != nonce_digest:
            raise AttemptAttributionError(
                "Existing bridge belongs to a different match attempt"
            )
        self._nonce_digest = nonce_digest
        self._consumer_sequence = control.consumer_sequence
        return control

    def install_configuration(
        self,
        configuration: RuntimeConfigurationBlock,
        *,
        timeout_seconds: float = 5.0,
        monotonic: Callable[[], float] = time.monotonic,
        sleep: Callable[[float], None] = time.sleep,
    ) -> RuntimeConfigurationBlock:
        if self._nonce_digest is None:
            raise BridgeProtocolError("Bridge nonce handshake has not completed")
        address = self.layout.base_address + CONFIGURATION_OFFSET
        self.memory.write(address, configuration.pack())
        deadline = monotonic() + timeout_seconds
        while monotonic() <= deadline:
            acknowledged = self.read_configuration()
            if acknowledged.runtime_applied_epoch == configuration.requested_epoch:
                return acknowledged
            sleep(0.01)
        raise BridgeProtocolError(
            "Game bridge did not acknowledge the runtime configuration"
        )

    def read_configuration(self) -> RuntimeConfigurationBlock:
        return RuntimeConfigurationBlock.unpack(
            self.memory.read(
                self.layout.base_address + CONFIGURATION_OFFSET,
                CONFIGURATION_SIZE,
            )
        )

    def poll_events(self, *, max_events: int | None = None) -> list[BridgeEvent]:
        started = time.perf_counter()
        try:
            if self._nonce_digest is None:
                raise BridgeProtocolError("Bridge nonce handshake has not completed")
            control = self.read_control()
            if control.attempt_nonce_digest != self._nonce_digest:
                raise AttemptAttributionError(
                    "Bridge attempt nonce changed after negotiation"
                )
            available = control.producer_sequence - self._consumer_sequence
            if available < 0:
                raise BridgeProtocolError("Bridge producer sequence moved backwards")
            if available > self.layout.event_capacity or control.dropped_events:
                raise EventOverflowError(
                    f"Bridge event ring overflowed: available={available}, "
                    f"dropped={control.dropped_events}"
                )
            count = available if max_events is None else min(available, max_events)
            events: list[BridgeEvent] = []
            for sequence in range(
                self._consumer_sequence + 1, self._consumer_sequence + count + 1
            ):
                address = self.layout.event_address(sequence)
                raw = self.memory.read(address, self.layout.event_size)
                committed_sequence = struct.unpack(">Q", self.memory.read(address, 8))[
                    0
                ]
                event = BridgeEvent.unpack(raw)
                if event.sequence != sequence or committed_sequence != sequence:
                    raise BridgeProtocolError(
                        f"Torn or overwritten bridge event at sequence {sequence}"
                    )
                if event.attempt_nonce_digest != self._nonce_digest:
                    raise AttemptAttributionError(
                        f"Event {sequence} belongs to a different match attempt"
                    )
                events.append(event)
            if events:
                self._consumer_sequence = events[-1].sequence
                self.memory.write(
                    self.layout.base_address + CONSUMER_SEQUENCE_OFFSET,
                    struct.pack(">Q", self._consumer_sequence),
                )
            return events
        finally:
            elapsed = time.perf_counter() - started
            self.metrics.polls += 1
            self.metrics.elapsed_seconds += elapsed
            self.metrics.max_poll_seconds = max(self.metrics.max_poll_seconds, elapsed)
            event_count = len(events) if "events" in locals() else 0
            self.metrics.events += event_count
            if event_count == 0:
                self.metrics.empty_polls += 1
