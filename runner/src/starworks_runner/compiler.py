from __future__ import annotations

from typing import Any

from starworks_runner.validation import (
    validate_stat_profile_revision,
    validate_team_lineup_revision,
)


def compile_adapter_operations(
    *,
    profile: dict[str, Any],
    ruleset: dict[str, Any],
    lineup: dict[str, Any],
    adapter_version: str,
    generated_at: str,
    match_lineup_override_id: str | None = None,
) -> dict[str, Any]:
    _require_published(profile, "stat profile")
    _require_published(ruleset, "ruleset")
    _require_published(lineup, "lineup")
    league_ids = {profile["leagueId"], ruleset["leagueId"], lineup["leagueId"]}
    if len(league_ids) != 1:
        raise ValueError("Configuration revisions belong to different leagues")
    stat_issues = validate_stat_profile_revision(profile)
    if stat_issues:
        raise ValueError(f"Stat profile is invalid: {', '.join(stat_issues)}")
    lineup_issues = validate_team_lineup_revision(lineup)
    if lineup_issues:
        raise ValueError(f"Lineup is invalid: {', '.join(lineup_issues)}")

    operations: list[dict[str, Any]] = []
    definitions = {
        definition["key"]: definition for definition in profile["definitions"]
    }
    character_values = sorted(
        profile["characterValues"], key=lambda assignment: assignment["characterId"]
    )
    for assignment in character_values:
        for key, value in sorted(assignment["values"].items()):
            mapping = definitions[key].get("gameplayMapping")
            if mapping is None:
                continue
            operations.append(
                {
                    "operation": "set-character-stat",
                    "characterId": assignment["characterId"],
                    "statKey": key,
                    "gameplayTarget": mapping["target"]["field"],
                    "loadPhase": mapping["loadPhase"],
                    "resource": mapping["target"]["resource"],
                    "codec": mapping["target"]["codec"],
                    "value": value,
                }
            )
    for setting in sorted(ruleset["settings"], key=lambda item: item["key"]):
        if setting["loadPhase"] == "web-only":
            continue
        gameplay_target = setting.get("gameplayTarget")
        if gameplay_target is None:
            raise ValueError(f"Game rule {setting['key']} has no gameplay target")
        operations.append(
            {
                "operation": "set-game-rule",
                "ruleKey": setting["key"],
                "loadPhase": setting["loadPhase"],
                "gameplayTarget": gameplay_target,
                "value": setting["value"],
            }
        )
    for slot, character_id in enumerate(lineup["rosterCharacterIds"]):
        operations.append(
            {
                "operation": "select-roster-slot",
                "slot": slot,
                "characterId": character_id,
            }
        )
    operations.append(
        {
            "operation": "set-captain",
            "characterId": lineup["lineup"]["captainCharacterId"],
        }
    )
    for slot, character_id in enumerate(lineup["lineup"]["battingOrder"], 1):
        operations.append(
            {
                "operation": "set-batting-slot",
                "slot": slot,
                "characterId": character_id,
            }
        )
    for assignment in lineup["lineup"]["fielding"]:
        operations.append(
            {
                "operation": "set-fielding-position",
                "position": assignment["position"],
                "characterId": assignment["characterId"],
            }
        )

    return {
        "schemaVersion": 1,
        "kind": "adapter-operation-bundle",
        "adapterId": "sluggers-rmbe01",
        "adapterVersion": adapter_version,
        "leagueId": profile["leagueId"],
        "statProfileRevisionId": profile["revisionId"],
        "rulesetRevisionId": ruleset["revisionId"],
        "rosterRevisionId": lineup["rosterRevisionId"],
        "lineupRevisionId": lineup["lineupRevisionId"],
        "matchLineupOverrideId": match_lineup_override_id,
        "operations": operations,
        "generatedAt": generated_at,
    }


def _require_published(revision: dict[str, Any], name: str) -> None:
    if revision["status"] != "published":
        raise ValueError(f"{name} must be published")
