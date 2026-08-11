#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
import math
import struct
from pathlib import Path

from starworks_runner.games.sluggers.content import (
    StaticTargetCatalog,
    _codec_size,
    _dol_virtual_to_file_offset,
    _encode_scalar,
)
from starworks_runner.games.sluggers.errors import BuildIntegrityError


def main() -> int:
    parser = argparse.ArgumentParser(
        description=(
            "Verify every guarded Stat Editor profile pattern against an exact "
            "RMBE01 main.dol without writing game data"
        )
    )
    parser.add_argument("--dol", type=Path, required=True)
    parser.add_argument("--catalog", type=Path)
    arguments = parser.parse_args()

    source = arguments.dol.expanduser().resolve().read_bytes()
    input_sha256 = hashlib.sha256(source).hexdigest()
    catalog = StaticTargetCatalog.load(arguments.catalog)
    guards = {guard.guard_id: guard for guard in catalog.profile_guards}
    verified_guards: set[str] = set()
    byte_owners: dict[int, str] = {}
    scalar_cells = 0

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
                scalar_cells += 1

    print(
        json.dumps(
            {
                "adapterVersion": catalog.adapter_version,
                "dolSha256": input_sha256,
                "guardCount": len(verified_guards),
                "patternCount": len(catalog.profile_patterns),
                "scalarCells": scalar_cells,
                "status": "verified",
            },
            sort_keys=True,
        )
    )
    return 0


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
