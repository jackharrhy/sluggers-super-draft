from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from starworks_runner.games.sluggers.bridge.layout import PROTOCOL_VERSION
from starworks_runner.games.sluggers.errors import BuildIntegrityError
from starworks_runner.games.sluggers.hashing import sha256_file
from starworks_runner.games.sluggers.memory_map import MemoryMap
from starworks_runner.games.sluggers.patching import (
    PrecompiledPatchPlan,
    PrecompiledPatchSetApplier,
)


@dataclass(frozen=True)
class AdapterManifest:
    root: Path
    adapter_version: str
    protocol_version: int
    bridge_source: Path
    bridge_source_sha256: str
    artifacts: tuple[dict[str, Any], ...]
    patch_plans: tuple[dict[str, Any], ...]
    release_gates: tuple[str, ...]
    raw: dict[str, Any]

    def trusted_patch_set(self) -> PrecompiledPatchSetApplier:
        plans = tuple(
            PrecompiledPatchPlan.load(self.root / item["path"])
            for item in self.patch_plans
        )
        if not plans:
            raise BuildIntegrityError("Adapter manifest has no trusted patch plans")
        return PrecompiledPatchSetApplier(self.root, plans)

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
        root = manifest_path.parent.resolve()

        def verified_path(item: dict[str, Any], kind: str) -> Path:
            item_path = (root / item["path"]).resolve()
            try:
                item_path.relative_to(root)
            except ValueError as error:
                raise BuildIntegrityError(
                    f"{kind} escapes the adapter package"
                ) from error
            if not item_path.is_file() or sha256_file(item_path) != item["sha256"]:
                raise BuildIntegrityError(
                    f"{kind} hash does not match the adapter manifest"
                )
            if "sizeBytes" in item and item_path.stat().st_size != item["sizeBytes"]:
                raise BuildIntegrityError(
                    f"{kind} size does not match the adapter manifest"
                )
            return item_path

        source = raw["bridgeSource"]
        source_path = verified_path(source, "Bridge source")
        for build_source in raw.get("bridgeBuildSources", []):
            verified_path(build_source, "Bridge build source")
        for artifact in raw["artifacts"]:
            verified_path(artifact, "Bridge artifact")
        for plan_item in raw["patchPlans"]:
            plan_path = verified_path(plan_item, "Patch plan")
            plan = PrecompiledPatchPlan.load(plan_path)
            matching_artifacts = [
                artifact
                for artifact in raw["artifacts"]
                if artifact["path"] == plan.artifact_path.as_posix()
            ]
            if len(matching_artifacts) != 1:
                raise BuildIntegrityError(
                    "Patch plan artifact is not uniquely pinned by the manifest"
                )
            artifact = matching_artifacts[0]
            if (
                artifact["sha256"] != plan.artifact_sha256
                or artifact["sizeBytes"] != plan.artifact_size_bytes
            ):
                raise BuildIntegrityError(
                    "Patch plan and adapter manifest pin different artifacts"
                )
        memory_map_path = (root / protocol["memoryMap"]).resolve()
        MemoryMap.load(memory_map_path)
        release_gates = tuple(raw["releaseGates"])
        if not all(isinstance(item, str) and item for item in release_gates):
            raise BuildIntegrityError(
                "Adapter release gates must contain explicit non-empty text"
            )
        return cls(
            root=root,
            adapter_version=raw["adapterVersion"],
            protocol_version=protocol["version"],
            bridge_source=source_path,
            bridge_source_sha256=source["sha256"],
            artifacts=tuple(raw["artifacts"]),
            patch_plans=tuple(raw["patchPlans"]),
            release_gates=release_gates,
            raw=raw,
        )
