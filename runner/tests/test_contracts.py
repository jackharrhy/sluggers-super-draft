from __future__ import annotations

import json
from pathlib import Path

import pytest
from jsonschema import ValidationError
from starworks_runner.contracts import CONTRACT_NAMES, validate_contract

CONTRACTS_DIRECTORY = Path(__file__).resolve().parents[2] / "contracts"


def load_fixture(name: str) -> dict[str, object]:
    fixture_path = CONTRACTS_DIRECTORY / "fixtures" / "valid" / f"{name}.json"
    with fixture_path.open(encoding="utf-8") as fixture_file:
        return json.load(fixture_file)


@pytest.mark.parametrize("name", CONTRACT_NAMES)
def test_generated_schema_accepts_shared_fixture(name: str) -> None:
    validate_contract(name, load_fixture(name), CONTRACTS_DIRECTORY)  # type: ignore[arg-type]


@pytest.mark.parametrize("name", CONTRACT_NAMES)
def test_generated_schema_rejects_unknown_fields(name: str) -> None:
    fixture = load_fixture(name)
    fixture["arbitraryMemoryWrite"] = "80000000:DEADBEEF"
    with pytest.raises(ValidationError):
        validate_contract(name, fixture, CONTRACTS_DIRECTORY)  # type: ignore[arg-type]


def test_generated_schema_rejects_incompatible_version() -> None:
    fixture = load_fixture("run-envelope")
    fixture["schemaVersion"] = 2
    with pytest.raises(ValidationError):
        validate_contract("run-envelope", fixture, CONTRACTS_DIRECTORY)


def test_generated_schema_rejects_two_home_teams() -> None:
    fixture = load_fixture("run-envelope")
    teams = fixture["teams"]
    assert isinstance(teams, list)
    for team in teams:
        assert isinstance(team, dict)
        team["side"] = "home"
    with pytest.raises(ValidationError):
        validate_contract("run-envelope", fixture, CONTRACTS_DIRECTORY)
