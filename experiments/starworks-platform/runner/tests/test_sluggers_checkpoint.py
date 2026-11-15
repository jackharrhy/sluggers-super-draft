from __future__ import annotations

import json
from pathlib import Path

import pytest
from starworks_runner.games.sluggers.checkpoint import (
    SeedCheckpoint,
    seed_profile_sha256,
)
from starworks_runner.games.sluggers.errors import BuildIntegrityError
from starworks_runner.games.sluggers.hashing import sha256_file


def create_checkpoint_package(tmp_path: Path) -> tuple[Path, Path, dict[str, str]]:
    seed = tmp_path / "seed"
    (seed / "Config").mkdir(parents=True)
    (seed / "Config/Dolphin.ini").write_text("[Core]\n", encoding="utf-8")
    (seed / "Wii/title/game/data").mkdir(parents=True)
    (seed / "Wii/title/game/data/gamedata").write_bytes(b"unlocked")
    (seed / "Cache").mkdir()
    (seed / "Cache/runtime.bin").write_bytes(b"ignored")
    (seed / "Load").mkdir()
    (seed / "Load/WiiSD.raw").write_bytes(b"ignored virtual SD")
    (seed / "StateSaves").mkdir()
    (seed / "StateSaves/old.sav").write_bytes(b"ignored old checkpoint")

    package = tmp_path / "checkpoint"
    package.mkdir()
    save_state = package / "pre-roster.sav"
    save_state.write_bytes(b"managed Dolphin state")
    values = {
        "adapterBuildSha256": "a" * 64,
        "gameBuildSha256": "b" * 64,
        "mainDolSha256": "c" * 64,
    }
    manifest = {
        "kind": "sluggers-seed-checkpoint",
        "stage": "stadium-selection",
        "saveState": {
            "path": save_state.name,
            "sha256": sha256_file(save_state),
        },
        "dolphinVersion": "2606",
        **values,
        "seedProfileSha256": seed_profile_sha256(seed),
    }
    manifest_path = package / "checkpoint.json"
    manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
    return manifest_path, seed, values


def load_checkpoint(
    manifest: Path, seed: Path, values: dict[str, str]
) -> SeedCheckpoint:
    return SeedCheckpoint.load(
        manifest,
        seed_profile_directory=seed,
        expected_dolphin_version="2606",
        expected_adapter_build_sha256=values["adapterBuildSha256"],
        expected_game_build_sha256=values["gameBuildSha256"],
        expected_main_dol_sha256=values["mainDolSha256"],
    )


def test_checkpoint_is_pinned_and_materializes_only_the_seed_profile(
    tmp_path: Path,
) -> None:
    manifest, seed, values = create_checkpoint_package(tmp_path)
    checkpoint = load_checkpoint(manifest, seed, values)

    target = checkpoint.materialize_profile(tmp_path / "attempt")

    assert (target / "Config/Dolphin.ini").is_file()
    assert (target / "Wii/title/game/data/gamedata").read_bytes() == b"unlocked"
    assert not (target / "Cache").exists()
    assert not (target / "Load/WiiSD.raw").exists()
    assert not (target / "StateSaves").exists()
    assert checkpoint.require_materialized_profile(target) == target


def test_checkpoint_rejects_tampering_wrong_builds_and_existing_targets(
    tmp_path: Path,
) -> None:
    manifest, seed, values = create_checkpoint_package(tmp_path)
    checkpoint = load_checkpoint(manifest, seed, values)
    existing = tmp_path / "existing"
    existing.mkdir()

    with pytest.raises(BuildIntegrityError, match="will not be overwritten"):
        checkpoint.materialize_profile(existing)

    (manifest.parent / "pre-roster.sav").write_bytes(b"tampered")
    with pytest.raises(BuildIntegrityError, match="save-state hash"):
        load_checkpoint(manifest, seed, values)

    manifest, seed, values = create_checkpoint_package(tmp_path / "wrong")
    with pytest.raises(BuildIntegrityError, match="gameBuildSha256"):
        SeedCheckpoint.load(
            manifest,
            seed_profile_directory=seed,
            expected_dolphin_version="2606",
            expected_adapter_build_sha256=values["adapterBuildSha256"],
            expected_game_build_sha256="d" * 64,
            expected_main_dol_sha256=values["mainDolSha256"],
        )


def test_seed_profile_hash_rejects_symlinks(tmp_path: Path) -> None:
    seed = tmp_path / "seed"
    seed.mkdir()
    target = tmp_path / "outside"
    target.write_bytes(b"outside")
    (seed / "linked").symlink_to(target)

    with pytest.raises(BuildIntegrityError, match="symbolic link"):
        seed_profile_sha256(seed)
