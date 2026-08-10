from __future__ import annotations

import copy
import hashlib
import json
from pathlib import Path, PurePosixPath

import pytest

from starworks_runner.games.sluggers.content import (
    ContentPackCompiler,
    ContentPackInput,
    StaticAssetTarget,
    StaticTargetCatalog,
    StaticValueTarget,
)
from starworks_runner.games.sluggers.errors import BuildIntegrityError


def digest(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def documents(main_dol_sha256: str) -> tuple[dict[str, object], dict[str, object]]:
    fixtures = Path(__file__).resolve().parents[2] / "contracts/fixtures/valid"
    manifest = json.loads((fixtures / "content-pack-manifest.json").read_text())
    operations = json.loads((fixtures / "adapter-operation-bundle.json").read_text())
    manifest["targetGame"]["supportedRevisions"][0]["mainDolSha256"] = main_dol_sha256
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


def value_target(
    input_sha256: str,
    *,
    character_id: str = "mario",
    identifier: str = "mario-slap-power",
    offset: int = 0,
) -> StaticValueTarget:
    return StaticValueTarget(
        target_id=identifier,
        operation="set-character-stat",
        character_id=character_id,
        rule_key=None,
        gameplay_target="character.batting.slapPower",
        resource="dt-na-dat",
        codec="u16-be",
        target_path=PurePosixPath("files/dt_na.dat"),
        target_offset=offset,
        expected_bytes=b"\x00\x00",
        supported_input_sha256=(input_sha256,),
        enum_values={},
    )


def test_resolved_content_digest_ignores_generation_time_and_guards_bytes(
    tmp_path: Path,
) -> None:
    root = tmp_path / "game"
    (root / "files").mkdir(parents=True)
    source = b"\x00\x00untouched"
    (root / "files/dt_na.dat").write_bytes(source)
    manifest, operations = documents("a" * 64)
    catalog = StaticTargetCatalog(
        "0.1.0", (value_target(digest(source)),), ()
    ).validated()
    compiler = ContentPackCompiler()

    first = compiler.plan(
        ContentPackInput(manifest, operations, target_catalog=catalog),
        main_dol_sha256="a" * 64,
    )
    changed_time = copy.deepcopy(operations)
    changed_time["generatedAt"] = "2026-08-11T00:00:00Z"
    second = compiler.plan(
        ContentPackInput(manifest, changed_time, target_catalog=catalog),
        main_dol_sha256="a" * 64,
    )
    receipts = first.apply(root)

    assert first.content_pack_sha256 == second.content_pack_sha256
    assert (root / "files/dt_na.dat").read_bytes() == b"\x00`untouched"
    assert receipts[0]["expectedInputSha256"] == digest(source)
    assert receipts[0]["outputSha256"] == digest(b"\x00`untouched")


def test_conflicts_and_unsupported_inputs_fail_before_mutating_files(
    tmp_path: Path,
) -> None:
    root = tmp_path / "game"
    (root / "files").mkdir(parents=True)
    source = b"\x00\x00\x00\x00"
    path = root / "files/dt_na.dat"
    path.write_bytes(source)
    manifest, operations = documents("a" * 64)
    luigi_operation = copy.deepcopy(operations["operations"][0])
    luigi_operation["characterId"] = "luigi"
    operations["operations"].append(luigi_operation)
    manifest["assignments"].append(
        {
            "assignmentType": "character-stats",
            "characterId": "luigi",
            "statProfileRevisionId": manifest["statProfileRevisionId"],
        }
    )
    catalog = StaticTargetCatalog(
        "0.1.0",
        (
            value_target(digest(source)),
            value_target(
                digest(source),
                character_id="luigi",
                identifier="luigi-slap-power",
                offset=1,
            ),
        ),
        (),
    ).validated()

    with pytest.raises(BuildIntegrityError, match="Content writes conflict"):
        ContentPackCompiler().plan(
            ContentPackInput(manifest, operations, target_catalog=catalog),
            main_dol_sha256="a" * 64,
        )
    assert path.read_bytes() == source

    only_mario = copy.deepcopy(operations)
    only_mario["operations"] = [only_mario["operations"][0]]
    only_mario_manifest = copy.deepcopy(manifest)
    only_mario_manifest["assignments"] = [only_mario_manifest["assignments"][0]]
    unsupported = StaticTargetCatalog(
        "0.1.0", (value_target("f" * 64),), ()
    ).validated()
    plan = ContentPackCompiler().plan(
        ContentPackInput(only_mario_manifest, only_mario, target_catalog=unsupported),
        main_dol_sha256="a" * 64,
    )
    with pytest.raises(BuildIntegrityError, match="does not support input"):
        plan.apply(root)
    assert path.read_bytes() == source


def test_exact_local_asset_replacement_is_hash_size_and_media_checked(
    tmp_path: Path,
) -> None:
    root = tmp_path / "game"
    (root / "files").mkdir(parents=True)
    source = b"ICONrest"
    (root / "files/dt_na.dat").write_bytes(source)
    asset_bytes = b"MINE"
    asset_sha256 = digest(asset_bytes)
    assets_root = tmp_path / "assets"
    assets_root.mkdir()
    (assets_root / asset_sha256).write_bytes(asset_bytes)
    manifest, operations = documents("a" * 64)
    manifest["assignments"] = [
        {
            "assignmentType": "character-asset",
            "characterId": "mario",
            "slot": "icon",
            "assetSha256": asset_sha256,
        }
    ]
    manifest["assets"] = [
        {
            "sha256": asset_sha256,
            "mediaType": "application/octet-stream",
            "sizeBytes": len(asset_bytes),
            "displayName": "Synthetic user icon payload",
        }
    ]
    target = StaticAssetTarget(
        target_id="mario-icon",
        character_id="mario",
        slot="icon",
        target_path=PurePosixPath("files/dt_na.dat"),
        target_offset=0,
        expected_bytes=b"ICON",
        supported_input_sha256=(digest(source),),
        media_types=("application/octet-stream",),
    )
    plan = ContentPackCompiler().plan(
        ContentPackInput(
            manifest,
            operations,
            assets_root=assets_root,
            target_catalog=StaticTargetCatalog("0.1.0", (), (target,)).validated(),
        ),
        main_dol_sha256="a" * 64,
    )
    plan.apply(root)

    assert (root / "files/dt_na.dat").read_bytes() == b"MINErest"

    (assets_root / asset_sha256).write_bytes(b"EVIL")
    with pytest.raises(BuildIntegrityError, match="failed hash or size verification"):
        ContentPackCompiler().plan(
            ContentPackInput(
                manifest,
                operations,
                assets_root=assets_root,
                target_catalog=StaticTargetCatalog("0.1.0", (), (target,)).validated(),
            ),
            main_dol_sha256="a" * 64,
        )
