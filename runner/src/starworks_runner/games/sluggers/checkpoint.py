from __future__ import annotations

import json
import os
import shutil
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from starworks_runner.games.sluggers.errors import BuildIntegrityError
from starworks_runner.games.sluggers.hashing import sha256_file, sha256_json, write_json

_EXCLUDED_PROFILE_DIRECTORIES = frozenset(
    {
        "Backup",
        "Cache",
        "Dump",
        "Logs",
        "Pipes",
        "ScreenShots",
        "StateSaves",
    }
)
_EXCLUDED_PROFILE_FILES = frozenset({"Load/WiiSD.raw", "starworks-seed.json"})
_MANIFEST_KEYS = frozenset(
    {
        "kind",
        "stage",
        "saveState",
        "dolphinVersion",
        "adapterBuildSha256",
        "gameBuildSha256",
        "mainDolSha256",
        "seedProfileSha256",
    }
)


def seed_profile_sha256(profile_directory: Path) -> str:
    """Fingerprint the immutable portion of a Dolphin seed profile."""

    root = profile_directory.expanduser().resolve()
    if not root.is_dir():
        raise BuildIntegrityError(f"Dolphin seed profile is not a directory: {root}")
    files: list[dict[str, Any]] = []
    for path in sorted(root.rglob("*")):
        relative = path.relative_to(root)
        if _excluded(relative):
            continue
        if path.is_symlink():
            raise BuildIntegrityError(
                f"Dolphin seed profile contains a symbolic link: {relative}"
            )
        if path.is_file():
            files.append(
                {
                    "path": relative.as_posix(),
                    "sha256": sha256_file(path),
                    "sizeBytes": path.stat().st_size,
                }
            )
    if not files:
        raise BuildIntegrityError("Dolphin seed profile contains no immutable files")
    return sha256_json(files)


def _excluded(relative: Path) -> bool:
    if relative.parts and relative.parts[0] in _EXCLUDED_PROFILE_DIRECTORIES:
        return True
    return relative.as_posix() in _EXCLUDED_PROFILE_FILES


@dataclass(frozen=True)
class SeedCheckpoint:
    manifest_path: Path
    save_state_path: Path
    save_state_sha256: str
    seed_profile_directory: Path
    seed_profile_sha256: str
    dolphin_version: str
    adapter_build_sha256: str
    game_build_sha256: str
    main_dol_sha256: str
    stage: str

    @classmethod
    def load(
        cls,
        manifest_path: Path,
        *,
        seed_profile_directory: Path,
        expected_dolphin_version: str,
        expected_adapter_build_sha256: str,
        expected_game_build_sha256: str,
        expected_main_dol_sha256: str,
    ) -> SeedCheckpoint:
        resolved_manifest = manifest_path.expanduser().resolve()
        try:
            raw = json.loads(resolved_manifest.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as error:
            raise BuildIntegrityError(
                f"Seed-checkpoint manifest is unreadable: {resolved_manifest}"
            ) from error
        if not isinstance(raw, dict) or frozenset(raw) != _MANIFEST_KEYS:
            raise BuildIntegrityError(
                "Seed-checkpoint manifest has missing or unknown fields"
            )
        if raw["kind"] != "sluggers-seed-checkpoint":
            raise BuildIntegrityError("Seed-checkpoint manifest has the wrong kind")
        if raw["stage"] != "stadium-selection":
            raise BuildIntegrityError(
                "Seed checkpoint must stop at Exhibition stadium selection"
            )
        save_state = raw["saveState"]
        if not isinstance(save_state, dict) or frozenset(save_state) != {
            "path",
            "sha256",
        }:
            raise BuildIntegrityError("Seed-checkpoint saveState is invalid")
        save_path_value = save_state["path"]
        if not isinstance(save_path_value, str) or not save_path_value:
            raise BuildIntegrityError("Seed-checkpoint save-state path is invalid")
        candidate = Path(save_path_value)
        if candidate.is_absolute():
            raise BuildIntegrityError(
                "Seed-checkpoint save-state path must be relative to its manifest"
            )
        save_path = (resolved_manifest.parent / candidate).resolve()
        try:
            save_path.relative_to(resolved_manifest.parent)
        except ValueError as error:
            raise BuildIntegrityError(
                "Seed-checkpoint save-state path escapes its package"
            ) from error
        if not save_path.is_file():
            raise BuildIntegrityError(
                f"Seed-checkpoint save state is missing: {save_path}"
            )
        for label in (
            "adapterBuildSha256",
            "gameBuildSha256",
            "mainDolSha256",
            "seedProfileSha256",
        ):
            _require_sha256(label, raw[label])
        _require_sha256("saveState.sha256", save_state["sha256"])
        if sha256_file(save_path) != save_state["sha256"]:
            raise BuildIntegrityError("Seed-checkpoint save-state hash does not match")
        profile = seed_profile_directory.expanduser().resolve()
        actual_profile_sha256 = seed_profile_sha256(profile)
        if actual_profile_sha256 != raw["seedProfileSha256"]:
            raise BuildIntegrityError("Dolphin seed-profile hash does not match")
        expected = {
            "dolphinVersion": expected_dolphin_version,
            "adapterBuildSha256": expected_adapter_build_sha256,
            "gameBuildSha256": expected_game_build_sha256,
            "mainDolSha256": expected_main_dol_sha256,
        }
        for key, value in expected.items():
            if raw[key] != value:
                raise BuildIntegrityError(
                    f"Seed-checkpoint {key} does not match the scheduled attempt"
                )
        return cls(
            manifest_path=resolved_manifest,
            save_state_path=save_path,
            save_state_sha256=save_state["sha256"],
            seed_profile_directory=profile,
            seed_profile_sha256=actual_profile_sha256,
            dolphin_version=raw["dolphinVersion"],
            adapter_build_sha256=raw["adapterBuildSha256"],
            game_build_sha256=raw["gameBuildSha256"],
            main_dol_sha256=raw["mainDolSha256"],
            stage=raw["stage"],
        )

    def materialize_profile(self, target_directory: Path) -> Path:
        target = target_directory.expanduser().resolve()
        if target.exists():
            raise BuildIntegrityError(
                f"Fresh attempt profile already exists and will not be overwritten: {target}"
            )

        def ignore(directory: str, names: list[str]) -> set[str]:
            relative = (
                Path(directory).resolve().relative_to(self.seed_profile_directory)
            )
            ignored: set[str] = set()
            for name in names:
                child = relative / name
                if _excluded(child):
                    ignored.add(name)
            return ignored

        target.parent.mkdir(parents=True, exist_ok=True)
        staging_root = Path(
            tempfile.mkdtemp(prefix=f".{target.name}-", dir=target.parent)
        )
        staging_profile = staging_root / "profile"
        try:
            shutil.copytree(
                self.seed_profile_directory,
                staging_profile,
                copy_function=shutil.copy2,
                ignore=ignore,
            )
            write_json(
                staging_profile / "starworks-checkpoint.json", self.marker_value()
            )
            os.rename(staging_profile, target)
            return target
        finally:
            if staging_root.exists():
                shutil.rmtree(staging_root)

    def require_materialized_profile(self, target_directory: Path) -> Path:
        target = target_directory.expanduser().resolve()
        marker_path = target / "starworks-checkpoint.json"
        try:
            marker = json.loads(marker_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as error:
            raise BuildIntegrityError(
                f"Recovered attempt profile has no valid checkpoint marker: {target}"
            ) from error
        if marker != self.marker_value():
            raise BuildIntegrityError(
                "Recovered attempt profile belongs to a different checkpoint"
            )
        return target

    def marker_value(self) -> dict[str, str]:
        return {
            "kind": "sluggers-materialized-profile",
            "adapterBuildSha256": self.adapter_build_sha256,
            "gameBuildSha256": self.game_build_sha256,
            "saveStateSha256": self.save_state_sha256,
            "seedProfileSha256": self.seed_profile_sha256,
        }


def _require_sha256(label: str, value: Any) -> None:
    if (
        not isinstance(value, str)
        or len(value) != 64
        or any(character not in "0123456789abcdef" for character in value)
    ):
        raise BuildIntegrityError(f"{label} must be 64 lowercase SHA-256 hex digits")
