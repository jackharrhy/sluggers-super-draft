from __future__ import annotations

import hashlib
import io
import json
from datetime import UTC, datetime
from pathlib import Path, PurePosixPath

import pytest
from starworks_runner.contracts import validate_contract
from starworks_runner.games.sluggers.builder import BuildRequest, GameBuildService
from starworks_runner.games.sluggers.content import (
    ContentPackInput,
    StaticTargetCatalog,
    StaticValueTarget,
)
from starworks_runner.games.sluggers.dolphin import DolphinLauncher
from starworks_runner.games.sluggers.errors import (
    BuildIntegrityError,
    DolphinLaunchError,
    ToolVerificationError,
    UnsupportedBaseError,
)
from starworks_runner.games.sluggers.fingerprints import (
    SupportedBase,
    SupportedBaseRegistry,
    fingerprint_extraction,
)
from starworks_runner.games.sluggers.hashing import sha256_file
from starworks_runner.games.sluggers.patching import (
    GuardedWrite,
    PrecompiledPatchPlan,
    PrecompiledPatchSetApplier,
)
from starworks_runner.games.sluggers.tools import (
    DtkDiscTool,
    DtkRelease,
    ToolAsset,
    install_dtk,
)


def create_extraction(root: Path, *, dat_payload: bytes = b"clean dat") -> None:
    (root / "disc").mkdir(parents=True)
    (root / "sys").mkdir()
    (root / "files").mkdir()
    (root / "disc/header.bin").write_bytes(b"RMBE01\x00\x00" + bytes(248))
    (root / "sys/main.dol").write_bytes(b"synthetic clean main dol")
    (root / "files/dt_na.dat").write_bytes(dat_payload)
    (root / "sys/fst.bin").write_bytes(b"synthetic fst")
    (root / "sys/boot.bin").write_bytes(b"synthetic boot")


def create_fake_dtk(
    path: Path,
    *,
    dat_payload: str = "clean dat",
    version: str = "1.8.3",
    redump_line: str = "Mario Super Sluggers (USA)",
) -> str:
    script = f"""#!/usr/bin/env python3
import pathlib
import sys

args = sys.argv[1:]
if args == ["--version"]:
    print("decomp-toolkit {version}")
elif args[:2] == ["disc", "info"]:
    print("Format: RVZ")
    print("Game ID: RMBE01")
    print("Disc 1, Revision 0")
elif args[:2] == ["disc", "verify"]:
    print("Game ID: RMBE01")
    print("Redump: {redump_line}")
elif args[:2] == ["disc", "extract"]:
    root = pathlib.Path(args[3])
    (root / "disc").mkdir(parents=True)
    (root / "sys").mkdir()
    (root / "files").mkdir()
    (root / "disc" / "header.bin").write_bytes(b"RMBE01\\x00\\x00" + bytes(248))
    (root / "sys" / "main.dol").write_bytes(b"synthetic clean main dol")
    (root / "files" / "dt_na.dat").write_bytes({dat_payload!r}.encode())
    (root / "sys" / "fst.bin").write_bytes(b"synthetic fst")
    (root / "sys" / "boot.bin").write_bytes(b"synthetic boot")
else:
    print("unexpected arguments: " + repr(args), file=sys.stderr)
    raise SystemExit(9)
"""
    path.write_text(script, encoding="utf-8")
    path.chmod(0o755)
    return sha256_file(path)


def fake_release() -> DtkRelease:
    return DtkRelease(
        version="1.8.3",
        release_tag="v1.8.3",
        source_commit="e4219e7644fb7b96d920d5bc3d1d950f5569dcaf",
        assets={},
    )


def registry_for(root: Path) -> SupportedBaseRegistry:
    fingerprint, _ = fingerprint_extraction(
        root, expected_game_id="RMBE01", expected_revision=0
    )
    return SupportedBaseRegistry(
        (SupportedBase(name="Synthetic RMBE01 Rev 0", fingerprint=fingerprint),)
    )


def test_no_op_build_is_deterministic_atomic_cached_and_source_preserving(
    tmp_path: Path,
) -> None:
    image = tmp_path / "user-owned.rvz"
    original_image = b"synthetic user-owned image; not game data"
    image.write_bytes(original_image)
    dtk = tmp_path / "dtk"
    dtk_hash = create_fake_dtk(dtk)
    reference = tmp_path / "reference"
    create_extraction(reference)
    registry = registry_for(reference)
    service = GameBuildService(
        DtkDiscTool(
            dtk,
            release=fake_release(),
            expected_sha256=dtk_hash,
            timeout_seconds=10,
        ),
        registry,
        clock=lambda: datetime(2026, 8, 10, 12, 0, tzinfo=UTC),
    )
    request = BuildRequest(image_path=image, cache_root=tmp_path / "cache")

    first = service.build(request)
    first_manifest_bytes = (
        first.build_directory / "game-build-manifest.json"
    ).read_bytes()
    second = service.build(request)

    assert first.cache_hit is False
    assert second.cache_hit is True
    assert first.build_directory == second.build_directory
    assert first.manifest == second.manifest
    assert (
        second.build_directory / "game-build-manifest.json"
    ).read_bytes() == first_manifest_bytes
    assert image.read_bytes() == original_image
    assert first.report["sourceMutated"] is False
    assert not list((tmp_path / "cache/.staging").iterdir())
    validate_contract("game-build-manifest", first.manifest)
    assert first.manifest["patchReceipts"] == []
    assert first.manifest["warnings"][0]["code"] == "NO_OP_BUILD"
    assert first.manifest["buildSha256"] == second.manifest["buildSha256"]
    for output in first.manifest["outputs"]:
        assert sha256_file(first.game_directory / output["path"]) == output["sha256"]


def test_modified_base_fails_closed_without_promoting_a_build(tmp_path: Path) -> None:
    image = tmp_path / "user-owned.rvz"
    image.write_bytes(b"synthetic image")
    dtk = tmp_path / "dtk"
    dtk_hash = create_fake_dtk(dtk, dat_payload="modified dat")
    clean = tmp_path / "clean"
    create_extraction(clean)
    service = GameBuildService(
        DtkDiscTool(
            dtk,
            release=fake_release(),
            expected_sha256=dtk_hash,
            timeout_seconds=10,
        ),
        registry_for(clean),
    )

    with pytest.raises(UnsupportedBaseError, match="modified or unknown files"):
        service.build(BuildRequest(image_path=image, cache_root=tmp_path / "cache"))

    assert not list((tmp_path / "cache/builds").iterdir())
    assert not list((tmp_path / "cache/.staging").iterdir())


def test_production_registry_contains_reviewed_rev_zero_base() -> None:
    registry = SupportedBaseRegistry.load()

    assert len(registry.entries) == 1
    reviewed = registry.entries[0]
    assert reviewed.name == "Mario Super Sluggers (USA) (En,Fr,Es) Rev 0"
    assert reviewed.fingerprint.manifest_value() == {
        "gameId": "RMBE01",
        "region": "NTSC-U",
        "revision": 0,
        "discHeaderSha256": (
            "77d0ea06cf31785fe7ceefc68d4b23a5302a75961b94a0cbaa9280f85019a37f"
        ),
        "mainDolSha256": (
            "3018e262480ccbf0daa04fc96f1c3dfb340dc4007a13f007f9423751c1346151"
        ),
        "dataArchiveSha256": (
            "810a0ee7928a8a2f23aee7e74d56d9b7eb8b218dfe9353fe85efcc07b8163705"
        ),
        "fstSha256": (
            "48bf2e7e65a46017386f3d7ddc272824c05bde4a200512333d932e2a7dfa29df"
        ),
    }
    assert registry.require_supported(reviewed.fingerprint) is reviewed


def test_unprovisioned_registry_is_explicit(tmp_path: Path) -> None:
    root = tmp_path / "extracted"
    create_extraction(root)
    fingerprint, _ = fingerprint_extraction(
        root, expected_game_id="RMBE01", expected_revision=0
    )
    registry = SupportedBaseRegistry(
        (), provisioning_note="Maintainer review is still required."
    )

    with pytest.raises(UnsupportedBaseError, match="not provisioned yet"):
        registry.require_supported(fingerprint)


def test_dtk_binary_and_redump_verification_fail_closed(tmp_path: Path) -> None:
    wrong_version = tmp_path / "wrong-version"
    wrong_version_hash = create_fake_dtk(wrong_version, version="1.8.2")
    tool = DtkDiscTool(
        wrong_version,
        release=fake_release(),
        expected_sha256=wrong_version_hash,
    )
    with pytest.raises(ToolVerificationError, match="Expected decomp-toolkit"):
        tool.verify_pinned_binary()

    non_redump = tmp_path / "non-redump"
    non_redump_hash = create_fake_dtk(non_redump, redump_line="Not found")
    tool = DtkDiscTool(
        non_redump,
        release=fake_release(),
        expected_sha256=non_redump_hash,
    )
    with pytest.raises(Exception, match="exact Redump match"):
        tool.verify_image(tmp_path / "image.rvz")


def test_tool_install_rejects_an_unpublished_hash(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    release = DtkRelease(
        version="1.8.3",
        release_tag="v1.8.3",
        source_commit="source",
        assets={
            "test-platform": ToolAsset(
                file_name="dtk-test",
                sha256="0" * 64,
                url="https://example.invalid/dtk",
            )
        },
    )
    monkeypatch.setattr(
        "starworks_runner.games.sluggers.tools.current_platform_key",
        lambda: "test-platform",
    )

    with pytest.raises(ToolVerificationError, match="published SHA-256"):
        install_dtk(
            tmp_path,
            release=release,
            opener=lambda _: io.BytesIO(b"not the published binary"),
        )


def test_dolphin_command_uses_isolated_profile_and_rejects_tampering(
    tmp_path: Path,
) -> None:
    image = tmp_path / "user-owned.rvz"
    image.write_bytes(b"synthetic image")
    dtk = tmp_path / "dtk"
    dtk_hash = create_fake_dtk(dtk)
    clean = tmp_path / "clean"
    create_extraction(clean)
    result = GameBuildService(
        DtkDiscTool(
            dtk,
            release=fake_release(),
            expected_sha256=dtk_hash,
            timeout_seconds=10,
        ),
        registry_for(clean),
    ).build(BuildRequest(image_path=image, cache_root=tmp_path / "cache"))
    dolphin = tmp_path / "Dolphin"
    dolphin.write_text(
        '#!/bin/sh\nif [ "$1" = "--version" ]; then echo \'Dolphin 2606\'; fi\n',
        encoding="utf-8",
    )
    dolphin.chmod(0o755)
    launcher = DolphinLauncher(dolphin)

    assert "2606" in launcher.verify()
    command = launcher.command_for(result.build_directory, tmp_path / "profile")
    assert command[-2:] == (
        "--exec",
        str(result.game_directory / "sys/main.dol"),
    )
    assert command[command.index("--user") + 1] == str(tmp_path / "profile")

    (result.game_directory / "sys/main.dol").write_bytes(b"tampered")
    with pytest.raises(DolphinLaunchError, match="modified managed output"):
        launcher.command_for(result.build_directory, tmp_path / "profile")


def test_corrupt_cache_is_not_silently_reused(tmp_path: Path) -> None:
    image = tmp_path / "user-owned.rvz"
    image.write_bytes(b"synthetic image")
    dtk = tmp_path / "dtk"
    dtk_hash = create_fake_dtk(dtk)
    clean = tmp_path / "clean"
    create_extraction(clean)
    service = GameBuildService(
        DtkDiscTool(
            dtk,
            release=fake_release(),
            expected_sha256=dtk_hash,
            timeout_seconds=10,
        ),
        registry_for(clean),
    )
    request = BuildRequest(image_path=image, cache_root=tmp_path / "cache")
    result = service.build(request)
    (result.game_directory / "files/dt_na.dat").write_bytes(b"tampered")

    with pytest.raises(BuildIntegrityError, match="Cached output failed verification"):
        service.build(request)


def test_published_stat_content_build_is_deterministic_and_removable(
    tmp_path: Path,
) -> None:
    image = tmp_path / "user-owned.rvz"
    original_image = b"synthetic image"
    image.write_bytes(original_image)
    dtk = tmp_path / "dtk"
    dtk_hash = create_fake_dtk(dtk)
    clean = tmp_path / "clean"
    create_extraction(clean)
    manifest, operations = content_documents(clean)
    data_path = clean / "files/dt_na.dat"
    target = StaticValueTarget(
        target_id="synthetic-mario-slap-power",
        operation="set-character-stat",
        character_id="mario",
        rule_key=None,
        gameplay_target="character.batting.slapPower",
        resource="dt-na-dat",
        codec="u16-be",
        target_path=PurePosixPath("files/dt_na.dat"),
        target_offset=0,
        expected_bytes=b"cl",
        supported_input_sha256=(sha256_file(data_path),),
        enum_values={},
    )
    content = ContentPackInput(
        manifest=manifest,
        operation_bundle=operations,
        target_catalog=StaticTargetCatalog("0.1.0", (target,), ()).validated(),
    )
    service = GameBuildService(
        DtkDiscTool(
            dtk,
            release=fake_release(),
            expected_sha256=dtk_hash,
            timeout_seconds=10,
        ),
        registry_for(clean),
    )

    first = service.build(
        BuildRequest(
            image_path=image, cache_root=tmp_path / "cache", content_pack=content
        )
    )
    second = service.build(
        BuildRequest(
            image_path=image, cache_root=tmp_path / "cache", content_pack=content
        )
    )
    clean_result = service.build(
        BuildRequest(image_path=image, cache_root=tmp_path / "cache")
    )

    assert first.cache_hit is False
    assert second.cache_hit is True
    assert first.manifest == second.manifest
    assert (
        first.manifest["contentPackSha256"]
        != "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
    )
    assert first.manifest["patchReceipts"][0]["targetPath"] == "files/dt_na.dat"
    assert first.manifest["warnings"] == []
    assert (first.game_directory / "files/dt_na.dat").read_bytes() == b"\x00`ean dat"
    assert clean_result.build_directory != first.build_directory
    assert (
        clean_result.game_directory / "files/dt_na.dat"
    ).read_bytes() == b"clean dat"
    assert image.read_bytes() == original_image


def test_trusted_static_hook_is_preflighted_and_recorded_in_the_build(
    tmp_path: Path,
) -> None:
    image = tmp_path / "user-owned.rvz"
    image.write_bytes(b"synthetic image")
    dtk = tmp_path / "dtk"
    dtk_hash = create_fake_dtk(dtk)
    clean = tmp_path / "clean"
    create_extraction(clean)
    source = (clean / "sys/main.dol").read_bytes()
    replacement = b"STAR"
    output = replacement + source[len(replacement) :]
    artifacts = tmp_path / "artifacts"
    artifacts.mkdir()
    (artifacts / "bridge.bin").write_bytes(replacement)
    plan = PrecompiledPatchPlan(
        patch_id="synthetic-static-hook",
        target_path=PurePosixPath("sys/main.dol"),
        expected_input_sha256=hashlib.sha256(source).hexdigest(),
        expected_output_sha256=hashlib.sha256(output).hexdigest(),
        artifact_path=PurePosixPath("bridge.bin"),
        artifact_sha256=hashlib.sha256(replacement).hexdigest(),
        artifact_size_bytes=len(replacement),
        writes=(
            GuardedWrite(
                target_offset=0,
                artifact_offset=0,
                size_bytes=len(replacement),
                expected_bytes=source[: len(replacement)],
            ),
        ),
    )
    service = GameBuildService(
        DtkDiscTool(
            dtk,
            release=fake_release(),
            expected_sha256=dtk_hash,
            timeout_seconds=10,
        ),
        registry_for(clean),
        trusted_patch_set=PrecompiledPatchSetApplier(artifacts, (plan,)),
    )

    result = service.build(
        BuildRequest(image_path=image, cache_root=tmp_path / "cache")
    )

    assert (result.game_directory / "sys/main.dol").read_bytes() == output
    assert result.manifest["patchReceipts"] == [plan.receipt()]
    assert result.manifest["warnings"] == []


def content_documents(clean: Path) -> tuple[dict[str, object], dict[str, object]]:
    fixtures = Path(__file__).resolve().parents[2] / "contracts/fixtures/valid"
    manifest = json.loads((fixtures / "content-pack-manifest.json").read_text())
    operations = json.loads((fixtures / "adapter-operation-bundle.json").read_text())
    manifest["targetGame"]["supportedRevisions"][0]["mainDolSha256"] = sha256_file(
        clean / "sys/main.dol"
    )
    manifest["rulesetRevisionId"] = operations["rulesetRevisionId"]
    manifest["assets"] = []
    manifest["assignments"] = [
        {
            "assignmentType": "character-stats",
            "characterId": "mario",
            "statProfileRevisionId": manifest["statProfileRevisionId"],
        }
    ]
    return manifest, operations
