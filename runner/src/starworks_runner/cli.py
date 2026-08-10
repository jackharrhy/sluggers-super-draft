from __future__ import annotations

import argparse
import json
import sys
import tempfile
from pathlib import Path

from starworks_runner.contracts import CONTRACT_NAMES, validate_contract
from starworks_runner.games.sluggers.builder import BuildRequest, GameBuildService
from starworks_runner.games.sluggers.dolphin import DolphinLauncher
from starworks_runner.games.sluggers.errors import SluggersAdapterError
from starworks_runner.games.sluggers.fingerprints import (
    SupportedBaseRegistry,
    fingerprint_extraction,
)
from starworks_runner.games.sluggers.tools import (
    DtkDiscTool,
    dtk_asset_for_current_platform,
    install_dtk,
    load_dtk_release,
)


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

    install_parser = subparsers.add_parser(
        "install-dtk", help="install the pinned decomp-toolkit release"
    )
    install_parser.add_argument("--tool-directory", type=Path, required=True)

    build_parser = subparsers.add_parser(
        "build-sluggers", help="verify a user-owned image and create a managed build"
    )
    build_parser.add_argument("--image", type=Path, required=True)
    build_parser.add_argument("--cache", type=Path, required=True)
    build_parser.add_argument("--dtk", type=Path)
    build_parser.add_argument("--supported-bases", type=Path)
    build_parser.add_argument(
        "--content-pack-sha256",
        default="e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    )
    build_parser.add_argument("--adapter-version", default="0.1.0")
    build_parser.add_argument("--compiler-version", default="0.1.0")

    fingerprint_parser = subparsers.add_parser(
        "fingerprint-sluggers",
        help="inspect a clean image and print a candidate supported-base fingerprint",
    )
    fingerprint_parser.add_argument("--image", type=Path, required=True)
    fingerprint_parser.add_argument("--dtk", type=Path, required=True)

    launch_parser = subparsers.add_parser(
        "launch-sluggers", help="launch a verified managed build in pinned Dolphin"
    )
    launch_parser.add_argument("--build-directory", type=Path, required=True)
    launch_parser.add_argument("--dolphin", type=Path, required=True)
    launch_parser.add_argument("--profile", type=Path, required=True)
    launch_parser.add_argument("--wait", action="store_true")
    return parser


def _resolve_dtk(explicit_path: Path | None, cache: Path) -> Path:
    if explicit_path is not None:
        return explicit_path
    release = load_dtk_release()
    asset = dtk_asset_for_current_platform(release)
    return (
        cache.expanduser().resolve()
        / "tools"
        / "dtk"
        / release.version
        / asset.file_name
    )


def run(arguments: argparse.Namespace) -> int:
    if arguments.command == "validate-contracts":
        validate_contract_fixtures(arguments.contracts_directory.resolve())
        return 0
    if arguments.command == "install-dtk":
        installed = install_dtk(arguments.tool_directory)
        print(json.dumps({"installed": str(installed)}, sort_keys=True))
        return 0
    if arguments.command == "build-sluggers":
        cache = arguments.cache.expanduser().resolve()
        tool = DtkDiscTool(_resolve_dtk(arguments.dtk, cache))
        registry = SupportedBaseRegistry.load(arguments.supported_bases)
        result = GameBuildService(tool, registry).build(
            BuildRequest(
                image_path=arguments.image,
                cache_root=cache,
                content_pack_sha256=arguments.content_pack_sha256,
                adapter_version=arguments.adapter_version,
                compiler_version=arguments.compiler_version,
            )
        )
        print(
            json.dumps(
                {
                    "buildDirectory": str(result.build_directory),
                    "buildSha256": result.manifest["buildSha256"],
                    "cacheHit": result.cache_hit,
                },
                sort_keys=True,
            )
        )
        return 0
    if arguments.command == "fingerprint-sluggers":
        image = arguments.image.expanduser().resolve()
        tool = DtkDiscTool(arguments.dtk)
        tool_sha256 = tool.verify_pinned_binary()
        identity = tool.inspect(image)
        verification = tool.verify_image(image)
        with tempfile.TemporaryDirectory(prefix="starworks-fingerprint-") as temporary:
            extracted = Path(temporary) / "extracted"
            tool.extract(image, extracted)
            fingerprint, files = fingerprint_extraction(
                extracted,
                expected_game_id=identity.game_id,
                expected_revision=identity.revision,
            )
        print(
            json.dumps(
                {
                    "baseGame": fingerprint.manifest_value(),
                    "files": [file.manifest_value() for file in files],
                    "redumpName": verification.redump_name,
                    "dtkSha256": tool_sha256,
                },
                indent=2,
                sort_keys=True,
            )
        )
        return 0
    if arguments.command == "launch-sluggers":
        launch = DolphinLauncher(arguments.dolphin).launch(
            arguments.build_directory, arguments.profile
        )
        print(json.dumps({"command": launch.command, "pid": launch.process.pid}))
        if arguments.wait:
            return launch.process.wait()
        return 0
    raise AssertionError(f"Unhandled command {arguments.command}")


def main() -> None:
    parser = create_parser()
    arguments = parser.parse_args()
    try:
        raise SystemExit(run(arguments))
    except SluggersAdapterError as error:
        print(f"starworks-runner: {error}", file=sys.stderr)
        raise SystemExit(2) from error
