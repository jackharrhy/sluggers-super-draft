from __future__ import annotations

import json
from pathlib import Path

import pytest
from starworks_runner.state import (
    ActiveRunConflict,
    RunnerStateInUse,
    RunnerStateStore,
    StationRegistration,
)


def load_run_envelope() -> dict[str, object]:
    path = (
        Path(__file__).resolve().parents[2]
        / "contracts/fixtures/valid/run-envelope.json"
    )
    return json.loads(path.read_text(encoding="utf-8"))


def load_match_configuration() -> dict[str, object]:
    path = (
        Path(__file__).resolve().parents[2]
        / "contracts/fixtures/valid/match-configuration-package.json"
    )
    return json.loads(path.read_text(encoding="utf-8"))


def execution_fixtures() -> tuple[dict[str, object], dict[str, object]]:
    envelope = load_run_envelope()
    configuration = load_match_configuration()
    envelope.update(
        {
            "leagueId": configuration["leagueId"],
            "matchId": configuration["matchId"],
            "attemptId": configuration["attemptId"],
            "attemptNonce": configuration["attemptNonce"],
            "statProfileRevisionId": configuration["statProfile"]["revisionId"],  # type: ignore[index]
            "rulesetRevisionId": configuration["ruleset"]["revisionId"],  # type: ignore[index]
        }
    )
    teams = configuration["teams"]
    assert isinstance(teams, list)
    envelope["teams"] = [
        {
            "side": team["side"],
            "teamId": team["lineup"]["teamId"],
            "rosterRevisionId": team["lineup"]["rosterRevisionId"],
            "lineupRevisionId": team["lineup"]["lineupRevisionId"],
        }
        for team in teams
    ]
    return envelope, configuration


def test_active_run_and_pending_terminal_update_survive_restart(tmp_path: Path) -> None:
    database_path = tmp_path / "runner.sqlite3"
    envelope, configuration = execution_fixtures()
    registration = StationRegistration(
        runner_id="eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
        heartbeat_seconds=15,
        lease_seconds=60,
    )
    update = {
        "kind": "runner-lease-update-request",
        "runnerId": registration.runner_id,
        "attemptId": envelope["attemptId"],
        "leaseId": envelope["lease"]["leaseId"],
        "action": "complete",
        "failureKind": None,
        "observedAt": "2026-08-10T12:12:00Z",
    }
    with RunnerStateStore(database_path) as state:
        state.save_registration(registration)
        accepted = state.accept_run(envelope)
        state.accept_run(envelope)
        state.save_configuration(envelope["attemptId"], configuration)
        state.update_stage(envelope["attemptId"], "running")
        runtime_metadata = {
            "kind": "sluggers-live-session",
            "processId": 4242,
            "processIdentitySha256": "c" * 64,
        }
        state.save_runtime_metadata(envelope["attemptId"], runtime_metadata)
        telemetry = {
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
        state.queue_telemetry(telemetry)
        state.mark_execution_outcome(envelope["attemptId"], "complete")
        state.queue_update(f"{envelope['attemptId']}:complete", update)
        assert accepted.stage == "claimed"

    with RunnerStateStore(database_path) as recovered:
        assert recovered.load_registration() == registration
        assert recovered.load_active_run().stage == "running"  # type: ignore[union-attr]
        assert recovered.load_active_run().configuration == configuration  # type: ignore[union-attr]
        assert recovered.load_active_run().pending_outcome == "complete"  # type: ignore[union-attr]
        assert recovered.load_active_run().runtime_metadata == runtime_metadata  # type: ignore[union-attr]
        spooled = recovered.list_pending_telemetry(envelope["attemptId"])
        assert spooled[0].envelope == telemetry
        recovered.acknowledge_telemetry(envelope["attemptId"], [1])
        pending = recovered.list_pending_updates()
        assert pending[0].message == update
        recovered.acknowledge_update(pending[0].event_id)
        assert recovered.load_active_run() is None
        assert recovered.list_pending_updates() == []


def test_store_refuses_a_different_attempt_while_one_is_active(
    tmp_path: Path,
) -> None:
    envelope = load_run_envelope()
    other = {**envelope, "attemptId": "aaaaaaaa-1111-4111-8111-111111111111"}
    with RunnerStateStore(tmp_path / "runner.sqlite3") as state:
        state.accept_run(envelope)
        with pytest.raises(ActiveRunConflict):
            state.accept_run(other)


def test_store_has_single_process_ownership(tmp_path: Path) -> None:
    database_path = tmp_path / "runner.sqlite3"
    first = RunnerStateStore(database_path)

    with pytest.raises(RunnerStateInUse, match="already in use"):
        RunnerStateStore(database_path)

    first.close()
    with RunnerStateStore(database_path):
        pass
