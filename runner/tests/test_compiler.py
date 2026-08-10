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


def _fixture(name: str) -> dict[str, Any]:
    return json.loads((FIXTURES / f"{name}.json").read_text(encoding="utf-8"))
