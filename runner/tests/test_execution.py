from __future__ import annotations

import json
from pathlib import Path

import pytest

from starworks_runner.execution import bind_match_execution
from starworks_runner.synthetic_executor import SyntheticSluggersExecutor


def execution_fixtures() -> tuple[dict[str, object], dict[str, object]]:
    root = Path(__file__).resolve().parents[2] / "contracts/fixtures/valid"
    envelope = json.loads((root / "run-envelope.json").read_text(encoding="utf-8"))
    configuration = json.loads(
        (root / "match-configuration-package.json").read_text(encoding="utf-8")
    )
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


def test_synthetic_execution_binds_both_teams_and_attempt_nonce() -> None:
    envelope, configuration = execution_fixtures()
    executor = SyntheticSluggersExecutor()

    executor.prepare(envelope, configuration)  # type: ignore[arg-type]
    outcome = executor.execute(  # type: ignore[arg-type]
        envelope, configuration, recovering=False
    )

    assert outcome.action == "complete"
    assert executor.event_count == 1
    assert executor.bound is not None
    assert (
        executor.bound.compiled.home["lineupRevisionId"]
        == envelope["teams"][0]["lineupRevisionId"]
    )


def test_execution_refuses_configuration_from_another_attempt() -> None:
    envelope, configuration = execution_fixtures()
    configuration["attemptNonce"] = "different_attempt_nonce_0123456789ab"

    with pytest.raises(ValueError, match="attemptNonce"):
        bind_match_execution(envelope, configuration)  # type: ignore[arg-type]
