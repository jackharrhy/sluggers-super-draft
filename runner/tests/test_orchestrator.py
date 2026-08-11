from __future__ import annotations

import json
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import pytest
from starworks_runner.control import RunnerApiError
from starworks_runner.orchestrator import (
    ExecutionOutcome,
    RunnerStation,
)
from starworks_runner.state import RunnerStateStore, StationRegistration

RUNNER_ID = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"


class FakeControlClient:
    def __init__(self, envelope: dict[str, Any], configuration: dict[str, Any]) -> None:
        self.envelope = envelope
        self.match_configuration = configuration
        self.claimed = False
        self.fail_complete_once = True
        self.fail_telemetry_once = False
        self.updates: list[str] = []
        self.heartbeats: list[str] = []
        self.telemetry_sequences: list[int] = []

    def register(
        self, station_name: str, capabilities: dict[str, Any]
    ) -> dict[str, Any]:
        return {
            "runnerId": RUNNER_ID,
            "heartbeatSeconds": 15,
            "leaseSeconds": 60,
        }

    def claim(self, runner_id: str) -> dict[str, Any]:
        if self.claimed:
            return {"run": None}
        self.claimed = True
        return {"run": self.envelope}

    def heartbeat(self, **message: Any) -> dict[str, Any]:
        self.heartbeats.append(message["state"])
        return {"accepted": True}

    def configuration(self, attempt_id: str) -> dict[str, Any]:
        assert attempt_id == self.envelope["attemptId"]
        return self.match_configuration

    def update_lease(self, message: dict[str, Any]) -> dict[str, Any]:
        action = message["action"]
        self.updates.append(action)
        if action == "complete" and self.fail_complete_once:
            self.fail_complete_once = False
            raise RunnerApiError("temporary outage")
        return {"attemptStatus": "provisional", "expiresAt": None}

    def upload_telemetry(self, message: dict[str, Any]) -> dict[str, Any]:
        if self.fail_telemetry_once:
            self.fail_telemetry_once = False
            raise RunnerApiError("telemetry outage")
        sequences = [event["sequence"] for event in message["events"]]
        self.telemetry_sequences.extend(sequences)
        return {
            "acceptedSequences": sequences,
            "duplicateSequences": [],
        }


class RecordingExecutor:
    def __init__(self, telemetry: dict[str, Any] | None = None) -> None:
        self.prepared = 0
        self.executions: list[bool] = []
        self.telemetry = telemetry

    def prepare(self, envelope: dict[str, Any], configuration: dict[str, Any]) -> None:
        self.prepared += 1

    def execute(
        self,
        envelope: dict[str, Any],
        configuration: dict[str, Any],
        *,
        recovering: bool,
        emit_telemetry: Any,
    ) -> ExecutionOutcome:
        self.executions.append(recovering)
        if self.telemetry:
            emit_telemetry(self.telemetry)
        return ExecutionOutcome()


class IncrementalExecutor(RecordingExecutor):
    def execute(
        self,
        envelope: dict[str, Any],
        configuration: dict[str, Any],
        *,
        recovering: bool,
        emit_telemetry: Any,
    ) -> ExecutionOutcome:
        self.executions.append(recovering)
        return ExecutionOutcome(
            action="continue" if len(self.executions) == 1 else "complete"
        )


class RecoverableExecutor(RecordingExecutor):
    def __init__(self, action: str) -> None:
        super().__init__()
        self.action = action
        self.restored: list[dict[str, Any]] = []

    def restore_runtime(self, metadata: dict[str, Any]) -> None:
        self.restored.append(metadata)

    def runtime_metadata(self) -> dict[str, Any]:
        return {"kind": "test-runtime", "processId": 42}

    def execute(
        self,
        envelope: dict[str, Any],
        configuration: dict[str, Any],
        *,
        recovering: bool,
        emit_telemetry: Any,
    ) -> ExecutionOutcome:
        self.executions.append(recovering)
        return ExecutionOutcome(action=self.action)  # type: ignore[arg-type]


def test_runner_recovers_unsent_completion_without_executing_twice(
    tmp_path: Path,
) -> None:
    envelope, configuration = execution_fixtures()
    client = FakeControlClient(envelope, configuration)
    executor = RecordingExecutor()
    state_path = tmp_path / "runner.sqlite3"
    with RunnerStateStore(state_path) as state:
        state.save_registration(StationRegistration(RUNNER_ID, 15, 60))
        station = create_station(client, state)
        with pytest.raises(RunnerApiError, match="temporary outage"):
            station.run_once(executor)
        assert state.load_active_run() is not None
        assert state.list_pending_updates()[0].message["action"] == "complete"
        assert executor.prepared == 1
        assert executor.executions == [False]

    with RunnerStateStore(state_path) as recovered_state:
        result = create_station(client, recovered_state).run_once(executor)
        assert result.status == "no-work"
        assert recovered_state.load_active_run() is None
        assert executor.prepared == 1
        assert executor.executions == [False]
        assert client.updates == ["started", "complete", "complete"]


def test_runner_spools_telemetry_and_finishes_without_replaying_the_game(
    tmp_path: Path,
) -> None:
    envelope, configuration = execution_fixtures()
    telemetry = telemetry_fixture(envelope, configuration)
    client = FakeControlClient(envelope, configuration)
    client.fail_complete_once = False
    client.fail_telemetry_once = True
    executor = RecordingExecutor(telemetry)
    state_path = tmp_path / "runner.sqlite3"
    with RunnerStateStore(state_path) as state:
        state.save_registration(StationRegistration(RUNNER_ID, 15, 60))
        with pytest.raises(RunnerApiError, match="telemetry outage"):
            create_station(client, state).run_once(executor)
        active = state.load_active_run()
        assert active is not None
        assert active.pending_outcome == "complete"
        assert active.last_captured_sequence == 1
        assert [
            item.sequence
            for item in state.list_pending_telemetry(active.envelope["attemptId"])
        ] == [1]

    with RunnerStateStore(state_path) as recovered:
        result = create_station(client, recovered).run_once(executor)
        assert result.status == "completed"
        assert recovered.load_active_run() is None
        assert recovered.list_pending_telemetry(envelope["attemptId"]) == []
        assert executor.executions == [False]
        assert client.telemetry_sequences == [1]


def test_incremental_executor_keeps_the_attempt_running_until_game_end(
    tmp_path: Path,
) -> None:
    envelope, configuration = execution_fixtures()
    client = FakeControlClient(envelope, configuration)
    client.fail_complete_once = False
    executor = IncrementalExecutor()
    with RunnerStateStore(tmp_path / "runner.sqlite3") as state:
        state.save_registration(StationRegistration(RUNNER_ID, 15, 60))
        station = create_station(client, state)

        first = station.run_once(executor)
        active = state.load_active_run()

        assert first.status == "running"
        assert active is not None and active.stage == "running"
        assert active.pending_outcome is None
        assert client.updates == ["started"]
        assert client.heartbeats[-1] == "running"

        second = station.run_once(executor)

        assert second.status == "completed"
        assert state.load_active_run() is None
        assert executor.executions == [False, True]
        assert client.updates == ["started", "renew", "complete"]


def test_runner_persists_and_restores_live_runtime_identity(tmp_path: Path) -> None:
    envelope, configuration = execution_fixtures()
    client = FakeControlClient(envelope, configuration)
    client.fail_complete_once = False
    state_path = tmp_path / "runner.sqlite3"
    with RunnerStateStore(state_path) as state:
        state.save_registration(StationRegistration(RUNNER_ID, 15, 60))
        first = RecoverableExecutor("continue")
        result = create_station(client, state).run_once(first)
        assert result.status == "running"
        assert state.load_active_run().runtime_metadata == {  # type: ignore[union-attr]
            "kind": "test-runtime",
            "processId": 42,
        }

    with RunnerStateStore(state_path) as recovered_state:
        second = RecoverableExecutor("complete")
        result = create_station(client, recovered_state).run_once(second)
        assert result.status == "completed"
        assert second.executions == [True]
        assert second.restored == [{"kind": "test-runtime", "processId": 42}]


def create_station(client: FakeControlClient, state: RunnerStateStore) -> RunnerStation:
    return RunnerStation(
        client,  # type: ignore[arg-type]
        state,
        station_name="Desk one",
        capabilities={},
        clock=lambda: datetime(2026, 8, 10, 12, 0, tzinfo=UTC),
    )


def execution_fixtures() -> tuple[dict[str, Any], dict[str, Any]]:
    envelope_path = (
        Path(__file__).resolve().parents[2]
        / "contracts/fixtures/valid/run-envelope.json"
    )
    configuration_path = (
        Path(__file__).resolve().parents[2]
        / "contracts/fixtures/valid/match-configuration-package.json"
    )
    envelope = json.loads(envelope_path.read_text(encoding="utf-8"))
    configuration = json.loads(configuration_path.read_text(encoding="utf-8"))
    envelope.update(
        {
            "leagueId": configuration["leagueId"],
            "matchId": configuration["matchId"],
            "attemptId": configuration["attemptId"],
            "attemptNonce": configuration["attemptNonce"],
            "statProfileRevisionId": configuration["statProfile"]["revisionId"],
            "rulesetRevisionId": configuration["ruleset"]["revisionId"],
            "teams": [
                {
                    "side": team["side"],
                    "teamId": team["lineup"]["teamId"],
                    "rosterRevisionId": team["lineup"]["rosterRevisionId"],
                    "lineupRevisionId": team["lineup"]["lineupRevisionId"],
                }
                for team in configuration["teams"]
            ],
        }
    )
    return envelope, configuration


def telemetry_fixture(
    envelope: dict[str, Any], configuration: dict[str, Any]
) -> dict[str, Any]:
    return {
        "schemaVersion": 1,
        "kind": "telemetry-envelope",
        "protocolVersion": 1,
        "correlationId": envelope["correlationId"],
        "leagueId": envelope["leagueId"],
        "matchId": envelope["matchId"],
        "attemptId": envelope["attemptId"],
        "attemptNonce": envelope["attemptNonce"],
        "sequence": 1,
        "frame": 120,
        "eventType": "synthetic",
        "observationSource": "synthetic",
        "payload": {"value": 1},
        "adapterVersion": configuration["adapterVersion"],
        "gameBuildSha256": envelope["requiredGameBuildSha256"],
    }
