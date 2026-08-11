#!/usr/bin/env python3
from __future__ import annotations

import argparse
import ast
import copy
import hashlib
import json
import math
import shutil
import struct
import tempfile
import warnings
from pathlib import Path
from typing import Any

from starworks_runner.games.sluggers.content import (
    ContentCompilationPlan,
    StaticTargetCatalog,
    _codec_size,
    _compile_profile_patterns,
    _dol_virtual_to_file_offset,
    _encode_scalar,
)
from starworks_runner.games.sluggers.errors import BuildIntegrityError


_EDITOR_DEFAULTS_BY_SOURCE = {
    "character-stats": "defaultStat",
    "chemistry": "defaultChem",
    "trajectory-tables": "defaultTraj",
    "character-sizes": "defaultSize",
    "pitching": "defaultPitching",
    "global-speed-curves": "defaultSpeed",
    "team-star-events": "defaultStarsTeam",
    "star-boosts": "defaultStarBoost",
    "star-handicaps": "defaultStarHandicap",
    "handicap-parameters": "defaultHandicapParams",
}


def main() -> int:
    parser = argparse.ArgumentParser(
        description=(
            "Verify every guarded Stat Editor profile pattern against an exact "
            "RMBE01 main.dol without writing game data"
        )
    )
    parser.add_argument("--dol", type=Path, required=True)
    parser.add_argument("--catalog", type=Path)
    parser.add_argument(
        "--stat-editor-source",
        type=Path,
        help=(
            "Optionally compare every mapped stock value with the trusted "
            "Sluggers Stat Editor v4 Python source without executing it"
        ),
    )
    parser.add_argument(
        "--exercise-compiler",
        action="store_true",
        help=(
            "Apply one representative mutation for every profile pattern to a "
            "temporary copy of the exact DOL"
        ),
    )
    arguments = parser.parse_args()
    if arguments.exercise_compiler and not arguments.stat_editor_source:
        parser.error("--exercise-compiler requires --stat-editor-source")

    source = arguments.dol.expanduser().resolve().read_bytes()
    input_sha256 = hashlib.sha256(source).hexdigest()
    catalog = StaticTargetCatalog.load(arguments.catalog)
    guards = {guard.guard_id: guard for guard in catalog.profile_guards}
    verified_guards: set[str] = set()
    byte_owners: dict[int, str] = {}
    scalar_cells = 0
    editor_defaults = (
        load_stat_editor_defaults(arguments.stat_editor_source)
        if arguments.stat_editor_source
        else None
    )
    trusted_editor_cells = 0

    for guard in catalog.profile_guards:
        if input_sha256 not in guard.supported_input_sha256:
            raise BuildIntegrityError(
                f"Guard {guard.guard_id} does not support DOL {input_sha256}"
            )
        if (
            _dol_virtual_to_file_offset(source, guard.virtual_address)
            != guard.target_offset
        ):
            raise BuildIntegrityError(
                f"Guard {guard.guard_id} virtual/file mapping is invalid"
            )
        actual = hashlib.sha256(
            source[guard.target_offset : guard.end_offset]
        ).hexdigest()
        if actual != guard.expected_sha256:
            raise BuildIntegrityError(
                f"Guard {guard.guard_id} does not match the reviewed region hash"
            )
        verified_guards.add(guard.guard_id)

    for pattern in catalog.profile_patterns:
        guard = guards[pattern.guard_id]
        if (
            _dol_virtual_to_file_offset(source, pattern.virtual_address)
            != pattern.target_offset
        ):
            raise BuildIntegrityError(
                f"Pattern {pattern.target_id} virtual/file mapping is invalid"
            )
        size = _codec_size(pattern.codec)
        for row in range(pattern.rows):
            for column in range(pattern.columns):
                offset = (
                    pattern.target_offset
                    + row * pattern.row_stride
                    + column * pattern.column_stride
                )
                if offset < guard.target_offset or offset + size > guard.end_offset:
                    raise BuildIntegrityError(
                        f"Pattern {pattern.target_id} escapes guard {guard.guard_id}"
                    )
                for byte_offset in range(offset, offset + size):
                    previous = byte_owners.setdefault(byte_offset, pattern.target_id)
                    if previous != pattern.target_id:
                        raise BuildIntegrityError(
                            f"Patterns overlap: {previous} and {pattern.target_id}"
                        )
                encoded = source[offset : offset + size]
                value = decode_scalar(encoded, pattern.codec)
                if (
                    _encode_scalar(value, pattern.codec, size, pattern.target_id)
                    != encoded
                ):
                    raise BuildIntegrityError(
                        f"Pattern {pattern.target_id} is not byte round-trippable"
                    )
                if editor_defaults is not None:
                    editor_matrix = editor_defaults[pattern.source]
                    editor_value = editor_matrix[
                        pattern.source_row_start + row
                    ][pattern.source_column_start + column]
                    editor_encoded = _encode_scalar(
                        editor_value,
                        pattern.codec,
                        size,
                        pattern.target_id,
                    )
                    if editor_encoded != encoded:
                        raise BuildIntegrityError(
                            f"Pattern {pattern.target_id} row {row} column {column} "
                            "disagrees with the trusted Stat Editor default"
                        )
                    trusted_editor_cells += 1
                scalar_cells += 1

    report: dict[str, object] = {
        "adapterVersion": catalog.adapter_version,
        "dolSha256": input_sha256,
        "guardCount": len(verified_guards),
        "patternCount": len(catalog.profile_patterns),
        "scalarCells": scalar_cells,
        "status": "verified",
    }
    if arguments.stat_editor_source:
        report["statEditorSourceSha256"] = hashlib.sha256(
            arguments.stat_editor_source.expanduser().resolve().read_bytes()
        ).hexdigest()
        report["trustedEditorCells"] = trusted_editor_cells
    if arguments.exercise_compiler:
        report["compilerExercise"] = exercise_compiler(
            source,
            catalog,
            editor_defaults,
        )
    print(json.dumps(report, sort_keys=True))
    return 0


def load_stat_editor_defaults(source_path: Path) -> dict[str, list[list[Any]]]:
    """Read only the editor's literal stock matrices; never import or execute it."""

    path = source_path.expanduser().resolve()
    try:
        source = path.read_text(encoding="utf-8")
    except OSError as error:
        raise BuildIntegrityError(
            f"Trusted Stat Editor source is unreadable: {path}"
        ) from error
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", SyntaxWarning)
        try:
            tree = ast.parse(source, filename=str(path))
        except SyntaxError as error:
            raise BuildIntegrityError(
                f"Trusted Stat Editor source cannot be parsed: {path}"
            ) from error

    wanted = set(_EDITOR_DEFAULTS_BY_SOURCE.values())
    assignments: dict[str, list[list[Any]]] = {}
    for node in tree.body:
        if (
            not isinstance(node, ast.Assign)
            or len(node.targets) != 1
            or not isinstance(node.targets[0], ast.Name)
            or node.targets[0].id not in wanted
        ):
            continue
        try:
            value = ast.literal_eval(node.value)
        except (TypeError, ValueError) as error:
            raise BuildIntegrityError(
                f"Trusted Stat Editor default {node.targets[0].id} is not literal data"
            ) from error
        if not isinstance(value, list) or any(
            not isinstance(row, list) for row in value
        ):
            raise BuildIntegrityError(
                f"Trusted Stat Editor default {node.targets[0].id} is not a matrix"
            )
        assignments[node.targets[0].id] = value

    missing = sorted(wanted - assignments.keys())
    if missing:
        raise BuildIntegrityError(
            f"Trusted Stat Editor source is missing defaults: {', '.join(missing)}"
        )
    return {
        source: assignments[assignment]
        for source, assignment in _EDITOR_DEFAULTS_BY_SOURCE.items()
    }


def exercise_compiler(
    source_dol: bytes,
    catalog: StaticTargetCatalog,
    editor_defaults: dict[str, list[list[Any]]] | None,
) -> dict[str, int | str]:
    if editor_defaults is None:
        raise BuildIntegrityError("Compiler exercise requires Stat Editor defaults")
    matrices = copy.deepcopy(editor_defaults)
    for pattern in catalog.profile_patterns:
        matrix = matrices[pattern.source]
        row = pattern.source_row_start
        column = pattern.source_column_start
        value = matrix[row][column]
        matrix[row][column] = (
            float(value) + 0.125 if pattern.codec == "f32-be" else int(value) + 1
        )

    operation = {
        "characterValues": [
            {
                "characterId": f"rmbe01-character-{row:03d}",
                "values": {
                    **{
                        f"legacy.stat-editor.stat-{column:02d}": value
                        for column, value in enumerate(
                            matrices["character-stats"][row]
                        )
                    },
                    **{
                        f"legacy.stat-editor.size-{column:02d}": value
                        for column, value in enumerate(
                            matrices["character-sizes"][row]
                        )
                    },
                    **{
                        f"legacy.stat-editor.pitching-{column:02d}": value
                        for column, value in enumerate(matrices["pitching"][row])
                    },
                },
            }
            for row in range(101)
        ],
        "operation": "apply-sluggers-stat-profile",
        "tuning": {
            "chemistry": matrices["chemistry"],
            "globalSpeedCurves": matrices["global-speed-curves"],
            "handicapParameters": matrices["handicap-parameters"],
            "starBoosts": matrices["star-boosts"],
            "starHandicaps": matrices["star-handicaps"],
            "teamStarEvents": matrices["team-star-events"],
            "trajectoryActivation": [1, 1, 1, 1, 1, 1],
            "trajectoryTables": matrices["trajectory-tables"],
        },
    }
    writes, guards = _compile_profile_patterns(operation, catalog)
    temporary_root = Path(tempfile.mkdtemp(prefix="starworks-profile-exercise-"))
    try:
        game_root = temporary_root / "game"
        target = game_root / "sys/main.dol"
        target.parent.mkdir(parents=True)
        target.write_bytes(source_dol)
        ContentCompilationPlan(
            "compiler-exercise",
            tuple(writes),
            guards,
        ).apply(game_root)
        output = target.read_bytes()
    finally:
        shutil.rmtree(temporary_root)

    changed_bytes = sum(left != right for left, right in zip(source_dol, output))
    if changed_bytes == 0:
        raise BuildIntegrityError("Compiler exercise did not mutate the exact DOL")
    return {
        "changedBytes": changed_bytes,
        "mutatedPatterns": len(catalog.profile_patterns),
        "outputDolSha256": hashlib.sha256(output).hexdigest(),
        "plannedWrites": len(writes),
    }


def decode_scalar(value: bytes, codec: str) -> int | float:
    if codec == "u8":
        return value[0]
    if codec == "u16-be":
        return int.from_bytes(value, "big", signed=False)
    if codec == "s16-be":
        return int.from_bytes(value, "big", signed=True)
    if codec == "u32-be":
        return int.from_bytes(value, "big", signed=False)
    if codec == "f32-be":
        number = struct.unpack(">f", value)[0]
        if not math.isfinite(number):
            raise BuildIntegrityError(
                "Reviewed profile mapping contains a non-finite float"
            )
        return number
    raise BuildIntegrityError(f"Profile verifier does not support codec {codec}")


if __name__ == "__main__":
    raise SystemExit(main())
