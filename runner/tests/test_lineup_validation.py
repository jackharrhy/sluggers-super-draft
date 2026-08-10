from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest
from starworks_runner.validation import validate_team_lineup_revision

FIXTURE_PATH = (
    Path(__file__).resolve().parents[2]
    / "contracts"
    / "fixtures"
    / "lineup-validation"
    / "cases.json"
)
CASES = json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))["cases"]


@pytest.mark.parametrize("fixture_case", CASES, ids=lambda case: case["name"])
def test_shared_lineup_validation_fixture(fixture_case: dict[str, Any]) -> None:
    revision = {
        "rosterCharacterIds": fixture_case["rosterCharacterIds"],
        "lineup": fixture_case["lineup"],
    }
    assert validate_team_lineup_revision(revision) == fixture_case["expectedIssues"]
