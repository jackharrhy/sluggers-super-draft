from __future__ import annotations

import hashlib
import json
import math
import os
import struct
import tempfile
from dataclasses import dataclass
from itertools import pairwise
from pathlib import Path, PurePosixPath
from typing import Any

from starworks_runner.contracts import validate_contract
from starworks_runner.games.sluggers.errors import BuildIntegrityError
from starworks_runner.games.sluggers.hashing import sha256_file, sha256_json


def _sha256(value: str, field_name: str) -> str:
    if len(value) != 64 or any(
        character not in "0123456789abcdef" for character in value
    ):
        raise BuildIntegrityError(f"{field_name} must be lowercase SHA-256 hex")
    return value


def _safe_path(value: str, field_name: str) -> PurePosixPath:
    path = PurePosixPath(value)
    if path.is_absolute() or not path.parts or ".." in path.parts:
        raise BuildIntegrityError(f"{field_name} must be a safe relative path")
    return path


def _exact_keys(value: dict[str, Any], expected: set[str], field_name: str) -> None:
    if set(value) != expected:
        raise BuildIntegrityError(f"{field_name} has missing or unknown fields")


@dataclass(frozen=True)
class StaticValueTarget:
    target_id: str
    operation: str
    character_id: str | None
    rule_key: str | None
    gameplay_target: str
    resource: str | None
    codec: str
    target_path: PurePosixPath
    target_offset: int
    expected_bytes: bytes
    supported_input_sha256: tuple[str, ...]
    enum_values: dict[str, int]

    def matches(self, operation: dict[str, Any]) -> bool:
        if operation["operation"] != self.operation:
            return False
        if operation["gameplayTarget"] != self.gameplay_target:
            return False
        if operation.get("characterId") != self.character_id:
            return False
        if operation.get("ruleKey") != self.rule_key:
            return False
        if self.resource is not None and operation.get("resource") != self.resource:
            return False
        return operation.get("codec", self.codec) == self.codec


@dataclass(frozen=True)
class StaticAssetTarget:
    target_id: str
    character_id: str
    slot: str
    target_path: PurePosixPath
    target_offset: int
    expected_bytes: bytes
    supported_input_sha256: tuple[str, ...]
    media_types: tuple[str, ...]


@dataclass(frozen=True)
class PatternRegionGuard:
    guard_id: str
    target_path: PurePosixPath
    target_offset: int
    virtual_address: int
    size_bytes: int
    expected_sha256: str
    supported_input_sha256: tuple[str, ...]

    @property
    def end_offset(self) -> int:
        return self.target_offset + self.size_bytes


@dataclass(frozen=True)
class MatrixPatternTarget:
    target_id: str
    guard_id: str
    source: str
    source_row_start: int
    source_column_start: int
    rows: int
    columns: int
    target_offset: int
    virtual_address: int
    row_stride: int
    column_stride: int
    codec: str
    activation_rows_per_entry: int | None


@dataclass(frozen=True)
class StaticTargetCatalog:
    adapter_version: str
    value_targets: tuple[StaticValueTarget, ...]
    asset_targets: tuple[StaticAssetTarget, ...]
    profile_guards: tuple[PatternRegionGuard, ...] = ()
    profile_patterns: tuple[MatrixPatternTarget, ...] = ()
    provisioning_note: str = ""

    @classmethod
    def load(cls, path: Path | None = None) -> StaticTargetCatalog:
        catalog_path = path or Path(__file__).with_name("static_targets.json")
        try:
            raw = json.loads(catalog_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as error:
            raise BuildIntegrityError(
                f"Static target catalog is unreadable: {catalog_path}"
            ) from error
        _exact_keys(
            raw,
            {
                "kind",
                "adapterVersion",
                "target",
                "valueTargets",
                "assetTargets",
                "profileGuards",
                "profilePatterns",
                "provisioningNote",
            },
            "Static target catalog",
        )
        if raw["kind"] != "sluggers-static-target-catalog":
            raise BuildIntegrityError("Unsupported static target catalog")
        if raw["target"] != {"gameId": "RMBE01", "region": "NTSC-U", "revision": 0}:
            raise BuildIntegrityError(
                "Static target catalog targets the wrong game base"
            )
        return cls(
            adapter_version=raw["adapterVersion"],
            value_targets=tuple(
                _parse_value_target(item) for item in raw["valueTargets"]
            ),
            asset_targets=tuple(
                _parse_asset_target(item) for item in raw["assetTargets"]
            ),
            profile_guards=tuple(
                _parse_pattern_guard(item) for item in raw["profileGuards"]
            ),
            profile_patterns=tuple(
                _parse_matrix_pattern(item) for item in raw["profilePatterns"]
            ),
            provisioning_note=raw["provisioningNote"],
        ).validated()

    def validated(self) -> StaticTargetCatalog:
        if not self.adapter_version:
            raise BuildIntegrityError("Static target catalog has no adapter version")
        identifiers = [
            target.target_id for target in (*self.value_targets, *self.asset_targets)
        ]
        if any(not identifier or len(identifier) > 127 for identifier in identifiers):
            raise BuildIntegrityError(
                "Static target IDs must contain 1 to 127 characters"
            )
        if len(set(identifiers)) != len(identifiers):
            raise BuildIntegrityError("Static target IDs must be unique")
        for target in (*self.value_targets, *self.asset_targets):
            if target.target_offset < 0 or not target.expected_bytes:
                raise BuildIntegrityError(
                    f"Static target {target.target_id} has invalid bytes or offset"
                )
            if not target.supported_input_sha256:
                raise BuildIntegrityError(
                    f"Static target {target.target_id} declares no supported base hash"
                )
        guards = {guard.guard_id: guard for guard in self.profile_guards}
        if len(guards) != len(self.profile_guards):
            raise BuildIntegrityError("Profile guard IDs must be unique")
        for guard in self.profile_guards:
            if (
                guard.target_offset < 0
                or guard.virtual_address < 0x80000000
                or guard.size_bytes <= 0
                or not guard.supported_input_sha256
            ):
                raise BuildIntegrityError(
                    f"Profile guard {guard.guard_id} has invalid bounds"
                )
        pattern_ids = [pattern.target_id for pattern in self.profile_patterns]
        if len(set(pattern_ids)) != len(pattern_ids):
            raise BuildIntegrityError("Profile pattern IDs must be unique")
        for pattern in self.profile_patterns:
            guard = guards.get(pattern.guard_id)
            if guard is None:
                raise BuildIntegrityError(
                    f"Profile pattern {pattern.target_id} references an unknown guard"
                )
            codec_size = _codec_size(pattern.codec)
            if (
                pattern.source not in _PROFILE_MATRIX_SOURCES
                or min(
                    pattern.source_row_start,
                    pattern.source_column_start,
                    pattern.target_offset,
                )
                < 0
                or pattern.rows <= 0
                or pattern.columns <= 0
                or pattern.row_stride <= 0
                or pattern.column_stride < codec_size
                or pattern.virtual_address < 0x80000000
            ):
                raise BuildIntegrityError(
                    f"Profile pattern {pattern.target_id} is invalid"
                )
            final_offset = (
                pattern.target_offset
                + (pattern.rows - 1) * pattern.row_stride
                + (pattern.columns - 1) * pattern.column_stride
                + codec_size
            )
            if (
                pattern.target_offset < guard.target_offset
                or final_offset > guard.end_offset
                or pattern.virtual_address - guard.virtual_address
                != pattern.target_offset - guard.target_offset
            ):
                raise BuildIntegrityError(
                    f"Profile pattern {pattern.target_id} escapes or disagrees with its guard"
                )
            if pattern.activation_rows_per_entry is not None and (
                pattern.source != "trajectory-tables"
                or pattern.activation_rows_per_entry <= 0
                or pattern.rows % pattern.activation_rows_per_entry != 0
            ):
                raise BuildIntegrityError(
                    f"Profile pattern {pattern.target_id} has an invalid activation mask"
                )
        return self

    def value_target(self, operation: dict[str, Any]) -> StaticValueTarget:
        matches = [target for target in self.value_targets if target.matches(operation)]
        if len(matches) != 1:
            selector = (
                operation.get("characterId") or operation.get("ruleKey") or "unknown"
            )
            detail = (
                self.provisioning_note or "No reviewed mapping exists for this value"
            )
            raise BuildIntegrityError(
                f"Unsupported static operation {operation['operation']} {selector} "
                f"({operation['gameplayTarget']}): {detail}"
            )
        return matches[0]

    def asset_target(self, character_id: str, slot: str) -> StaticAssetTarget:
        matches = [
            target
            for target in self.asset_targets
            if target.character_id == character_id and target.slot == slot
        ]
        if len(matches) != 1:
            detail = (
                self.provisioning_note or "No reviewed mapping exists for this asset"
            )
            raise BuildIntegrityError(
                f"Unsupported {slot} replacement for {character_id}: {detail}"
            )
        return matches[0]


@dataclass(frozen=True)
class ContentPackInput:
    manifest: dict[str, Any]
    operation_bundle: dict[str, Any]
    assets_root: Path | None = None
    target_catalog: StaticTargetCatalog | None = None

    @classmethod
    def load(
        cls,
        manifest_path: Path,
        operation_bundle_path: Path,
        *,
        assets_root: Path | None = None,
        target_catalog_path: Path | None = None,
    ) -> ContentPackInput:
        try:
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            operations = json.loads(operation_bundle_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as error:
            raise BuildIntegrityError("Content-pack input is unreadable") from error
        return cls(
            manifest=manifest,
            operation_bundle=operations,
            assets_root=assets_root,
            target_catalog=StaticTargetCatalog.load(target_catalog_path),
        )


@dataclass(frozen=True)
class PlannedWrite:
    target_id: str
    target_path: PurePosixPath
    target_offset: int
    expected_bytes: bytes | None
    replacement_bytes: bytes
    supported_input_sha256: tuple[str, ...]

    @property
    def end_offset(self) -> int:
        return self.target_offset + len(self.replacement_bytes)


@dataclass(frozen=True)
class ContentCompilationPlan:
    content_pack_sha256: str
    writes: tuple[PlannedWrite, ...]
    guards: tuple[PatternRegionGuard, ...] = ()

    def apply(
        self,
        game_root: Path,
        *,
        verified_base_sha256_by_path: dict[PurePosixPath, str] | None = None,
    ) -> list[dict[str, str]]:
        by_path: dict[PurePosixPath, list[PlannedWrite]] = {}
        for write in self.writes:
            by_path.setdefault(write.target_path, []).append(write)

        outputs: dict[Path, tuple[bytes, str]] = {}
        guards_by_path: dict[PurePosixPath, list[PatternRegionGuard]] = {}
        for guard in self.guards:
            guards_by_path.setdefault(guard.target_path, []).append(guard)
        all_paths = sorted(
            {*by_path, *guards_by_path}, key=lambda item: item.as_posix()
        )
        for relative_path in all_paths:
            writes = by_path.get(relative_path, [])
            target_path = (game_root.resolve() / relative_path).resolve()
            try:
                target_path.relative_to(game_root.resolve())
            except ValueError as error:
                raise BuildIntegrityError(
                    "Content target escapes the managed game tree"
                ) from error
            if not target_path.is_file():
                raise BuildIntegrityError(
                    f"Content target does not exist: {relative_path}"
                )
            original = target_path.read_bytes()
            input_sha256 = hashlib.sha256(original).hexdigest()
            verified_input_sha256 = (verified_base_sha256_by_path or {}).get(
                relative_path, input_sha256
            )
            for guard in guards_by_path.get(relative_path, []):
                if verified_input_sha256 not in guard.supported_input_sha256:
                    raise BuildIntegrityError(
                        f"Profile guard {guard.guard_id} does not support input "
                        f"{verified_input_sha256} (verified base)"
                    )
                if guard.end_offset > len(original):
                    raise BuildIntegrityError(
                        f"Profile guard {guard.guard_id} exceeds its target file"
                    )
                mapped_offset = _dol_virtual_to_file_offset(
                    original, guard.virtual_address
                )
                if mapped_offset != guard.target_offset:
                    raise BuildIntegrityError(
                        f"Profile guard {guard.guard_id} virtual and file offsets disagree"
                    )
                actual_sha256 = hashlib.sha256(
                    original[guard.target_offset : guard.end_offset]
                ).hexdigest()
                if actual_sha256 != guard.expected_sha256:
                    raise BuildIntegrityError(
                        f"Profile guard {guard.guard_id} region hash failed"
                    )
            for write in writes:
                if verified_input_sha256 not in write.supported_input_sha256:
                    raise BuildIntegrityError(
                        f"Static target {write.target_id} does not support input "
                        f"{verified_input_sha256} (verified base)"
                    )
            ordered = sorted(
                writes, key=lambda item: (item.target_offset, item.target_id)
            )
            for left, right in pairwise(ordered):
                if left.end_offset > right.target_offset:
                    raise BuildIntegrityError(
                        f"Content writes conflict: {left.target_id} and {right.target_id}"
                    )
            output = bytearray(original)
            for write in ordered:
                if write.end_offset > len(output):
                    raise BuildIntegrityError(
                        f"Static target {write.target_id} exceeds its file"
                    )
                actual = bytes(output[write.target_offset : write.end_offset])
                if write.expected_bytes is not None and actual != write.expected_bytes:
                    raise BuildIntegrityError(
                        f"Static target {write.target_id} expected-byte guard failed at "
                        f"0x{write.target_offset:X}: expected {write.expected_bytes.hex()}, "
                        f"got {actual.hex()}"
                    )
                output[write.target_offset : write.end_offset] = write.replacement_bytes
            outputs[target_path] = (bytes(output), input_sha256)

        receipts: list[dict[str, str]] = []
        for target_path, (output, input_sha256) in outputs.items():
            descriptor, temporary_name = tempfile.mkstemp(
                prefix=f".{target_path.name}.",
                suffix=".content-pack",
                dir=target_path.parent,
            )
            temporary_path = Path(temporary_name)
            try:
                with os.fdopen(descriptor, "wb") as file:
                    file.write(output)
                    file.flush()
                    os.fsync(file.fileno())
                os.replace(temporary_path, target_path)
            finally:
                temporary_path.unlink(missing_ok=True)
            relative_path = target_path.relative_to(game_root.resolve()).as_posix()
            output_sha256 = sha256_file(target_path)
            receipts.append(
                {
                    "patchId": f"content-pack-{self.content_pack_sha256[:16]}-{target_path.name}"[
                        :127
                    ],
                    "targetPath": relative_path,
                    "expectedInputSha256": input_sha256,
                    "outputSha256": output_sha256,
                }
            )
        return receipts


class ContentPackCompiler:
    """Translate declarative content into guarded writes inside a fresh build tree."""

    def plan(
        self, source: ContentPackInput, *, main_dol_sha256: str
    ) -> ContentCompilationPlan:
        validate_contract("content-pack-manifest", source.manifest)
        validate_contract("adapter-operation-bundle", source.operation_bundle)
        manifest = source.manifest
        bundle = source.operation_bundle
        catalog = source.target_catalog or StaticTargetCatalog.load()
        if manifest["adapterVersion"] != bundle["adapterVersion"]:
            raise BuildIntegrityError(
                "Content manifest and operation bundle use different adapters"
            )
        if catalog.adapter_version != manifest["adapterVersion"]:
            raise BuildIntegrityError(
                "Static target catalog uses a different adapter version"
            )
        if manifest["statProfileRevisionId"] != bundle["statProfileRevisionId"]:
            raise BuildIntegrityError(
                "Content manifest references a different stat profile"
            )
        if manifest["rulesetRevisionId"] != bundle["rulesetRevisionId"]:
            raise BuildIntegrityError("Content manifest references a different ruleset")
        supported_dol_hashes = {
            revision["mainDolSha256"]
            for revision in manifest["targetGame"]["supportedRevisions"]
        }
        if main_dol_sha256 not in supported_dol_hashes:
            raise BuildIntegrityError(
                "Content pack does not support this exact main.dol base"
            )

        stat_characters = {
            assignment["characterId"]
            for assignment in manifest["assignments"]
            if assignment["assignmentType"] == "character-stats"
        }
        build_operations = [
            operation
            for operation in bundle["operations"]
            if operation["operation"]
            in {
                "apply-sluggers-stat-profile",
                "set-character-stat",
                "set-game-rule",
            }
            and operation["loadPhase"] == "build-time"
            and (
                operation["operation"] != "set-character-stat"
                or operation["characterId"] in stat_characters
            )
        ]
        build_operations.sort(
            key=lambda operation: json.dumps(
                operation, sort_keys=True, separators=(",", ":")
            )
        )
        content_pack_sha256 = sha256_json(
            {"manifest": manifest, "buildOperations": build_operations}
        )

        writes: list[PlannedWrite] = []
        guards: dict[str, PatternRegionGuard] = {}
        for operation in build_operations:
            if operation["operation"] == "apply-sluggers-stat-profile":
                profile_writes, profile_guards = _compile_profile_patterns(
                    operation, catalog
                )
                writes.extend(profile_writes)
                for guard in profile_guards:
                    guards[guard.guard_id] = guard
                continue
            target = catalog.value_target(operation)
            replacement = _encode_value(operation["value"], target)
            writes.append(
                PlannedWrite(
                    target_id=target.target_id,
                    target_path=target.target_path,
                    target_offset=target.target_offset,
                    expected_bytes=target.expected_bytes,
                    replacement_bytes=replacement,
                    supported_input_sha256=target.supported_input_sha256,
                )
            )

        assets = {asset["sha256"]: asset for asset in manifest["assets"]}
        if len(assets) != len(manifest["assets"]):
            raise BuildIntegrityError("Content pack lists a duplicate asset hash")
        for assignment in manifest["assignments"]:
            if assignment["assignmentType"] != "character-asset":
                continue
            asset = assets.get(assignment["assetSha256"])
            if asset is None:
                raise BuildIntegrityError(
                    "Content assignment references an undeclared asset"
                )
            target = catalog.asset_target(assignment["characterId"], assignment["slot"])
            if asset["mediaType"] not in target.media_types:
                raise BuildIntegrityError(
                    f"Static target {target.target_id} does not accept {asset['mediaType']}"
                )
            if source.assets_root is None:
                raise BuildIntegrityError(
                    "Content pack assets have no local asset directory"
                )
            asset_path = source.assets_root.resolve() / asset["sha256"]
            if (
                not asset_path.is_file()
                or asset_path.stat().st_size != asset["sizeBytes"]
                or sha256_file(asset_path) != asset["sha256"]
            ):
                raise BuildIntegrityError(
                    f"Content asset {asset['sha256']} failed hash or size verification"
                )
            replacement = asset_path.read_bytes()
            if len(replacement) != len(target.expected_bytes):
                raise BuildIntegrityError(
                    f"Static target {target.target_id} requires exactly {len(target.expected_bytes)} bytes"
                )
            writes.append(
                PlannedWrite(
                    target_id=target.target_id,
                    target_path=target.target_path,
                    target_offset=target.target_offset,
                    expected_bytes=target.expected_bytes,
                    replacement_bytes=replacement,
                    supported_input_sha256=target.supported_input_sha256,
                )
            )
        _reject_planned_conflicts(writes)
        return ContentCompilationPlan(
            content_pack_sha256,
            tuple(writes),
            tuple(sorted(guards.values(), key=lambda item: item.guard_id)),
        )


_PROFILE_MATRIX_SOURCES = {
    "character-stats",
    "chemistry",
    "trajectory-tables",
    "character-sizes",
    "pitching",
    "global-speed-curves",
    "team-star-events",
    "star-boosts",
    "star-handicaps",
    "handicap-parameters",
}

_REQUIRED_PROFILE_MATRIX_SOURCES = _PROFILE_MATRIX_SOURCES


def _compile_profile_patterns(
    operation: dict[str, Any], catalog: StaticTargetCatalog
) -> tuple[list[PlannedWrite], tuple[PatternRegionGuard, ...]]:
    if not catalog.profile_patterns or not catalog.profile_guards:
        raise BuildIntegrityError(
            "The adapter has no reviewed full Stat Editor profile mapping"
        )
    patterns_by_source: dict[str, list[MatrixPatternTarget]] = {}
    for pattern in catalog.profile_patterns:
        patterns_by_source.setdefault(pattern.source, []).append(pattern)
    missing = sorted(_REQUIRED_PROFILE_MATRIX_SOURCES - patterns_by_source.keys())
    if missing:
        raise BuildIntegrityError(
            f"Full Stat Editor mapping is incomplete: {', '.join(missing)}"
        )

    tuning = operation["tuning"]
    activation = tuning["trajectoryActivation"]
    if any(value not in {0, 1} for value in activation):
        raise BuildIntegrityError(
            "Trajectory activation values must be 0 or 1 for a game build"
        )

    guards_by_id = {guard.guard_id: guard for guard in catalog.profile_guards}
    used_guards: dict[str, PatternRegionGuard] = {}
    writes: list[PlannedWrite] = []
    matrices: dict[str, list[list[object]]] = {}
    for source in sorted(patterns_by_source):
        matrix = matrices.setdefault(source, _profile_source_matrix(operation, source))
        for pattern in patterns_by_source[source]:
            guard = guards_by_id[pattern.guard_id]
            used_guards[guard.guard_id] = guard
            source_row_end = pattern.source_row_start + pattern.rows
            if source_row_end > len(matrix):
                raise BuildIntegrityError(
                    f"Profile pattern {pattern.target_id} exceeds {source} rows"
                )
            for row in range(pattern.rows):
                if pattern.activation_rows_per_entry is not None:
                    activation_index = row // pattern.activation_rows_per_entry
                    if activation[activation_index] == 0:
                        continue
                source_row = matrix[pattern.source_row_start + row]
                source_column_end = pattern.source_column_start + pattern.columns
                if source_column_end > len(source_row):
                    raise BuildIntegrityError(
                        f"Profile pattern {pattern.target_id} exceeds {source} columns"
                    )
                for column in range(pattern.columns):
                    value = source_row[pattern.source_column_start + column]
                    replacement = _encode_scalar(
                        value,
                        pattern.codec,
                        _codec_size(pattern.codec),
                        pattern.target_id,
                    )
                    target_offset = (
                        pattern.target_offset
                        + row * pattern.row_stride
                        + column * pattern.column_stride
                    )
                    writes.append(
                        PlannedWrite(
                            target_id=f"{pattern.target_id}-{row}-{column}",
                            target_path=guard.target_path,
                            target_offset=target_offset,
                            expected_bytes=None,
                            replacement_bytes=replacement,
                            supported_input_sha256=guard.supported_input_sha256,
                        )
                    )
    return writes, tuple(used_guards.values())


def _profile_source_matrix(
    operation: dict[str, Any], source: str
) -> list[list[object]]:
    if source.startswith("character-") or source == "pitching":
        group, columns = {
            "character-stats": ("stat", 30),
            "character-sizes": ("size", 14),
            "pitching": ("pitching", 5),
        }[source]
        rows: list[list[object]] = []
        for assignment in operation["characterValues"]:
            values = assignment["values"]
            row: list[object] = []
            for column in range(columns):
                key = f"legacy.stat-editor.{group}-{column:02d}"
                if key not in values:
                    raise BuildIntegrityError(
                        f"Full Stat Editor profile is missing {key} for "
                        f"{assignment['characterId']}"
                    )
                row.append(values[key])
            rows.append(row)
        return rows
    tuning_key = {
        "chemistry": "chemistry",
        "trajectory-tables": "trajectoryTables",
        "global-speed-curves": "globalSpeedCurves",
        "team-star-events": "teamStarEvents",
        "star-boosts": "starBoosts",
        "star-handicaps": "starHandicaps",
        "handicap-parameters": "handicapParameters",
    }[source]
    return operation["tuning"][tuning_key]


def _reject_planned_conflicts(writes: list[PlannedWrite]) -> None:
    ordered = sorted(
        writes,
        key=lambda item: (
            item.target_path.as_posix(),
            item.target_offset,
            item.target_id,
        ),
    )
    for left, right in pairwise(ordered):
        if (
            left.target_path == right.target_path
            and left.end_offset > right.target_offset
        ):
            raise BuildIntegrityError(
                f"Content writes conflict: {left.target_id} and {right.target_id}"
            )


def _encode_value(value: object, target: StaticValueTarget) -> bytes:
    return _encode_scalar(
        value,
        target.codec,
        len(target.expected_bytes),
        target.target_id,
        target.enum_values,
    )


def _codec_size(codec: str) -> int:
    try:
        return {
            "bool": 1,
            "enum": 1,
            "f32-be": 4,
            "s16-be": 2,
            "u16-be": 2,
            "u32-be": 4,
            "u8": 1,
        }[codec]
    except KeyError as error:
        raise BuildIntegrityError(f"Unsupported static codec {codec!r}") from error


def _encode_scalar(
    value: object,
    codec: str,
    expected_size: int,
    target_id: str,
    enum_values: dict[str, int] | None = None,
) -> bytes:
    try:
        if codec == "bool":
            if not isinstance(value, bool):
                raise ValueError
            encoded = bytes([int(value)])
        elif codec == "enum":
            if (
                not isinstance(value, str)
                or enum_values is None
                or value not in enum_values
            ):
                raise ValueError
            numeric = enum_values[value]
            encoded = numeric.to_bytes(expected_size, "big", signed=False)
        elif codec == "f32-be":
            if (
                isinstance(value, bool)
                or not isinstance(value, (int, float))
                or not math.isfinite(value)
            ):
                raise ValueError
            encoded = struct.pack(">f", value)
        else:
            formats = {
                "s16-be": (2, True),
                "u16-be": (2, False),
                "u32-be": (4, False),
                "u8": (1, False),
            }
            size, signed = formats[codec]
            if isinstance(value, bool) or not isinstance(value, int):
                raise ValueError
            encoded = value.to_bytes(size, "big", signed=signed)
    except (KeyError, OverflowError, ValueError, struct.error) as error:
        raise BuildIntegrityError(
            f"Value {value!r} cannot be encoded as {codec} for {target_id}"
        ) from error
    if len(encoded) != expected_size:
        raise BuildIntegrityError(
            f"Static target {target_id} expects {expected_size} bytes, "
            f"but {codec} emits {len(encoded)}"
        )
    return encoded


def _dol_virtual_to_file_offset(source: bytes, virtual_address: int) -> int:
    if len(source) < 0x100:
        raise BuildIntegrityError("DOL target is too short to contain a header")
    offsets = struct.unpack(">18I", source[0x00:0x48])
    addresses = struct.unpack(">18I", source[0x48:0x90])
    sizes = struct.unpack(">18I", source[0x90:0xD8])
    matches = [
        file_offset + virtual_address - address
        for file_offset, address, size in zip(offsets, addresses, sizes, strict=True)
        if size and address <= virtual_address < address + size
    ]
    if len(matches) != 1:
        raise BuildIntegrityError(
            f"Virtual address 0x{virtual_address:08X} is not uniquely mapped by the DOL"
        )
    return matches[0]


def _parse_value_target(raw: dict[str, Any]) -> StaticValueTarget:
    _exact_keys(
        raw,
        {
            "id",
            "operation",
            "characterId",
            "ruleKey",
            "gameplayTarget",
            "resource",
            "codec",
            "targetPath",
            "targetOffset",
            "expectedBytesHex",
            "supportedInputSha256",
            "enumValues",
        },
        "Static value target",
    )
    try:
        expected_bytes = bytes.fromhex(raw["expectedBytesHex"])
    except (TypeError, ValueError) as error:
        raise BuildIntegrityError(
            "Static value target expected bytes are not hex"
        ) from error
    return StaticValueTarget(
        target_id=raw["id"],
        operation=raw["operation"],
        character_id=raw["characterId"],
        rule_key=raw["ruleKey"],
        gameplay_target=raw["gameplayTarget"],
        resource=raw["resource"],
        codec=raw["codec"],
        target_path=_safe_path(raw["targetPath"], "targetPath"),
        target_offset=raw["targetOffset"],
        expected_bytes=expected_bytes,
        supported_input_sha256=tuple(
            _sha256(value, "supportedInputSha256")
            for value in raw["supportedInputSha256"]
        ),
        enum_values=raw["enumValues"],
    )


def _parse_asset_target(raw: dict[str, Any]) -> StaticAssetTarget:
    _exact_keys(
        raw,
        {
            "id",
            "characterId",
            "slot",
            "targetPath",
            "targetOffset",
            "expectedBytesHex",
            "supportedInputSha256",
            "mediaTypes",
        },
        "Static asset target",
    )
    try:
        expected_bytes = bytes.fromhex(raw["expectedBytesHex"])
    except (TypeError, ValueError) as error:
        raise BuildIntegrityError(
            "Static asset target expected bytes are not hex"
        ) from error
    return StaticAssetTarget(
        target_id=raw["id"],
        character_id=raw["characterId"],
        slot=raw["slot"],
        target_path=_safe_path(raw["targetPath"], "targetPath"),
        target_offset=raw["targetOffset"],
        expected_bytes=expected_bytes,
        supported_input_sha256=tuple(
            _sha256(value, "supportedInputSha256")
            for value in raw["supportedInputSha256"]
        ),
        media_types=tuple(raw["mediaTypes"]),
    )


def _parse_pattern_guard(raw: dict[str, Any]) -> PatternRegionGuard:
    _exact_keys(
        raw,
        {
            "id",
            "targetPath",
            "targetOffset",
            "virtualAddress",
            "sizeBytes",
            "expectedSha256",
            "supportedInputSha256",
        },
        "Profile pattern guard",
    )
    try:
        virtual_address = int(raw["virtualAddress"], 16)
    except (TypeError, ValueError) as error:
        raise BuildIntegrityError(
            "Profile guard virtualAddress must be hexadecimal"
        ) from error
    return PatternRegionGuard(
        guard_id=raw["id"],
        target_path=_safe_path(raw["targetPath"], "targetPath"),
        target_offset=raw["targetOffset"],
        virtual_address=virtual_address,
        size_bytes=raw["sizeBytes"],
        expected_sha256=_sha256(raw["expectedSha256"], "expectedSha256"),
        supported_input_sha256=tuple(
            _sha256(value, "supportedInputSha256")
            for value in raw["supportedInputSha256"]
        ),
    )


def _parse_matrix_pattern(raw: dict[str, Any]) -> MatrixPatternTarget:
    _exact_keys(
        raw,
        {
            "id",
            "guardId",
            "source",
            "sourceRowStart",
            "sourceColumnStart",
            "rows",
            "columns",
            "targetOffset",
            "virtualAddress",
            "rowStride",
            "columnStride",
            "codec",
            "activationRowsPerEntry",
        },
        "Profile matrix pattern",
    )
    try:
        virtual_address = int(raw["virtualAddress"], 16)
    except (TypeError, ValueError) as error:
        raise BuildIntegrityError(
            "Profile pattern virtualAddress must be hexadecimal"
        ) from error
    return MatrixPatternTarget(
        target_id=raw["id"],
        guard_id=raw["guardId"],
        source=raw["source"],
        source_row_start=raw["sourceRowStart"],
        source_column_start=raw["sourceColumnStart"],
        rows=raw["rows"],
        columns=raw["columns"],
        target_offset=raw["targetOffset"],
        virtual_address=virtual_address,
        row_stride=raw["rowStride"],
        column_stride=raw["columnStride"],
        codec=raw["codec"],
        activation_rows_per_entry=raw["activationRowsPerEntry"],
    )
