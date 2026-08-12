from __future__ import annotations

import json
from pathlib import Path

import pytest
from starworks_runner.games.sluggers.bridge.client import (
    AttemptAttributionError,
    BridgeClient,
    EventOverflowError,
)
from starworks_runner.games.sluggers.bridge.layout import (
    BRIDGE_ENTRY_ADDRESS,
    BRIDGE_ENTRY_SIGNATURE,
    CONTROL_BLOCK_SIZE,
    EVENT_SIZE,
    BridgeEvent,
    BridgeLayout,
    BridgeProtocolError,
    BridgeState,
    ControlBlock,
    EventType,
)
from starworks_runner.games.sluggers.bridge.memory import (
    BridgeMemory,
    ByteArrayMemoryTransport,
    DolphinMemoryEngineTransport,
    GdbRemoteMemoryTransport,
)
from starworks_runner.games.sluggers.bridge.synthetic import SyntheticGameBridge
from starworks_runner.games.sluggers.errors import BuildIntegrityError
from starworks_runner.games.sluggers.memory_map import MemoryMap
from starworks_runner.games.sluggers.session import (
    bootstrap_live_bridge,
    wait_for_restored_bridge,
)

ADAPTER_BUILD = "a" * 64
GAME_BUILD = "b" * 64
ATTEMPT_NONCE = "attempt_nonce_0123456789abcdefgh"


def create_pair() -> tuple[ByteArrayMemoryTransport, SyntheticGameBridge, BridgeClient]:
    layout = BridgeLayout()
    transport = ByteArrayMemoryTransport(layout)
    game = SyntheticGameBridge(transport, ADAPTER_BUILD, GAME_BUILD, layout=layout)
    client = BridgeClient(
        transport,
        expected_adapter_build_sha256=ADAPTER_BUILD,
        expected_game_build_sha256=GAME_BUILD,
        layout=layout,
    )
    return transport, game, client


def negotiate(game: SyntheticGameBridge, client: BridgeClient) -> ControlBlock:
    ticks = iter(range(100))
    return client.negotiate(
        ATTEMPT_NONCE,
        progress=game.observe_runner_request,
        monotonic=lambda: next(ticks) / 100,
        sleep=lambda _: None,
    )


def test_binary_layout_round_trips_exact_sizes() -> None:
    control = ControlBlock.initial(ADAPTER_BUILD, GAME_BUILD)
    packed_control = control.pack()
    assert len(packed_control) == CONTROL_BLOCK_SIZE
    assert ControlBlock.unpack(packed_control) == control

    event = BridgeEvent(
        sequence=1,
        frame=99,
        attempt_nonce_digest=b"n" * 32,
        event_type=EventType.SYNTHETIC,
        flags=3,
        payload_value=42,
    )
    packed_event = event.pack()
    assert len(packed_event) == EVENT_SIZE
    assert BridgeEvent.unpack(packed_event) == event


def test_nonce_handshake_and_event_survive_pause_resume_without_duplicate() -> None:
    _, game, client = create_pair()
    acknowledged = negotiate(game, client)
    assert acknowledged.state == BridgeState.ACTIVE
    assert acknowledged.acknowledged_epoch == acknowledged.request_epoch == 1

    game.tick(emit_synthetic=True, payload_value=41)
    first = client.poll_events()
    game.tick(paused=True)
    paused = client.poll_events()
    game.tick(emit_synthetic=True, payload_value=42)
    resumed = client.poll_events()
    duplicate_poll = client.poll_events()

    assert [event.sequence for event in first] == [1]
    assert paused == []
    assert [event.sequence for event in resumed] == [2]
    assert resumed[0].payload_value == 42
    assert duplicate_poll == []
    assert client.metrics.events == 2
    assert client.metrics.polls == 4


class RestoringMemoryTransport(ByteArrayMemoryTransport):
    def __init__(self, layout: BridgeLayout, restored: bytes) -> None:
        super().__init__(layout)
        self.restored = restored
        self.reads = 0

    def read(self, address: int, size: int) -> bytes:
        if address == self.layout.base_address and size == CONTROL_BLOCK_SIZE:
            self.reads += 1
            if self.reads == 1:
                return bytes(size)
            control = ControlBlock.unpack(self.restored)
            return ControlBlock(
                **{**control.__dict__, "heartbeat": control.heartbeat + self.reads}
            ).pack()
        return super().read(address, size)


def test_checkpoint_gate_waits_for_an_advancing_restored_bridge() -> None:
    layout = BridgeLayout()
    checkpoint = ControlBlock.initial(ADAPTER_BUILD, GAME_BUILD)
    checkpoint = ControlBlock(
        **{**checkpoint.__dict__, "state": BridgeState.ACTIVE, "heartbeat": 40}
    )
    transport = RestoringMemoryTransport(layout, checkpoint.pack())
    ticks = iter(range(20))

    restored = wait_for_restored_bridge(
        transport,
        adapter_build_sha256=ADAPTER_BUILD,
        game_build_sha256=GAME_BUILD,
        monotonic=lambda: next(ticks) / 100,
        sleep=lambda _: None,
    )

    assert restored.heartbeat > checkpoint.heartbeat
    assert transport.reads == 3


def test_client_reattaches_to_existing_nonce_without_resetting_the_ring() -> None:
    transport, game, client = create_pair()
    negotiate(game, client)
    game.tick(emit_synthetic=True, payload_value=41)

    recovered = BridgeClient(
        transport,
        expected_adapter_build_sha256=ADAPTER_BUILD,
        expected_game_build_sha256=GAME_BUILD,
    )
    control = recovered.attach_existing(ATTEMPT_NONCE)

    assert control.producer_sequence == 1
    assert [event.payload_value for event in recovered.poll_events()] == [41]
    with pytest.raises(AttemptAttributionError, match="different match attempt"):
        BridgeClient(
            transport,
            expected_adapter_build_sha256=ADAPTER_BUILD,
            expected_game_build_sha256=GAME_BUILD,
        ).attach_existing("different_attempt_nonce_0123456789")


def test_event_from_another_attempt_is_never_attributed() -> None:
    _, game, client = create_pair()
    negotiate(game, client)
    game.tick(
        emit_synthetic=True,
        payload_value=1,
        nonce_digest=b"wrong-attempt".ljust(32, b"!"),
    )

    with pytest.raises(AttemptAttributionError, match="different match attempt"):
        client.poll_events()


def test_overflow_is_visible_and_blocks_consumption() -> None:
    _, game, client = create_pair()
    negotiate(game, client)
    for value in range(client.layout.event_capacity + 1):
        game.tick(emit_synthetic=True, payload_value=value)

    with pytest.raises(EventOverflowError, match="overflowed"):
        client.poll_events()


def test_build_and_protocol_mismatches_fail_before_handshake() -> None:
    transport, _, _ = create_pair()
    wrong_build_client = BridgeClient(
        transport,
        expected_adapter_build_sha256="c" * 64,
        expected_game_build_sha256=GAME_BUILD,
    )

    with pytest.raises(BridgeProtocolError, match="adapter build ID"):
        wrong_build_client.read_control()

    control = ControlBlock.initial(ADAPTER_BUILD, GAME_BUILD)
    incompatible = ControlBlock(**{**control.__dict__, "protocol_version": 2})
    transport.write(BridgeLayout().base_address, incompatible.pack())
    client = BridgeClient(
        transport,
        expected_adapter_build_sha256=ADAPTER_BUILD,
        expected_game_build_sha256=GAME_BUILD,
    )
    with pytest.raises(BridgeProtocolError, match="protocol mismatch"):
        client.read_control()


def test_every_memory_access_is_bounded_to_the_reserved_region() -> None:
    layout = BridgeLayout()
    memory = BridgeMemory(ByteArrayMemoryTransport(layout), layout)

    with pytest.raises(BridgeProtocolError, match="outside the bridge region"):
        memory.read(layout.base_address - 1, 1)
    with pytest.raises(BridgeProtocolError, match="outside the bridge region"):
        memory.write(layout.end_address, b"x")


def test_checked_in_memory_map_is_collision_free_and_matches_protocol() -> None:
    memory_map = MemoryMap.load()
    bridge = next(
        item
        for item in memory_map.reservations
        if item.identifier == "starworks-bridge"
    )
    assert bridge.start == BridgeLayout().base_address
    assert bridge.size == BridgeLayout().region_size


def test_memory_map_collision_fails_closed(tmp_path: Path) -> None:
    raw = MemoryMap.load().raw
    raw["reservations"][0]["start"] = "0x80001880"
    path = tmp_path / "collision.json"
    path.write_text(json.dumps(raw), encoding="utf-8")

    with pytest.raises(BuildIntegrityError, match="overlap"):
        MemoryMap.load(path)


class FakeDmeBackend:
    def __init__(self) -> None:
        self.hooked = False
        self.memory: dict[tuple[int, int], bytes] = {}

    def is_hooked(self) -> bool:
        return self.hooked

    def hook(self) -> None:
        self.hooked = True

    def un_hook(self) -> None:
        self.hooked = False

    def read_bytes(self, address: int, size: int) -> bytes:
        return self.memory.get((address, size), bytes(size))

    def write_bytes(self, address: int, value: bytes) -> None:
        self.memory[(address, len(value))] = bytes(value)


def test_dme_process_backend_attaches_and_is_hidden_behind_transport() -> None:
    backend = FakeDmeBackend()
    transport = DolphinMemoryEngineTransport(backend)
    transport.attach()
    address = BridgeLayout().base_address
    transport.write(address, b"SWB1")

    assert backend.hooked is True
    assert transport.read(address, 4) == b"SWB1"
    transport.close()
    assert backend.hooked is False


def rsp_reply(payload: bytes) -> bytes:
    checksum = sum(payload) & 0xFF
    return b"+" + b"$" + payload + f"#{checksum:02x}".encode("ascii")


def rsp_packet(payload: bytes) -> bytes:
    checksum = sum(payload) & 0xFF
    return b"$" + payload + f"#{checksum:02x}".encode("ascii")


class FakeRspSocket:
    def __init__(self, incoming: bytes) -> None:
        self.incoming = bytearray(incoming)
        self.sent: list[bytes] = []

    def sendall(self, value: bytes) -> None:
        self.sent.append(value)

    def recv(self, size: int) -> bytes:
        value = bytes(self.incoming[:size])
        del self.incoming[:size]
        return value

    def close(self) -> None:
        pass


def test_gdb_remote_transport_reads_writes_interrupts_and_breakpoints() -> None:
    backend = FakeRspSocket(
        rsp_reply(b"53574231")
        + rsp_reply(b"OK")
        + b"+"
        + rsp_packet(b"T05")
        + rsp_packet(b"")
        + rsp_reply(b"OK")
        + rsp_reply(b"OK")
        + rsp_reply(b"OK")
        + rsp_reply(b"OK")
        + rsp_reply(b"00000001")
    )
    transport = GdbRemoteMemoryTransport(connection=backend)  # type: ignore[arg-type]

    assert transport.read(BridgeLayout().base_address, 4) == b"SWB1"
    transport.write(BridgeLayout().base_address + 4, b"test")
    transport.continue_execution()
    assert transport.interrupt_execution() == b"T05"
    transport.add_execute_breakpoint(0x8006AED4)
    transport.remove_execute_breakpoint(0x8006AED4)
    transport.add_write_watchpoint(0x900D5C28)
    transport.remove_write_watchpoint(0x900D5C28)
    assert transport.read_register(14) == 1

    sent = b"".join(backend.sent)
    assert b"$m80001900,4#" in sent
    assert b"$M80001904,4:74657374#" in sent
    assert b"$c#63" in sent
    assert b"\x03" in sent
    assert b"$Z0,8006aed4,4#" in sent
    assert b"$z0,8006aed4,4#" in sent
    assert b"$Z2,900d5c28,1#" in sent
    assert b"$z2,900d5c28,1#" in sent
    assert b"$pe#" in sent


def test_gdb_remote_transport_preserves_stop_reply_that_races_command_ack() -> None:
    backend = FakeRspSocket(
        rsp_packet(b"T0540:8006aed4;01:9008e158;") + b"+" + rsp_packet(b"OK")
    )
    transport = GdbRemoteMemoryTransport(connection=backend)  # type: ignore[arg-type]

    transport.add_execute_breakpoint(0x8006AED4)

    assert transport.wait_for_stop() == b"T0540:8006aed4;01:9008e158;"


def test_gdb_register_value_may_begin_with_error_marker() -> None:
    backend = FakeRspSocket(rsp_reply(b"E6BD9B73"))
    transport = GdbRemoteMemoryTransport(connection=backend)  # type: ignore[arg-type]

    assert transport.read_register(6) == 0xE6BD9B73


class FakeBootableTransport(ByteArrayMemoryTransport):
    def __init__(self) -> None:
        super().__init__(BridgeLayout())
        self.continued = False

    def continue_execution(self) -> None:
        self.continued = True
        self.write(BRIDGE_ENTRY_ADDRESS, BRIDGE_ENTRY_SIGNATURE)


def test_live_bridge_bootstrap_waits_for_code_and_initializes_control() -> None:
    transport = FakeBootableTransport()

    client = bootstrap_live_bridge(  # type: ignore[arg-type]
        transport,
        adapter_build_sha256=ADAPTER_BUILD,
        game_build_sha256=GAME_BUILD,
        sleep=lambda _: None,
    )

    control = client.read_control()
    assert transport.continued is True
    assert control.adapter_build_digest == bytes.fromhex(ADAPTER_BUILD)
    assert control.game_build_digest == bytes.fromhex(GAME_BUILD)


def test_live_bridge_bootstrap_fails_closed() -> None:
    transport = FakeBootableTransport()
    transport.continue_execution = lambda: None  # type: ignore[method-assign]
    ticks = iter((0.0, 1.0))

    with pytest.raises(BridgeProtocolError, match="did not load"):
        bootstrap_live_bridge(  # type: ignore[arg-type]
            transport,
            adapter_build_sha256=ADAPTER_BUILD,
            game_build_sha256=GAME_BUILD,
            timeout_seconds=0.5,
            monotonic=lambda: next(ticks),
            sleep=lambda _: None,
        )


def test_polling_overhead_is_measured() -> None:
    _, game, client = create_pair()
    negotiate(game, client)
    for _ in range(2_000):
        assert client.poll_events() == []

    report = client.metrics.report_value()
    assert report["polls"] == 2_000
    assert report["emptyPolls"] == 2_000
    assert report["meanPollSeconds"] > 0
    assert report["meanPollSeconds"] < 0.005
