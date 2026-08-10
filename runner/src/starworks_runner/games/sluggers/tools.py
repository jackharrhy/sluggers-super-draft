from __future__ import annotations

import json
import os
import platform
import re
import stat
import subprocess
import tempfile
import urllib.request
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import BinaryIO, cast

from starworks_runner.games.sluggers.errors import (
    DiscImageError,
    ToolVerificationError,
)
from starworks_runner.games.sluggers.hashing import sha256_file


@dataclass(frozen=True)
class ToolAsset:
    file_name: str
    sha256: str
    url: str


@dataclass(frozen=True)
class DtkRelease:
    version: str
    release_tag: str
    source_commit: str
    assets: dict[str, ToolAsset]


@dataclass(frozen=True)
class DiscIdentity:
    game_id: str
    revision: int
    info_output: str


@dataclass(frozen=True)
class DiscVerification:
    redump_name: str
    output: str


def load_dtk_release(path: Path | None = None) -> DtkRelease:
    manifest_path = path or Path(__file__).with_name("tool_manifest.v1.json")
    raw = json.loads(manifest_path.read_text(encoding="utf-8"))
    if raw.get("schemaVersion") != 1:
        raise ToolVerificationError("Unsupported pinned-tool manifest version")
    dtk = raw["tools"]["dtk"]
    assets = {
        key: ToolAsset(
            file_name=value["fileName"],
            sha256=value["sha256"],
            url=value["url"],
        )
        for key, value in dtk["assets"].items()
    }
    return DtkRelease(
        version=dtk["version"],
        release_tag=dtk["releaseTag"],
        source_commit=dtk["sourceCommit"],
        assets=assets,
    )


def current_platform_key() -> str:
    operating_system = platform.system().lower()
    if operating_system == "darwin":
        operating_system = "darwin"
    elif operating_system == "windows":
        operating_system = "windows"
    elif operating_system == "linux":
        operating_system = "linux"
    else:
        raise ToolVerificationError(
            f"decomp-toolkit is not provisioned for operating system {platform.system()!r}"
        )

    raw_machine = platform.machine().lower()
    machine = {
        "amd64": "x86_64",
        "x64": "x86_64",
        "x86": "i686",
        "i386": "i686",
        "i686": "i686",
        "arm64": "arm64" if operating_system in {"darwin", "windows"} else "aarch64",
        "aarch64": "arm64" if operating_system in {"darwin", "windows"} else "aarch64",
    }.get(raw_machine, raw_machine)
    return f"{operating_system}-{machine}"


def dtk_asset_for_current_platform(release: DtkRelease | None = None) -> ToolAsset:
    selected_release = release or load_dtk_release()
    key = current_platform_key()
    try:
        return selected_release.assets[key]
    except KeyError as error:
        raise ToolVerificationError(
            f"decomp-toolkit {selected_release.version} has no pinned asset for {key}"
        ) from error


DownloadOpener = Callable[[str], BinaryIO]


def _open_download(url: str) -> BinaryIO:
    return cast(BinaryIO, urllib.request.urlopen(url, timeout=120))


def install_dtk(
    tool_directory: Path,
    *,
    release: DtkRelease | None = None,
    opener: DownloadOpener = _open_download,
) -> Path:
    selected_release = release or load_dtk_release()
    asset = dtk_asset_for_current_platform(selected_release)
    version_directory = tool_directory.resolve() / "dtk" / selected_release.version
    destination = version_directory / asset.file_name
    version_directory.mkdir(parents=True, exist_ok=True)

    if destination.is_file() and sha256_file(destination) == asset.sha256:
        return destination

    descriptor, temporary_name = tempfile.mkstemp(
        prefix=f".{asset.file_name}.", suffix=".download", dir=version_directory
    )
    temporary_path = Path(temporary_name)
    try:
        with os.fdopen(descriptor, "wb") as output, opener(asset.url) as response:
            while chunk := response.read(1024 * 1024):
                output.write(chunk)
            output.flush()
            os.fsync(output.fileno())
        actual_sha256 = sha256_file(temporary_path)
        if actual_sha256 != asset.sha256:
            raise ToolVerificationError(
                "Downloaded decomp-toolkit did not match its published SHA-256: "
                f"expected {asset.sha256}, got {actual_sha256}"
            )
        temporary_path.chmod(
            temporary_path.stat().st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH
        )
        os.replace(temporary_path, destination)
    finally:
        temporary_path.unlink(missing_ok=True)
    return destination


class DtkDiscTool:
    """Narrow, pinned subprocess boundary around decomp-toolkit's disc commands."""

    def __init__(
        self,
        executable: Path,
        *,
        release: DtkRelease | None = None,
        expected_sha256: str | None = None,
        require_redump_match: bool = True,
        timeout_seconds: float = 1_800,
    ) -> None:
        self.executable = executable.resolve()
        self.release = release or load_dtk_release()
        self.expected_sha256 = expected_sha256
        self.require_redump_match = require_redump_match
        self.timeout_seconds = timeout_seconds

    def verify_pinned_binary(self) -> str:
        if not self.executable.is_file():
            raise ToolVerificationError(
                f"Pinned decomp-toolkit executable not found: {self.executable}"
            )
        expected_hash = self.expected_sha256
        if expected_hash is None:
            asset = dtk_asset_for_current_platform(self.release)
            expected_hash = asset.sha256
        actual_hash = sha256_file(self.executable)
        if actual_hash != expected_hash:
            raise ToolVerificationError(
                "decomp-toolkit binary hash mismatch: "
                f"expected {expected_hash}, got {actual_hash}"
            )
        output = self._run("--version")
        if (
            re.search(
                rf"(?<![0-9.]){re.escape(self.release.version)}(?![0-9.])", output
            )
            is None
        ):
            raise ToolVerificationError(
                f"Expected decomp-toolkit {self.release.version}, got {output.strip()!r}"
            )
        return actual_hash

    def inspect(self, image: Path) -> DiscIdentity:
        output = self._run("disc", "info", str(image.resolve()))
        game_ids = re.findall(r"^Game ID:\s*([A-Z0-9]{6})\s*$", output, re.MULTILINE)
        revisions = re.findall(
            r"^Disc\s+\d+,\s+Revision\s+(\d+)\s*$", output, re.MULTILINE
        )
        if not game_ids or not revisions:
            raise DiscImageError(
                "decomp-toolkit could not report a disc Game ID and revision"
            )
        if len(set(game_ids)) != 1 or len(set(revisions)) != 1:
            raise DiscImageError(
                "Disc metadata disagrees between the image and its data partition"
            )
        return DiscIdentity(
            game_id=game_ids[0],
            revision=int(revisions[0]),
            info_output=output,
        )

    def verify_image(self, image: Path) -> DiscVerification:
        output = self._run("disc", "verify", str(image.resolve()))
        matches = re.findall(r"^Redump:\s*(.+?)\s*$", output, re.MULTILINE)
        redump_name = matches[-1] if matches else ""
        rejected_markers = ("not found", "partial match")
        if self.require_redump_match and (
            not redump_name
            or any(marker in redump_name.lower() for marker in rejected_markers)
        ):
            raise DiscImageError(
                "The selected image did not produce an exact Redump match in "
                "decomp-toolkit. Scrubbed WBFS images without verification data "
                "cannot satisfy this gate; use a clean full ISO or lossless RVZ "
                "dump instead"
            )
        return DiscVerification(redump_name=redump_name, output=output)

    def extract(self, image: Path, output_directory: Path) -> None:
        if output_directory.exists() and any(output_directory.iterdir()):
            raise DiscImageError(
                f"Refusing to extract over a non-empty directory: {output_directory}"
            )
        output_directory.mkdir(parents=True, exist_ok=True)
        self._run(
            "disc",
            "extract",
            str(image.resolve()),
            str(output_directory.resolve()),
            "--partition",
            "data",
            "--validate",
            "--quiet",
        )

    def _run(self, *arguments: str) -> str:
        try:
            completed = subprocess.run(
                [str(self.executable), *arguments],
                check=False,
                capture_output=True,
                text=True,
                timeout=self.timeout_seconds,
            )
        except (OSError, subprocess.TimeoutExpired) as error:
            raise ToolVerificationError(
                f"Unable to execute pinned decomp-toolkit: {error}"
            ) from error
        output = "\n".join(
            part.strip()
            for part in (completed.stdout, completed.stderr)
            if part.strip()
        )
        if completed.returncode != 0:
            diagnostic = output[-4_000:] if output else "no diagnostic output"
            raise DiscImageError(
                f"decomp-toolkit exited with {completed.returncode}: {diagnostic}"
            )
        return output
