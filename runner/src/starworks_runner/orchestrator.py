from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Literal, Protocol

from starworks_runner.content_sync import ContentPackDownloader
from starworks_runner.control import RunnerApiError, RunnerControlClient
from starworks_runner.state import ActiveRun, RunnerStateStore, StationRegistration

FailureKind = Literal["game-crash", "runner-crash", "bridge-failure", "build-failure"]


class AttemptExecutionError(RuntimeError):
    def __init__(self, message: str, failure_kind: FailureKind) -> None:
        super().__init__(message)
        self.failure_kind = failure_kind


@dataclass(frozen=True)
class ExecutionOutcome:
    action: Literal["complete", "cancel", "continue"] = "complete"


class AttemptExecutor(Protocol):
    def prepare(
        self, envelope: dict[str, Any], configuration: dict[str, Any]
    ) -> None: ...

    def execute(
        self,
        envelope: dict[str, Any],
        configuration: dict[str, Any],
        *,
        recovering: bool,
        emit_telemetry: Callable[[dict[str, Any]], None],
    ) -> ExecutionOutcome: ...


@dataclass(frozen=True)
class RunOnceResult:
    status: Literal[
        "no-work", "running", "offline", "completed", "cancelled", "failed"
    ]
    attempt_id: str | None
    detail: str | None = None


class RunnerStation:
    def __init__(
        self,
        client: RunnerControlClient,
        state: RunnerStateStore,
        *,
        station_name: str,
        capabilities: dict[str, Any],
        clock: Callable[[], datetime] | None = None,
        component_health: Callable[[], dict[str, str]] | None = None,
        content_cache: Path | None = None,
    ) -> None:
        self.client = client
        self.state = state
        self.station_name = station_name
        self.capabilities = capabilities
        self.clock = clock or (lambda: datetime.now(UTC))
        self.component_health = component_health
        self.content_cache = content_cache

    def register(self) -> StationRegistration:
        response = self.client.register(self.station_name, self.capabilities)
        version_policy = response.get("versionPolicy", {})
        registration = StationRegistration(
            runner_id=response["runnerId"],
            heartbeat_seconds=response["heartbeatSeconds"],
            lease_seconds=response["leaseSeconds"],
            version_status=version_policy.get("status", "unknown"),
            minimum_runner_version=version_policy.get("minimumRunnerVersion"),
            recommended_runner_version=version_policy.get("recommendedRunnerVersion"),
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
            component_health=(
                self.component_health() if self.component_health else None
            ),
        )

    def flush_pending_updates(self) -> None:
        for pending in self.state.list_pending_updates():
            self.client.update_lease(pending.message)
            self.state.acknowledge_update(pending.event_id)

    def run_once(self, executor: AttemptExecutor) -> RunOnceResult:
        registration = self._registration()
        active = self.state.load_active_run()
        sync_error = self._retryable_sync(self.flush_pending_updates)
        if sync_error is not None and (
            active is None or active.stage != "running"
        ):
            raise sync_error
        active = self.state.load_active_run()
        if active is None:
            response = self.client.claim(registration.runner_id)
            envelope = response["run"]
            if envelope is None:
                self.heartbeat("idle")
                return RunOnceResult(status="no-work", attempt_id=None)
            active = self.state.accept_run(envelope)
        elif sync_error is None:
            try:
                self.client.update_lease(
                    self._lease_message(active, registration.runner_id, "renew")
                )
            except RunnerApiError as error:
                if error.status == 409:
                    abandon = getattr(executor, "abandon_runtime", None)
                    if active.runtime_metadata is not None and callable(abandon):
                        abandon(active.runtime_metadata)
                    self.state.archive_lost_lease(active.envelope["attemptId"])
                    return RunOnceResult(
                        status="failed",
                        attempt_id=active.envelope["attemptId"],
                        detail=str(error),
                    )
                if not error.retryable:
                    raise
                sync_error = error

        if active.configuration is None:
            configuration = self.client.configuration(
                attempt_id=active.envelope["attemptId"]
            )
            self.state.save_configuration(active.envelope["attemptId"], configuration)
            active = self.state.load_active_run()
            if active is None or active.configuration is None:
                raise RuntimeError("Match configuration was not persisted")

        resolved_content = None
        if self.content_cache is not None:
            resolved_content = ContentPackDownloader(
                self.client, self.content_cache
            ).resolve(active.envelope, active.configuration)
        supply_content = getattr(executor, "supply_content_pack", None)
        if callable(supply_content):
            supply_content(resolved_content.source if resolved_content else None)

        attempt_id = active.envelope["attemptId"]
        if active.pending_outcome:
            if sync_error is not None:
                return self._offline(attempt_id, sync_error)
            sync_error = self._retryable_sync(
                lambda: self.flush_pending_telemetry(active, registration.runner_id)
            )
            if sync_error is not None:
                return self._offline(attempt_id, sync_error)
            self._queue_update(active, registration.runner_id, active.pending_outcome)
            sync_error = self._retryable_sync(self.flush_pending_updates)
            if sync_error is not None:
                return self._offline(attempt_id, sync_error)
            return RunOnceResult(
                status=(
                    "completed" if active.pending_outcome == "complete" else "cancelled"
                ),
                attempt_id=attempt_id,
            )
        recovering = active.stage == "running"
        if recovering:
            if sync_error is None:
                sync_error = self._sync_running(
                    active, registration.runner_id, "recovering"
                )
        else:
            if sync_error is not None:
                raise sync_error
            self.flush_pending_telemetry(active, registration.runner_id)
            self.heartbeat("preparing")
        if active.stage != "running":
            try:
                self.state.update_stage(attempt_id, "preparing")
                executor.prepare(active.envelope, active.configuration)
            except AttemptExecutionError as error:
                self._report_failure(active, registration.runner_id, error.failure_kind)
                return RunOnceResult(
                    status="failed", attempt_id=attempt_id, detail=str(error)
                )
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
            if recovering and active.runtime_metadata is not None:
                restore = getattr(executor, "restore_runtime", None)
                if callable(restore):
                    restore(active.runtime_metadata)
            outcome = executor.execute(
                active.envelope,
                active.configuration,
                recovering=recovering,
                emit_telemetry=self.state.queue_telemetry,
            )
            runtime_metadata = getattr(executor, "runtime_metadata", None)
            if callable(runtime_metadata):
                self.state.save_runtime_metadata(attempt_id, runtime_metadata())
        except AttemptExecutionError as error:
            self._report_failure(active, registration.runner_id, error.failure_kind)
            return RunOnceResult(
                status="failed", attempt_id=attempt_id, detail=str(error)
            )
        except Exception:
            self._report_failure(active, registration.runner_id, "runner-crash")
            raise
        active = self.state.load_active_run()
        if active is None:
            raise RuntimeError("Active attempt disappeared during execution")
        if outcome.action == "continue":
            if sync_error is None:
                sync_error = self._sync_running(
                    active, registration.runner_id, "running"
                )
            if sync_error is not None:
                return self._offline(attempt_id, sync_error)
            return RunOnceResult(status="running", attempt_id=attempt_id)
        self.state.mark_execution_outcome(attempt_id, outcome.action)
        active = self.state.load_active_run()
        if active is None:
            raise RuntimeError("Active attempt disappeared after its outcome")
        if sync_error is not None:
            return self._offline(attempt_id, sync_error)
        sync_error = self._retryable_sync(
            lambda: self.flush_pending_telemetry(active, registration.runner_id)
        )
        if sync_error is not None:
            return self._offline(attempt_id, sync_error)
        self._queue_update(active, registration.runner_id, outcome.action)
        sync_error = self._retryable_sync(self.flush_pending_updates)
        if sync_error is not None:
            return self._offline(attempt_id, sync_error)
        return RunOnceResult(
            status="completed" if outcome.action == "complete" else "cancelled",
            attempt_id=attempt_id,
        )

    def _sync_running(
        self,
        active: ActiveRun,
        runner_id: str,
        runtime_state: str,
    ) -> RunnerApiError | None:
        error = self._retryable_sync(
            lambda: self.flush_pending_telemetry(active, runner_id)
        )
        if error is not None:
            return error
        return self._retryable_sync(lambda: self.heartbeat(runtime_state))

    @staticmethod
    def _retryable_sync(operation: Callable[[], object]) -> RunnerApiError | None:
        try:
            operation()
        except RunnerApiError as error:
            if not error.retryable:
                raise
            return error
        return None

    @staticmethod
    def _offline(attempt_id: str, error: RunnerApiError) -> RunOnceResult:
        return RunOnceResult(
            status="offline", attempt_id=attempt_id, detail=str(error)
        )

    def flush_pending_telemetry(self, active: ActiveRun, runner_id: str) -> None:
        while pending := self.state.list_pending_telemetry(
            active.envelope["attemptId"]
        ):
            response = self.client.upload_telemetry(
                {
                    "kind": "telemetry-upload-request",
                    "runnerId": runner_id,
                    "attemptId": active.envelope["attemptId"],
                    "leaseId": active.envelope["lease"]["leaseId"],
                    "events": [item.envelope for item in pending],
                }
            )
            acknowledged = sorted(
                set(response["acceptedSequences"]) | set(response["duplicateSequences"])
            )
            expected = [item.sequence for item in pending]
            if acknowledged != expected:
                raise RuntimeError(
                    "Telemetry server did not acknowledge the full batch"
                )
            self.state.acknowledge_telemetry(active.envelope["attemptId"], acknowledged)

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
