from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest
from starworks_runner.compiler import compile_adapter_operations
from starworks_runner.contracts import validate_contract

FIXTURES = Path(__file__).resolve().parents[2] / "contracts" / "fixtures" / "valid"


def test_compiler_translates_published_configuration_deterministically() -> None:
    arguments = {
        "profile": _fixture("stat-profile-revision"),
        "ruleset": _fixture("ruleset-revision"),
        "lineup": _fixture("team-lineup-revision"),
        "adapter_version": "0.1.0",
        "generated_at": "2026-08-10T14:00:00Z",
    }
    first = compile_adapter_operations(**arguments)
    second = compile_adapter_operations(**arguments)

    assert second == first
    assert len(first["operations"]) == 32
    assert first["operations"][0] == {
        "operation": "set-character-stat",
        "characterId": "mario",
        "statKey": "batting.slap-power",
        "gameplayTarget": "character.batting.slapPower",
        "loadPhase": "build-time",
        "resource": "dt-na-dat",
        "codec": "u16-be",
        "value": 96,
    }
    assert "address" not in json.dumps(first)
    assert "draft.timer-seconds" not in json.dumps(first)
    validate_contract("adapter-operation-bundle", first)


def test_compiler_refuses_a_draft_revision() -> None:
    profile = _fixture("stat-profile-revision")
    profile["status"] = "draft"
    profile["publishedAt"] = None
    with pytest.raises(ValueError, match="must be published"):
        compile_adapter_operations(
            profile=profile,
            ruleset=_fixture("ruleset-revision"),
            lineup=_fixture("team-lineup-revision"),
            adapter_version="0.1.0",
            generated_at="2026-08-10T14:00:00Z",
        )


def test_compiler_keeps_full_stat_editor_profile_in_one_build_operation() -> None:
    profile = _fixture("stat-profile-revision")
    character_ids = [f"rmbe01-character-{index:03d}" for index in range(101)]
    profile["characterValues"] = [
        {
            "characterId": character_id,
            "values": {
                "batting.slap-power": 96,
                "batting.trajectory": "medium",
            },
        }
        for character_id in character_ids
    ]
    profile["sluggersTuning"] = _tuning(character_ids)

    result = compile_adapter_operations(
        profile=profile,
        ruleset=_fixture("ruleset-revision"),
        lineup=_fixture("team-lineup-revision"),
        adapter_version="0.3.3",
        generated_at="2026-08-10T14:00:00Z",
    )

    operation = result["operations"][0]
    assert operation["operation"] == "apply-sluggers-stat-profile"
    assert len(operation["characterValues"]) == 101
    assert not any(
        item["operation"] == "set-character-stat" for item in result["operations"]
    )
    validate_contract("adapter-operation-bundle", result)


def _fixture(name: str) -> dict[str, Any]:
    return json.loads((FIXTURES / f"{name}.json").read_text(encoding="utf-8"))


def _tuning(character_ids: list[str]) -> dict[str, Any]:
    def matrix(rows: int, columns: int) -> list[list[int]]:
        return [[0 for _ in range(columns)] for _ in range(rows)]

    return {
        "characterIdsByIndex": character_ids,
        "chemistry": matrix(101, 101),
        "trajectoryTables": matrix(24, 25),
        "trajectoryNames": ["Medium", "High", "Low", "Group 3", "Group 4", "Group 5"],
        "trajectoryActivation": [1, 1, 1, 1, 1, 1],
        "globalSpeedCurves": matrix(43, 2),
        "teamStarEvents": matrix(12, 41),
        "starBoosts": matrix(16, 4),
        "starHandicaps": matrix(4, 2),
        "handicapParameters": [[2, 8, 1], [2, 24, 3]],
        "importSource": {"format": "stat-editor-v4", "sha256": "a" * 64},
    }
