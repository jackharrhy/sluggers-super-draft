from __future__ import annotations

import json
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from starworks_runner.contracts import validate_contract
from starworks_runner.games.sluggers.errors import DolphinLaunchError
from starworks_runner.games.sluggers.fingerprints import fingerprint_file
from starworks_runner.games.sluggers.hashing import sha256_tree


@dataclass(frozen=True)
class DolphinLaunch:
    process: subprocess.Popen[bytes]
    command: tuple[str, ...]


class DolphinLauncher:
    """Launch a managed extracted filesystem in an isolated Dolphin profile."""

    def __init__(self, executable: Path, *, expected_version: str = "2603") -> None:
        self.executable = executable.expanduser().resolve()
        self.expected_version = expected_version

    def verify(self) -> str:
        if not self.executable.is_file():
            raise DolphinLaunchError(f"Dolphin executable not found: {self.executable}")
        try:
            completed = subprocess.run(
                [str(self.executable), "--version"],
                check=False,
                capture_output=True,
                text=True,
                timeout=30,
            )
        except (OSError, subprocess.TimeoutExpired) as error:
            raise DolphinLaunchError(f"Unable to inspect Dolphin: {error}") from error
        output = "\n".join(
            part.strip()
            for part in (completed.stdout, completed.stderr)
            if part.strip()
        )
        if completed.returncode != 0 or self.expected_version not in output:
            raise DolphinLaunchError(
                f"Expected Dolphin {self.expected_version}, got {output!r}"
            )
        return output

    def command_for(
        self, build_directory: Path, user_directory: Path
    ) -> tuple[str, ...]:
        resolved_build = build_directory.expanduser().resolve()
        manifest_path = resolved_build / "game-build-manifest.json"
        try:
            manifest: dict[str, Any] = json.loads(
                manifest_path.read_text(encoding="utf-8")
            )
        except (OSError, json.JSONDecodeError) as error:
            raise DolphinLaunchError(
                f"Managed build manifest is unreadable: {manifest_path}"
            ) from error
        validate_contract("game-build-manifest", manifest)
        game_directory = resolved_build / "game"
        for output in manifest["outputs"]:
            actual = fingerprint_file(game_directory, output["path"])
            if (
                actual.sha256 != output["sha256"]
                or actual.size_bytes != output["sizeBytes"]
            ):
                raise DolphinLaunchError(
                    f"Refusing to launch modified managed output {output['path']}"
                )
        try:
            actual_tree_sha256 = sha256_tree(game_directory)
        except ValueError as error:
            raise DolphinLaunchError(str(error)) from error
        if actual_tree_sha256 != manifest["gameTreeSha256"]:
            raise DolphinLaunchError("Refusing to launch a modified managed game tree")
        main_dol = game_directory / "sys/main.dol"
        profile = user_directory.expanduser().resolve()
        profile.mkdir(parents=True, exist_ok=True)
        return (
            str(self.executable),
            "--batch",
            "--user",
            str(profile),
            "--exec",
            str(main_dol),
        )

    def launch(self, build_directory: Path, user_directory: Path) -> DolphinLaunch:
        self.verify()
        command = self.command_for(build_directory, user_directory)
        try:
            process = subprocess.Popen(command)
        except OSError as error:
            raise DolphinLaunchError(f"Unable to launch Dolphin: {error}") from error
        return DolphinLaunch(process=process, command=command)
