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


def _strings(value: object) -> list[str]:
    if not isinstance(value, list) or not all(isinstance(item, str) for item in value):
        raise TypeError("expected an array of strings")
    return value


def _add_if(
    issues: list[LineupIssueCode], condition: bool, code: LineupIssueCode
) -> None:
    if condition:
        issues.append(code)
