from __future__ import annotations

from typing import Any

from starworks_runner.execution import BoundMatchExecution, bind_match_execution
from starworks_runner.games.sluggers.bridge.client import BridgeClient
from starworks_runner.games.sluggers.bridge.layout import BridgeLayout
from starworks_runner.games.sluggers.bridge.memory import ByteArrayMemoryTransport
from starworks_runner.games.sluggers.bridge.synthetic import SyntheticGameBridge
from starworks_runner.orchestrator import ExecutionOutcome


class SyntheticSluggersExecutor:
    """Game-free execution proof for contracts, nonce binding, and recovery tests."""

    def __init__(self, *, adapter_build_sha256: str = "a" * 64) -> None:
        self.adapter_build_sha256 = adapter_build_sha256
        self.bound: BoundMatchExecution | None = None
        self.event_count = 0

    def prepare(self, envelope: dict[str, Any], configuration: dict[str, Any]) -> None:
        self.bound = bind_match_execution(envelope, configuration)

    def execute(
        self,
        envelope: dict[str, Any],
        configuration: dict[str, Any],
        *,
        recovering: bool,
    ) -> ExecutionOutcome:
        bound = bind_match_execution(envelope, configuration)
        if self.bound is not None and bound != self.bound:
            raise ValueError("Prepared match changed before synthetic execution")
        layout = BridgeLayout()
        transport = ByteArrayMemoryTransport(layout)
        game = SyntheticGameBridge(
            transport,
            self.adapter_build_sha256,
            envelope["requiredGameBuildSha256"],
            layout=layout,
        )
        bridge = BridgeClient(
            transport,
            expected_adapter_build_sha256=self.adapter_build_sha256,
            expected_game_build_sha256=envelope["requiredGameBuildSha256"],
            layout=layout,
        )
        bridge.negotiate(
            envelope["attemptNonce"],
            progress=game.observe_runner_request,
            sleep=lambda _: None,
        )
        game.tick(emit_synthetic=True, payload_value=1)
        events = bridge.poll_events()
        if len(events) != 1 or events[0].sequence != 1:
            raise RuntimeError("Synthetic bridge did not produce the attributed event")
        self.event_count = len(events)
        return ExecutionOutcome(action="complete")
