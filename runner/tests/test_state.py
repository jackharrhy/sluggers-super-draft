from __future__ import annotations

import json
from pathlib import Path

import pytest

from starworks_runner.state import (
    ActiveRunConflict,
    RunnerStateStore,
    StationRegistration,
)


def load_run_envelope() -> dict[str, object]:
    path = (
        Path(__file__).resolve().parents[2]
        / "contracts/fixtures/valid/run-envelope.json"
    )
    return json.loads(path.read_text(encoding="utf-8"))


def test_active_run_and_pending_terminal_update_survive_restart(tmp_path: Path) -> None:
    database_path = tmp_path / "runner.sqlite3"
    envelope = load_run_envelope()
    registration = StationRegistration(
        runner_id="eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
        heartbeat_seconds=15,
        lease_seconds=60,
    )
    update = {
        "schemaVersion": 1,
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
        state.update_stage(envelope["attemptId"], "running")
        state.queue_update(f"{envelope['attemptId']}:complete", update)
        assert accepted.stage == "claimed"

    with RunnerStateStore(database_path) as recovered:
        assert recovered.load_registration() == registration
        assert recovered.load_active_run().stage == "running"  # type: ignore[union-attr]
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
