from __future__ import annotations

import secrets
import shutil
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from starworks_runner.games.sluggers.adapter import AdapterManifest
from starworks_runner.games.sluggers.checkpoint import (
    SeedCheckpoint,
    clone_seed_profile,
    seed_profile_sha256,
)
from starworks_runner.games.sluggers.errors import BuildIntegrityError
from starworks_runner.games.sluggers.hashing import sha256_file, write_json
from starworks_runner.games.sluggers.session import (
    LiveSluggersSession,
    load_game_build_manifest,
)


@dataclass(frozen=True)
class CheckpointPreparation:
    manifest_path: Path
    profile_directory: Path
    cache_hit: bool

    def report_value(self) -> dict[str, str | bool]:
        return {
            "checkpointManifest": str(self.manifest_path),
            "seedProfile": str(self.profile_directory),
            "cacheHit": self.cache_hit,
        }


def prepare_seed_checkpoint(
    *,
    build_directory: Path,
    dolphin_executable: Path,
    source_profile_directory: Path,
    target_profile_directory: Path,
    checkpoint_directory: Path,
    dolphin_version: str = "2606",
    timeout_seconds: float = 90.0,
) -> CheckpointPreparation:
    """Create or validate the local pre-roster checkpoint for one exact build."""

    build = build_directory.expanduser().resolve()
    target_profile = target_profile_directory.expanduser().resolve()
    checkpoint = checkpoint_directory.expanduser().resolve()
    manifest_path = checkpoint / "checkpoint.json"
    game_build = load_game_build_manifest(build)
    adapter = AdapterManifest.load()
    main_dol_sha256 = _main_dol_sha256(game_build)

    if target_profile.is_dir() and manifest_path.is_file():
        SeedCheckpoint.load(
            manifest_path,
            seed_profile_directory=target_profile,
            expected_dolphin_version=dolphin_version,
            expected_adapter_build_sha256=adapter.adapter_build_sha256,
            expected_game_build_sha256=game_build["buildSha256"],
            expected_main_dol_sha256=main_dol_sha256,
        )
        return CheckpointPreparation(
            manifest_path=manifest_path,
            profile_directory=target_profile,
            cache_hit=True,
        )
    if target_profile.exists() or checkpoint.exists():
        raise BuildIntegrityError(
            "Local seed checkpoint is only partially present. Remove both exact "
            f"generated paths and retry: {target_profile} and {checkpoint}"
        )

    created_profile = False
    created_checkpoint = False
    try:
        clone_seed_profile(source_profile_directory, target_profile)
        created_profile = True
        session = LiveSluggersSession(
            build_directory=build,
            dolphin_executable=dolphin_executable,
            profile_directory=target_profile,
            adapter_build_sha256=adapter.adapter_build_sha256,
            game_build_sha256=game_build["buildSha256"],
        )
        with session:
            session.start(
                secrets.token_urlsafe(32),
                timeout_seconds=min(timeout_seconds, 30.0),
            )
            session.navigate_cold_boot_to_exhibition_stadium(
                has_existing_save=True,
                timeout_seconds=timeout_seconds,
                diagnostic_directory=target_profile / "Dump/bootstrap",
            )
            if session.controller is None:
                raise BuildIntegrityError(
                    "This platform has no controller backend for checkpoint creation"
                )
            created_save_state = session.controller.save_state_slot_one(
                timeout_seconds=30.0
            )

        checkpoint.mkdir(parents=True)
        created_checkpoint = True
        packaged_save_state = checkpoint / "pre-roster-current.sav"
        shutil.copy2(created_save_state, packaged_save_state)
        write_json(
            manifest_path,
            {
                "kind": "sluggers-seed-checkpoint",
                "stage": "stadium-selection",
                "saveState": {
                    "path": packaged_save_state.name,
                    "sha256": sha256_file(packaged_save_state),
                },
                "dolphinVersion": dolphin_version,
                "adapterBuildSha256": adapter.adapter_build_sha256,
                "gameBuildSha256": game_build["buildSha256"],
                "mainDolSha256": main_dol_sha256,
                "seedProfileSha256": seed_profile_sha256(target_profile),
            },
        )
        SeedCheckpoint.load(
            manifest_path,
            seed_profile_directory=target_profile,
            expected_dolphin_version=dolphin_version,
            expected_adapter_build_sha256=adapter.adapter_build_sha256,
            expected_game_build_sha256=game_build["buildSha256"],
            expected_main_dol_sha256=main_dol_sha256,
        )
        return CheckpointPreparation(
            manifest_path=manifest_path,
            profile_directory=target_profile,
            cache_hit=False,
        )
    except BaseException:
        # KeyboardInterrupt is especially likely during a visible cold-boot
        # tool. Never leave a half-created canonical profile behind.
        if created_checkpoint:
            shutil.rmtree(checkpoint, ignore_errors=True)
        if created_profile:
            shutil.rmtree(target_profile, ignore_errors=True)
        raise


def _main_dol_sha256(game_build: dict[str, Any]) -> str:
    matches = [
        output["sha256"]
        for output in game_build["outputs"]
        if output["path"] == "sys/main.dol"
    ]
    if len(matches) != 1:
        raise BuildIntegrityError(
            "Managed game build must contain exactly one sys/main.dol output"
        )
    return matches[0]
