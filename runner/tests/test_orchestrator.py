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
        self.updates: list[str] = []
        self.heartbeats: list[str] = []

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


class RecordingExecutor:
    def __init__(self) -> None:
        self.prepared = 0
        self.executions: list[bool] = []

    def prepare(self, envelope: dict[str, Any], configuration: dict[str, Any]) -> None:
        self.prepared += 1

    def execute(
        self,
        envelope: dict[str, Any],
        configuration: dict[str, Any],
        *,
        recovering: bool,
    ) -> ExecutionOutcome:
        self.executions.append(recovering)
        return ExecutionOutcome()


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
