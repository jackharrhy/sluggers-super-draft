from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from starworks_runner.contracts import validate_contract
from starworks_runner.match_configuration import (
    CompiledMatchConfiguration,
    compile_match_configuration,
)


@dataclass(frozen=True)
class BoundMatchExecution:
    envelope: dict[str, Any]
    configuration: dict[str, Any]
    compiled: CompiledMatchConfiguration


def bind_match_execution(
    envelope: dict[str, Any], configuration: dict[str, Any]
) -> BoundMatchExecution:
    validate_contract("run-envelope", envelope)
    validate_contract("match-configuration-package", configuration)
    for field in ("leagueId", "matchId", "attemptId", "attemptNonce"):
        if envelope[field] != configuration[field]:
            raise ValueError(f"Match configuration {field} does not match its lease")
    if envelope["statProfileRevisionId"] != configuration["statProfile"]["revisionId"]:
        raise ValueError("Match configuration stat profile does not match its lease")
    if envelope["rulesetRevisionId"] != configuration["ruleset"]["revisionId"]:
        raise ValueError("Match configuration ruleset does not match its lease")
    content_pack = configuration["contentPack"]
    if envelope["contentPackRevisionId"] != (
        content_pack["revisionId"] if content_pack else None
    ):
        raise ValueError("Match configuration content pack does not match its lease")

    selections = {team["side"]: team for team in envelope["teams"]}
    for team in configuration["teams"]:
        selection = selections[team["side"]]
        lineup = team["lineup"]
        for envelope_field, lineup_field in (
            ("teamId", "teamId"),
            ("rosterRevisionId", "rosterRevisionId"),
            ("lineupRevisionId", "lineupRevisionId"),
        ):
            if selection[envelope_field] != lineup[lineup_field]:
                raise ValueError(
                    f"{team['side']} {lineup_field} does not match its lease"
                )
    return BoundMatchExecution(
        envelope=envelope,
        configuration=configuration,
        compiled=compile_match_configuration(configuration),
    )
