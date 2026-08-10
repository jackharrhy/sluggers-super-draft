from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any, Literal, Protocol

from starworks_runner.control import RunnerControlClient
from starworks_runner.state import ActiveRun, RunnerStateStore, StationRegistration

FailureKind = Literal["game-crash", "runner-crash", "bridge-failure", "build-failure"]


class AttemptExecutionError(RuntimeError):
    def __init__(self, message: str, failure_kind: FailureKind) -> None:
        super().__init__(message)
        self.failure_kind = failure_kind


@dataclass(frozen=True)
class ExecutionOutcome:
    action: Literal["complete", "cancel"] = "complete"


class AttemptExecutor(Protocol):
    def prepare(self, envelope: dict[str, Any]) -> None: ...

    def execute(
        self, envelope: dict[str, Any], *, recovering: bool
    ) -> ExecutionOutcome: ...


@dataclass(frozen=True)
class RunOnceResult:
    status: Literal["no-work", "completed", "cancelled", "failed"]
    attempt_id: str | None


class RunnerStation:
    def __init__(
        self,
        client: RunnerControlClient,
        state: RunnerStateStore,
        *,
        station_name: str,
        capabilities: dict[str, Any],
        clock: Callable[[], datetime] | None = None,
    ) -> None:
        self.client = client
        self.state = state
        self.station_name = station_name
        self.capabilities = capabilities
        self.clock = clock or (lambda: datetime.now(UTC))

    def register(self) -> StationRegistration:
        response = self.client.register(self.station_name, self.capabilities)
        registration = StationRegistration(
            runner_id=response["runnerId"],
            heartbeat_seconds=response["heartbeatSeconds"],
            lease_seconds=response["leaseSeconds"],
        )
        self.state.save_registration(registration)
        return registration

    def heartbeat(self, runtime_state: str = "idle") -> dict[str, Any]:
        registration = self._registration()
        active = self.state.load_active_run()
        return self.client.heartbeat(
            runner_id=registration.runner_id,
            sent_at=self._timestamp(),
            state=runtime_state,
            active_attempt_id=active.envelope["attemptId"] if active else None,
            active_lease_id=active.envelope["lease"]["leaseId"] if active else None,
            last_captured_sequence=active.last_captured_sequence if active else None,
        )

    def flush_pending_updates(self) -> None:
        for pending in self.state.list_pending_updates():
            self.client.update_lease(pending.message)
            self.state.acknowledge_update(pending.event_id)

    def run_once(self, executor: AttemptExecutor) -> RunOnceResult:
        registration = self._registration()
        self.flush_pending_updates()
        active = self.state.load_active_run()
        if active is None:
            response = self.client.claim(registration.runner_id)
            envelope = response["run"]
            if envelope is None:
                self.heartbeat("idle")
                return RunOnceResult(status="no-work", attempt_id=None)
            active = self.state.accept_run(envelope)
        else:
            self.client.update_lease(
                self._lease_message(active, registration.runner_id, "renew")
            )

        attempt_id = active.envelope["attemptId"]
        recovering = active.stage == "running"
        self.heartbeat("recovering" if active.stage == "running" else "preparing")
        if active.stage != "running":
            try:
                self.state.update_stage(attempt_id, "preparing")
                executor.prepare(active.envelope)
            except AttemptExecutionError as error:
                self._report_failure(active, registration.runner_id, error.failure_kind)
                return RunOnceResult(status="failed", attempt_id=attempt_id)
            except Exception:
                self._report_failure(active, registration.runner_id, "runner-crash")
                raise
            self._queue_update(active, registration.runner_id, "started")
            self.flush_pending_updates()
            active = self.state.load_active_run()
            if active is None:
                raise RuntimeError(
                    "Active attempt disappeared after start acknowledgement"
                )

        try:
            outcome = executor.execute(active.envelope, recovering=recovering)
        except AttemptExecutionError as error:
            self._report_failure(active, registration.runner_id, error.failure_kind)
            return RunOnceResult(status="failed", attempt_id=attempt_id)
        except Exception:
            self._report_failure(active, registration.runner_id, "runner-crash")
            raise
        self._queue_update(active, registration.runner_id, outcome.action)
        self.flush_pending_updates()
        return RunOnceResult(
            status="completed" if outcome.action == "complete" else "cancelled",
            attempt_id=attempt_id,
        )

    def _report_failure(
        self,
        active: ActiveRun,
        runner_id: str,
        failure_kind: FailureKind,
    ) -> None:
        self._queue_update(active, runner_id, "fail", failure_kind=failure_kind)
        self.flush_pending_updates()

    def _queue_update(
        self,
        active: ActiveRun,
        runner_id: str,
        action: Literal["started", "complete", "cancel", "fail"],
        *,
        failure_kind: FailureKind | None = None,
    ) -> None:
        message = self._lease_message(
            active, runner_id, action, failure_kind=failure_kind
        )
        event_id = f"{active.envelope['attemptId']}:{action}"
        self.state.queue_update(event_id, message)

    def _lease_message(
        self,
        active: ActiveRun,
        runner_id: str,
        action: Literal["renew", "started", "complete", "cancel", "fail"],
        *,
        failure_kind: FailureKind | None = None,
    ) -> dict[str, Any]:
        return {
            "schemaVersion": 1,
            "kind": "runner-lease-update-request",
            "runnerId": runner_id,
            "attemptId": active.envelope["attemptId"],
            "leaseId": active.envelope["lease"]["leaseId"],
            "action": action,
            "failureKind": failure_kind,
            "observedAt": self._timestamp(),
        }

    def _registration(self) -> StationRegistration:
        registration = self.state.load_registration()
        if registration is None:
            raise RuntimeError("Runner station is not registered")
        return registration

    def _timestamp(self) -> str:
        return self.clock().astimezone(UTC).isoformat().replace("+00:00", "Z")
