from __future__ import annotations

import json
import os
import plistlib
import signal
import subprocess
import sys
import time
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
    profile_directory: Path
    diagnostic_log_path: Path | None
    started_at: float

    def require_running(self, stage: str) -> None:
        return_code = self.process.poll()
        if return_code is None:
            return
        outcome = f"exit code {return_code}"
        if return_code < 0:
            try:
                outcome = f"signal {-return_code} ({signal.Signals(-return_code).name})"
            except ValueError:
                outcome = f"signal {-return_code}"
        log = (
            f"; Dolphin output: {self.diagnostic_log_path}"
            if self.diagnostic_log_path is not None
            else ""
        )
        raise DolphinLaunchError(f"Dolphin exited during {stage} with {outcome}{log}")

    def wait_for_native_capture_safety(
        self,
        *,
        timeout_seconds: float,
        minimum_uptime_seconds: float = 3.0,
        monotonic=time.monotonic,
        sleep=time.sleep,
    ) -> None:
        """Avoid Dolphin 2606's uninitialized FrameDumper crash at startup."""

        deadline = monotonic() + timeout_seconds
        safe_at = self.started_at + minimum_uptime_seconds
        while monotonic() < safe_at:
            self.require_running("native screenshot startup guard")
            if monotonic() >= deadline:
                raise DolphinLaunchError(
                    "Dolphin renderer was not ready for native screenshots "
                    "before the timeout"
                )
            sleep(min(0.05, safe_at - monotonic()))


class DolphinLauncher:
    """Launch a managed extracted filesystem in an isolated Dolphin profile."""

    def __init__(self, executable: Path, *, expected_version: str = "2606") -> None:
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

    def verify_dme_compatible(self) -> None:
        """Fail early when macOS will deny Dolphin Memory Engine attachment."""

        if sys.platform != "darwin":
            return
        try:
            completed = subprocess.run(
                [
                    "codesign",
                    "-d",
                    "--entitlements",
                    ":-",
                    str(self.executable),
                ],
                check=False,
                capture_output=True,
                timeout=30,
            )
        except (OSError, subprocess.TimeoutExpired) as error:
            raise DolphinLaunchError(
                f"Unable to inspect Dolphin's macOS entitlements: {error}"
            ) from error
        try:
            entitlements = plistlib.loads(completed.stdout)
        except plistlib.InvalidFileException as error:
            raise DolphinLaunchError(
                "Dolphin's macOS entitlements could not be read"
            ) from error
        if (
            completed.returncode != 0
            or entitlements.get("com.apple.security.get-task-allow") is not True
        ):
            raise DolphinLaunchError(
                "Dolphin Memory Engine requires a runner-managed Dolphin copy "
                "signed with com.apple.security.get-task-allow; do not modify the "
                "normal Dolphin installation in place"
            )

    def command_for(
        self,
        build_directory: Path,
        user_directory: Path,
        *,
        gdb_socket: Path | None = None,
        gdb_port: int | None = None,
        save_state: Path | None = None,
        quiet_output: bool = False,
    ) -> tuple[str, ...]:
        if gdb_socket is not None and gdb_port is not None:
            raise DolphinLaunchError("Choose either a Dolphin GDB socket or TCP port")
        if gdb_port is not None and not 1 <= gdb_port <= 65535:
            raise DolphinLaunchError("Dolphin GDB port must be between 1 and 65535")
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
        resolved_save_state: Path | None = None
        if save_state is not None:
            resolved_save_state = save_state.expanduser().resolve()
            if not resolved_save_state.is_file():
                raise DolphinLaunchError(
                    f"Dolphin initial save state not found: {resolved_save_state}"
                )
        command = [
            str(self.executable),
            "--batch",
            "--user",
            str(profile),
        ]
        if gdb_socket is not None:
            command.extend(
                (
                    "-C",
                    f"Dolphin.General.GDBSocket={gdb_socket.expanduser().resolve()}",
                )
            )
        elif gdb_port is not None:
            command.extend(("-C", f"Dolphin.General.GDBPort={gdb_port}"))
        if resolved_save_state is not None:
            command.extend(("--save_state", str(resolved_save_state)))
        command.extend(
            (
                "--exec",
                str(main_dol),
            )
        )
        return tuple(command)

    def launch(
        self,
        build_directory: Path,
        user_directory: Path,
        *,
        gdb_socket: Path | None = None,
        gdb_port: int | None = None,
        save_state: Path | None = None,
        quiet_output: bool = False,
    ) -> DolphinLaunch:
        self.verify()
        command = self.command_for(
            build_directory,
            user_directory,
            gdb_socket=gdb_socket,
            gdb_port=gdb_port,
            save_state=save_state,
            quiet_output=quiet_output,
        )
        profile = user_directory.expanduser().resolve()
        diagnostic_log_path: Path | None = None
        diagnostic_stream = None
        try:
            if quiet_output:
                diagnostic_log_path = profile / "Logs" / "starworks-dolphin.log"
                diagnostic_log_path.parent.mkdir(parents=True, exist_ok=True)
                diagnostic_stream = diagnostic_log_path.open("ab")
            process = subprocess.Popen(
                command,
                start_new_session=os.name != "nt",
                stdout=diagnostic_stream,
                stderr=subprocess.STDOUT if quiet_output else None,
            )
        except OSError as error:
            raise DolphinLaunchError(f"Unable to launch Dolphin: {error}") from error
        finally:
            if diagnostic_stream is not None:
                diagnostic_stream.close()
        return DolphinLaunch(
            process=process,
            command=command,
            profile_directory=profile,
            diagnostic_log_path=diagnostic_log_path,
            started_at=time.monotonic(),
        )
