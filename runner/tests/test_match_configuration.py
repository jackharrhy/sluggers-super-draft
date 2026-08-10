from __future__ import annotations

import json
from pathlib import Path

import pytest

from starworks_runner.match_configuration import compile_match_configuration


def load_configuration() -> dict[str, object]:
    path = (
        Path(__file__).resolve().parents[2]
        / "contracts/fixtures/valid/match-configuration-package.json"
    )
    return json.loads(path.read_text(encoding="utf-8"))


def test_match_configuration_compiles_both_sides_and_applies_runtime_override() -> None:
    compiled = compile_match_configuration(load_configuration())  # type: ignore[arg-type]

    assert compiled.home["lineupRevisionId"] == "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
    assert compiled.away["lineupRevisionId"] == "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"
    for bundle in (compiled.home, compiled.away):
        inning_rule = next(
            operation
            for operation in bundle["operations"]
            if operation["operation"] == "set-game-rule"
            and operation["ruleKey"] == "game.innings"
        )
        assert inning_rule["value"] == 7
        assert "address" not in json.dumps(bundle)


def test_match_configuration_rejects_unknown_dynamic_rule() -> None:
    configuration = load_configuration()
    configuration["dynamicRuleOverrides"] = {"memory.80000000": 1}

    with pytest.raises(ValueError, match="not a runtime ruleset setting"):
        compile_match_configuration(configuration)  # type: ignore[arg-type]
