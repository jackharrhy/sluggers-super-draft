from __future__ import annotations

from typing import Any

LineupIssueCode = str

FIELDING_POSITIONS = {"P", "C", "1B", "2B", "3B", "SS", "LF", "CF", "RF"}


def validate_team_lineup_revision(revision: dict[str, Any]) -> list[LineupIssueCode]:
    issues: list[LineupIssueCode] = []
    roster = _strings(revision["rosterCharacterIds"])
    lineup = revision["lineup"]
    if not isinstance(lineup, dict):
        raise TypeError("lineup must be an object")
    active = _strings(lineup["battingOrder"])
    bench = _strings(lineup["bench"])
    fielding = lineup["fielding"]
    if not isinstance(fielding, list):
        raise TypeError("fielding must be an array")

    roster_set = set(roster)
    active_set = set(active)
    bench_set = set(bench)
    _add_if(issues, len(roster_set) != len(roster), "duplicate-roster-character")
    _add_if(issues, len(active) != 9, "batting-order-must-have-nine")
    _add_if(issues, len(active_set) != len(active), "duplicate-batting-character")
    _add_if(
        issues,
        any(character not in roster_set for character in active),
        "active-character-not-on-roster",
    )
    _add_if(issues, len(bench_set) != len(bench), "duplicate-bench-character")
    _add_if(
        issues,
        any(character not in roster_set for character in bench),
        "bench-character-not-on-roster",
    )
    _add_if(
        issues,
        any(character in bench_set for character in active),
        "active-bench-overlap",
    )
    _add_if(
        issues,
        len(active_set | bench_set) != len(roster_set)
        or any(
            character not in active_set and character not in bench_set
            for character in roster
        ),
        "roster-partition-incomplete",
    )
    _add_if(
        issues,
        lineup["captainCharacterId"] not in active_set,
        "captain-not-active",
    )
    _add_if(
        issues,
        lineup["pitcherCharacterId"] not in active_set,
        "pitcher-not-active",
    )

    positions = {
        assignment["position"]
        for assignment in fielding
        if isinstance(assignment, dict)
    }
    _add_if(
        issues,
        len(fielding) != len(FIELDING_POSITIONS) or positions != FIELDING_POSITIONS,
        "fielding-positions-incomplete",
    )
    fielding_characters = [
        assignment["characterId"]
        for assignment in fielding
        if isinstance(assignment, dict)
    ]
    _add_if(
        issues,
        len(set(fielding_characters)) != len(fielding_characters),
        "duplicate-fielding-character",
    )
    _add_if(
        issues,
        any(character not in active_set for character in fielding_characters),
        "fielding-character-not-active",
    )
    pitcher_assignment = next(
        (
            assignment
            for assignment in fielding
            if isinstance(assignment, dict) and assignment.get("position") == "P"
        ),
        None,
    )
    _add_if(
        issues,
        pitcher_assignment is None
        or pitcher_assignment.get("characterId") != lineup["pitcherCharacterId"],
        "pitcher-position-mismatch",
    )
    return issues


def validate_stat_profile_revision(revision: dict[str, Any]) -> list[str]:
    issues: list[str] = []
    definitions_by_key: dict[str, dict[str, Any]] = {}
    definition_ids: set[str] = set()
    definitions = revision["definitions"]
    if not isinstance(definitions, list):
        raise TypeError("definitions must be an array")
    for definition in definitions:
        if not isinstance(definition, dict):
            raise TypeError("definition must be an object")
        definition_id = str(definition["definitionId"])
        key = str(definition["key"])
        if definition_id in definition_ids:
            issues.append("duplicate-definition-id")
        definition_ids.add(definition_id)
        if key in definitions_by_key:
            issues.append("duplicate-definition-key")
        definitions_by_key[key] = definition
        if definition["dataType"] in {"integer", "number"} and float(
            definition["minimum"]
        ) > float(definition["maximum"]):
            issues.append("invalid-definition-range")
        if definition["dataType"] == "enum":
            choices = definition["choices"]
            values = [choice["value"] for choice in choices]
            if len(set(values)) != len(values):
                issues.append("duplicate-enum-choice")

    character_ids: set[str] = set()
    character_values = revision["characterValues"]
    if not isinstance(character_values, list):
        raise TypeError("characterValues must be an array")
    for assignment in character_values:
        if not isinstance(assignment, dict):
            raise TypeError("character assignment must be an object")
        character_id = str(assignment["characterId"])
        if character_id in character_ids:
            issues.append("duplicate-character")
        character_ids.add(character_id)
        values = assignment["values"]
        if not isinstance(values, dict):
            raise TypeError("character values must be an object")
        for key, value in values.items():
            definition = definitions_by_key.get(key)
            if definition is None:
                issues.append("unknown-stat-key")
            elif not _valid_stat_value(definition, value):
                issues.append("invalid-stat-value")
        for definition in definitions:
            if definition["required"] and definition["key"] not in values:
                issues.append("missing-required-value")
    return issues


def _valid_stat_value(definition: dict[str, Any], value: object) -> bool:
    data_type = definition["dataType"]
    if data_type == "boolean":
        return type(value) is bool
    if data_type == "enum":
        return isinstance(value, str) and any(
            choice["value"] == value for choice in definition["choices"]
        )
    if type(value) not in {int, float}:
        return False
    if data_type == "integer" and type(value) is not int:
        return False
    return float(definition["minimum"]) <= float(value) <= float(definition["maximum"])


def _strings(value: object) -> list[str]:
    if not isinstance(value, list) or not all(isinstance(item, str) for item in value):
        raise TypeError("expected an array of strings")
    return value


def _add_if(
    issues: list[LineupIssueCode], condition: bool, code: LineupIssueCode
) -> None:
    if condition:
        issues.append(code)
