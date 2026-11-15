from __future__ import annotations

import os
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from starworks_runner.control import RunnerControlClient
from starworks_runner.execution import bind_match_execution
from starworks_runner.games.sluggers.content import ContentPackInput
from starworks_runner.games.sluggers.hashing import canonical_json_bytes, sha256_file


@dataclass(frozen=True)
class ResolvedContentPack:
    directory: Path
    source: ContentPackInput


class ContentPackDownloader:
    """Materialize only a manifest and its user-authored, hash-addressed assets."""

    def __init__(self, client: RunnerControlClient, cache_root: Path) -> None:
        self.client = client
        self.cache_root = cache_root.expanduser().resolve()

    def resolve(
        self,
        envelope: dict[str, Any],
        configuration: dict[str, Any],
    ) -> ResolvedContentPack | None:
        bound = bind_match_execution(envelope, configuration)
        manifest = configuration["contentPack"]
        if manifest is None:
            return None
        directory = self.cache_root / "content-packs" / manifest["revisionId"]
        assets_root = directory / "assets"
        assets_root.mkdir(parents=True, exist_ok=True)
        for asset in sorted(manifest["assets"], key=lambda item: item["sha256"]):
            destination = assets_root / asset["sha256"]
            if self._valid_cached_asset(destination, asset):
                continue
            self._atomic_write(
                destination, self.client.asset(envelope["attemptId"], asset)
            )
            if not self._valid_cached_asset(destination, asset):
                destination.unlink(missing_ok=True)
                raise RuntimeError(
                    f"Cached content asset {asset['sha256']} failed verification"
                )
        self._atomic_write(directory / "manifest.json", canonical_json_bytes(manifest))
        self._atomic_write(
            directory / "adapter-operations.json",
            canonical_json_bytes(bound.compiled.home),
        )
        return ResolvedContentPack(
            directory=directory,
            source=ContentPackInput(
                manifest=manifest,
                operation_bundle=bound.compiled.home,
                assets_root=assets_root,
            ),
        )

    @staticmethod
    def _valid_cached_asset(path: Path, asset: dict[str, Any]) -> bool:
        return (
            path.is_file()
            and path.stat().st_size == asset["sizeBytes"]
            and sha256_file(path) == asset["sha256"]
        )

    @staticmethod
    def _atomic_write(destination: Path, value: bytes) -> None:
        destination.parent.mkdir(parents=True, exist_ok=True)
        descriptor, temporary_name = tempfile.mkstemp(
            prefix=f".{destination.name}.",
            suffix=".tmp",
            dir=destination.parent,
        )
        temporary = Path(temporary_name)
        try:
            with os.fdopen(descriptor, "wb") as file:
                file.write(value)
                file.flush()
                os.fsync(file.fileno())
            os.replace(temporary, destination)
        finally:
            temporary.unlink(missing_ok=True)
