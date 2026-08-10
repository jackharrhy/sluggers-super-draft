from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from starworks_runner.games.sluggers.bridge.layout import PROTOCOL_VERSION
from starworks_runner.games.sluggers.errors import BuildIntegrityError
from starworks_runner.games.sluggers.hashing import sha256_file
from starworks_runner.games.sluggers.memory_map import MemoryMap


@dataclass(frozen=True)
class AdapterManifest:
    adapter_version: str
    protocol_version: int
    bridge_source: Path
    bridge_source_sha256: str
    artifacts: tuple[dict[str, Any], ...]
    patch_plans: tuple[dict[str, Any], ...]
    release_gates: tuple[str, ...]
    raw: dict[str, Any]

    @classmethod
    def load(cls, path: Path | None = None) -> AdapterManifest:
        manifest_path = path or Path(__file__).with_name("adapter_manifest.v1.json")
        try:
            raw = json.loads(manifest_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as error:
            raise BuildIntegrityError(
                f"Adapter manifest is unreadable: {manifest_path}"
            ) from error
        if raw.get("schemaVersion") != 1:
            raise BuildIntegrityError("Unsupported adapter-manifest version")
        target = raw.get("target", {})
        if target != {"gameId": "RMBE01", "revision": 0}:
            raise BuildIntegrityError("Adapter manifest targets the wrong game base")
        protocol = raw["protocol"]
        if protocol["version"] != PROTOCOL_VERSION:
            raise BuildIntegrityError(
                "Adapter manifest protocol does not match the Python bridge"
            )
        source = raw["bridgeSource"]
        root = manifest_path.parent.resolve()
        source_path = (root / source["path"]).resolve()
        try:
            source_path.relative_to(root)
        except ValueError as error:
            raise BuildIntegrityError(
                "Bridge source escapes the adapter package"
            ) from error
        if not source_path.is_file() or sha256_file(source_path) != source["sha256"]:
            raise BuildIntegrityError(
                "Bridge source hash does not match the adapter manifest"
            )
        memory_map_path = (root / protocol["memoryMap"]).resolve()
        MemoryMap.load(memory_map_path)
        release_gates = tuple(raw["releaseGates"])
        if not release_gates or not all(
            isinstance(item, str) and item for item in release_gates
        ):
            raise BuildIntegrityError(
                "Adapter release gates must be explicit non-empty text"
            )
        return cls(
            adapter_version=raw["adapterVersion"],
            protocol_version=protocol["version"],
            bridge_source=source_path,
            bridge_source_sha256=source["sha256"],
            artifacts=tuple(raw["artifacts"]),
            patch_plans=tuple(raw["patchPlans"]),
            release_gates=release_gates,
            raw=raw,
        )
