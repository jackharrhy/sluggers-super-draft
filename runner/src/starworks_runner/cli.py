from __future__ import annotations

import argparse
import json
from pathlib import Path

from starworks_runner.contracts import CONTRACT_NAMES, validate_contract


def validate_contract_fixtures(contracts_directory: Path) -> None:
    fixture_directory = contracts_directory / "fixtures" / "valid"
    for name in CONTRACT_NAMES:
        fixture_path = fixture_directory / f"{name}.json"
        with fixture_path.open(encoding="utf-8") as fixture_file:
            validate_contract(name, json.load(fixture_file), contracts_directory)
        print(f"validated {fixture_path}")


def create_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="starworks-runner")
    subparsers = parser.add_subparsers(dest="command", required=True)
    validate_parser = subparsers.add_parser(
        "validate-contracts", help="validate the shared contract fixtures"
    )
    validate_parser.add_argument(
        "--contracts-directory",
        type=Path,
        default=Path(__file__).resolve().parents[3] / "contracts",
    )
    return parser


def main() -> None:
    arguments = create_parser().parse_args()
    if arguments.command == "validate-contracts":
        validate_contract_fixtures(arguments.contracts_directory.resolve())
