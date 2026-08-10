from __future__ import annotations

import copy
from dataclasses import dataclass
from typing import Any

from starworks_runner.compiler import compile_adapter_operations
from starworks_runner.contracts import validate_contract


@dataclass(frozen=True)
class CompiledMatchConfiguration:
    home: dict[str, Any]
    away: dict[str, Any]


def compile_match_configuration(
    configuration: dict[str, Any],
) -> CompiledMatchConfiguration:
    validate_contract("match-configuration-package", configuration)
    ruleset = copy.deepcopy(configuration["ruleset"])
    settings = {setting["key"]: setting for setting in ruleset["settings"]}
    for key, value in configuration["dynamicRuleOverrides"].items():
        setting = settings.get(key)
        if setting is None or setting["loadPhase"] != "runtime":
            raise ValueError(
                f"Dynamic rule override {key} is not a runtime ruleset setting"
            )
        if not _same_scalar_type(setting["value"], value):
            raise ValueError(f"Dynamic rule override {key} changes value type")
        setting["value"] = value

    compiled: dict[str, dict[str, Any]] = {}
    for team in configuration["teams"]:
        bundle = compile_adapter_operations(
            profile=configuration["statProfile"],
            ruleset=ruleset,
            lineup=team["lineup"],
            adapter_version=configuration["adapterVersion"],
            generated_at=configuration["generatedAt"],
        )
        validate_contract("adapter-operation-bundle", bundle)
        compiled[team["side"]] = bundle
    return CompiledMatchConfiguration(home=compiled["home"], away=compiled["away"])


def _same_scalar_type(left: object, right: object) -> bool:
    if left is None or right is None:
        return left is right
    if isinstance(left, bool) or isinstance(right, bool):
        return isinstance(left, bool) and isinstance(right, bool)
    if isinstance(left, (int, float)) or isinstance(right, (int, float)):
        return (
            isinstance(left, (int, float))
            and not isinstance(left, bool)
            and isinstance(right, (int, float))
            and not isinstance(right, bool)
        )
    return isinstance(left, str) and isinstance(right, str)
