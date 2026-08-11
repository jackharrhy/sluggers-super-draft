from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import pytest
from starworks_runner.orchestrator import ExecutionOutcome, RunnerStation
from starworks_runner.state import RunnerStateStore
from starworks_runner.station import StationService
from test_orchestrator import FakeControlClient, execution_fixtures


class IncrementalExecutor:
    def __init__(self) -> None:
        self.executions = 0
        self.stopped = False

    def prepare(self, envelope: dict[str, Any], configuration: dict[str, Any]) -> None:
        pass

    def execute(
        self,
        envelope: dict[str, Any],
        configuration: dict[str, Any],
        *,
        recovering: bool,
        emit_telemetry: Any,
    ) -> ExecutionOutcome:
        self.executions += 1
        return ExecutionOutcome(
            action="continue" if self.executions == 1 else "complete"
        )

    def stop(self) -> None:
        self.stopped = True


def create_service(tmp_path: Path) -> tuple[StationService, IncrementalExecutor]:
    envelope, configuration = execution_fixtures()
    client = FakeControlClient(envelope, configuration)
    client.fail_complete_once = False
    state = RunnerStateStore(tmp_path / "runner.sqlite3")
    executor = IncrementalExecutor()
    station = RunnerStation(
        client,  # type: ignore[arg-type]
        state,
        station_name="Desk one",
        capabilities={},
        clock=lambda: datetime(2026, 8, 10, 12, 0, tzinfo=UTC),
    )
    return StationService(station, state, executor), executor


def test_service_owns_registration_tick_and_ui_snapshot(tmp_path: Path) -> None:
    service, _ = create_service(tmp_path)
    with service:
        registration, created = service.ensure_registered()
        duplicate, created_again = service.ensure_registered()

        assert created is True
        assert created_again is False
        assert duplicate == registration

        result = service.tick()
        snapshot = service.snapshot()

        assert result.status == "running"
        assert snapshot.registered is True
        assert snapshot.runner_id == registration.runner_id
        assert snapshot.attempt_id is not None
        assert snapshot.match_id is not None
        assert snapshot.stage == "running"
        assert snapshot.last_tick_status == "running"


def test_service_finishes_attempt_and_releases_executor(tmp_path: Path) -> None:
    service, executor = create_service(tmp_path)
    service.ensure_registered()
    service.tick()

    result = service.tick()
    snapshot = service.snapshot()

    assert result.status == "completed"
    assert snapshot.attempt_id is None
    assert snapshot.last_tick_status == "completed"

    service.close()
    assert executor.stopped is True
    service.close()
    with pytest.raises(RuntimeError, match="closed"):
        service.snapshot()
