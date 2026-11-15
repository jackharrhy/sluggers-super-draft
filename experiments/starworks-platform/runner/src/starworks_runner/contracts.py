from __future__ import annotations

import json
import os
from functools import cache
from pathlib import Path
from typing import Any, Literal, cast

from jsonschema import Draft202012Validator, FormatChecker

ContractName = Literal[
    "adapter-operation-bundle",
    "broadcast-overlay",
    "content-pack-manifest",
    "game-build-manifest",
    "match-configuration-package",
    "run-envelope",
    "runner-control",
    "ruleset-revision",
    "stat-profile-revision",
    "team-lineup-revision",
    "telemetry-envelope",
    "telemetry-upload",
]

CONTRACT_NAMES: tuple[ContractName, ...] = (
    "adapter-operation-bundle",
    "broadcast-overlay",
    "content-pack-manifest",
    "game-build-manifest",
    "match-configuration-package",
    "run-envelope",
    "runner-control",
    "ruleset-revision",
    "stat-profile-revision",
    "team-lineup-revision",
    "telemetry-envelope",
    "telemetry-upload",
)


def default_contracts_directory() -> Path:
    configured = os.environ.get("STARWORKS_CONTRACTS_DIR")
    if configured:
        return Path(configured).expanduser().resolve()
    packaged = Path(__file__).resolve().parent / "contract_schemas"
    if packaged.is_dir():
        return packaged
    return Path(__file__).resolve().parents[3] / "contracts"


@cache
def load_schema(
    name: ContractName, contracts_directory: Path | None = None
) -> dict[str, Any]:
    root = (contracts_directory or default_contracts_directory()).resolve()
    schema_path = root / "generated" / f"{name}.schema.json"
    with schema_path.open(encoding="utf-8") as schema_file:
        schema = cast(dict[str, Any], json.load(schema_file))
    Draft202012Validator.check_schema(schema)
    return schema


def validate_contract(
    name: ContractName,
    document: object,
    contracts_directory: Path | None = None,
) -> None:
    validator = Draft202012Validator(
        load_schema(name, contracts_directory),
        format_checker=FormatChecker(),
    )
    validator.validate(document)
