#!/usr/bin/env python3
"""Build and package the reviewed RMBE01 bridge without redistributing game data."""

from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
import tempfile
from pathlib import Path

BASE_DOL_SHA256 = "3018e262480ccbf0daa04fc96f1c3dfb340dc4007a13f007f9423751c1346151"
BASE_DOL_SIZE = 0x716F20
BRIDGE_REGION_ADDRESS = 0x80001900
BRIDGE_REGION_SIZE = 0x1700
BRIDGE_CODE_ADDRESS = 0x80002A00
BRIDGE_CODE_OFFSET = BRIDGE_CODE_ADDRESS - BRIDGE_REGION_ADDRESS
BRIDGE_CODE_SHA256 = "77a2c72803e2f3b85f9e63ce9db178aeb10369112093d574a472749f0f847ef3"
HOOK_ADDRESS = 0x8039A688
HOOK_FILE_OFFSET = 0x33A388
HOOK_EXPECTED_BYTES = bytes.fromhex("48170c5d")
HOOK_REPLACEMENT_BYTES = bytes.fromhex("4bc68379")
DOL_SECTION_OFFSET_FIELD = 0x3C
DOL_SECTION_ADDRESS_FIELD = 0x84
DOL_SECTION_SIZE_FIELD = 0xCC


def sha256(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def run(command: list[str]) -> str:
    completed = subprocess.run(
        command,
        check=False,
        capture_output=True,
        text=True,
    )
    if completed.returncode != 0:
        detail = (completed.stderr or completed.stdout).strip()
        raise SystemExit(f"Command failed ({' '.join(command)}): {detail}")
    return completed.stdout


def require_toolchain(clang: Path, lld: Path, llvm_bin: Path) -> None:
    versions = (
        run([str(clang), "--version"]),
        run([str(lld), "--version"]),
        run([str(llvm_bin / "llvm-objcopy"), "--version"]),
    )
    if any("22.1.8" not in version for version in versions):
        raise SystemExit("The reviewed bridge toolchain is LLVM/Clang/LLD 22.1.8")


def build_code(source_root: Path, llvm_bin: Path, lld: Path) -> bytes:
    clang = llvm_bin / "clang"
    require_toolchain(clang, lld, llvm_bin)
    bridge_source = source_root / "bridge/bridge_v1.c"
    trampoline_source = source_root / "bridge/trampoline_v1.S"
    linker_script = source_root / "bridge/bridge_v1.ld"
    with tempfile.TemporaryDirectory(prefix="starworks-bridge-") as temporary:
        build_root = Path(temporary)
        bridge_object = build_root / "bridge_v1.o"
        trampoline_object = build_root / "trampoline_v1.o"
        bridge_elf = build_root / "bridge_v1.elf"
        code_binary = build_root / "bridge-code-v1.bin"
        target = "--target=powerpc-unknown-eabi"
        run(
            [
                str(clang),
                target,
                "-mcpu=750",
                "-O2",
                "-ffreestanding",
                "-fno-stack-protector",
                "-fno-builtin",
                "-c",
                str(bridge_source),
                "-o",
                str(bridge_object),
            ]
        )
        run(
            [
                str(clang),
                target,
                "-mcpu=750",
                "-c",
                str(trampoline_source),
                "-o",
                str(trampoline_object),
            ]
        )
        run(
            [
                str(lld),
                "-m",
                "elf32ppc",
                "-T",
                str(linker_script),
                str(trampoline_object),
                str(bridge_object),
                "-o",
                str(bridge_elf),
            ]
        )
        symbols = run(
            [
                str(llvm_bin / "llvm-nm"),
                "--print-size",
                "--numeric-sort",
                str(bridge_elf),
            ]
        )
        expected_symbols = (
            "80002a00 00000024 T StarworksMainLoopHook",
            "80002a24 000001e0 T StarworksBridgeTick",
            "8050b2e4 00000000 A StarworksOriginalMainLoopCall",
        )
        if tuple(symbols.strip().splitlines()) != expected_symbols:
            raise SystemExit(f"Bridge symbols differ from review:\n{symbols}")
        run(
            [
                str(llvm_bin / "llvm-objcopy"),
                "--only-section=.text",
                "-O",
                "binary",
                str(bridge_elf),
                str(code_binary),
            ]
        )
        code = code_binary.read_bytes()
    if sha256(code) != BRIDGE_CODE_SHA256:
        raise SystemExit("Compiled bridge code differs from the reviewed binary")
    if BRIDGE_CODE_OFFSET + len(code) > BRIDGE_REGION_SIZE:
        raise SystemExit("Compiled bridge does not fit its reviewed DOL section")
    return code


def require_reviewed_base(base_dol: Path) -> bytes:
    value = base_dol.read_bytes()
    if len(value) != BASE_DOL_SIZE or sha256(value) != BASE_DOL_SHA256:
        raise SystemExit("main.dol is not the reviewed RMBE01 Rev 0 base")
    guarded_values = (
        (DOL_SECTION_OFFSET_FIELD, bytes(4)),
        (DOL_SECTION_ADDRESS_FIELD, bytes(4)),
        (DOL_SECTION_SIZE_FIELD, bytes(4)),
        (HOOK_FILE_OFFSET, HOOK_EXPECTED_BYTES),
    )
    for offset, expected in guarded_values:
        if value[offset : offset + len(expected)] != expected:
            raise SystemExit(f"Reviewed byte guard failed at main.dol+0x{offset:X}")
    return value


def package(base_dol: bytes, code: bytes) -> tuple[bytes, dict[str, object]]:
    section = bytearray(BRIDGE_REGION_SIZE)
    section[BRIDGE_CODE_OFFSET : BRIDGE_CODE_OFFSET + len(code)] = code
    artifact = bytes(section) + b"".join(
        (
            HOOK_REPLACEMENT_BYTES,
            BASE_DOL_SIZE.to_bytes(4, "big"),
            BRIDGE_REGION_ADDRESS.to_bytes(4, "big"),
            BRIDGE_REGION_SIZE.to_bytes(4, "big"),
        )
    )
    output = bytearray(base_dol)
    output[DOL_SECTION_OFFSET_FIELD : DOL_SECTION_OFFSET_FIELD + 4] = artifact[
        0x1704:0x1708
    ]
    output[DOL_SECTION_ADDRESS_FIELD : DOL_SECTION_ADDRESS_FIELD + 4] = artifact[
        0x1708:0x170C
    ]
    output[DOL_SECTION_SIZE_FIELD : DOL_SECTION_SIZE_FIELD + 4] = artifact[
        0x170C:0x1710
    ]
    output[HOOK_FILE_OFFSET : HOOK_FILE_OFFSET + 4] = artifact[0x1700:0x1704]
    output.extend(artifact[:BRIDGE_REGION_SIZE])
    plan: dict[str, object] = {
        "schemaVersion": 2,
        "kind": "precompiled-patch-plan",
        "patchId": "starworks-bridge-v1-rmbe01-rev0",
        "targetPath": "sys/main.dol",
        "expectedInputSha256": BASE_DOL_SHA256,
        "expectedOutputSha256": sha256(output),
        "artifact": {
            "path": "artifacts/bridge-v1-rmbe01.bin",
            "sha256": sha256(artifact),
            "sizeBytes": len(artifact),
        },
        "append": {
            "targetOffset": BASE_DOL_SIZE,
            "artifactOffset": 0,
            "sizeBytes": BRIDGE_REGION_SIZE,
        },
        "writes": [
            {
                "targetOffset": DOL_SECTION_OFFSET_FIELD,
                "artifactOffset": 0x1704,
                "sizeBytes": 4,
                "expectedBytesHex": "00000000",
            },
            {
                "targetOffset": DOL_SECTION_ADDRESS_FIELD,
                "artifactOffset": 0x1708,
                "sizeBytes": 4,
                "expectedBytesHex": "00000000",
            },
            {
                "targetOffset": DOL_SECTION_SIZE_FIELD,
                "artifactOffset": 0x170C,
                "sizeBytes": 4,
                "expectedBytesHex": "00000000",
            },
            {
                "targetOffset": HOOK_FILE_OFFSET,
                "artifactOffset": 0x1700,
                "sizeBytes": 4,
                "expectedBytesHex": HOOK_EXPECTED_BYTES.hex(),
            },
        ],
    }
    return artifact, plan


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-dol", type=Path, required=True)
    parser.add_argument("--output-root", type=Path, required=True)
    parser.add_argument(
        "--llvm-bin", type=Path, default=Path("/opt/homebrew/opt/llvm/bin")
    )
    parser.add_argument("--lld", type=Path, default=Path("/opt/homebrew/bin/ld.lld"))
    arguments = parser.parse_args()
    source_root = Path(__file__).resolve().parents[1] / (
        "src/starworks_runner/games/sluggers"
    )
    base_dol = require_reviewed_base(arguments.base_dol.expanduser().resolve())
    code = build_code(source_root, arguments.llvm_bin.resolve(), arguments.lld)
    artifact, plan = package(base_dol, code)
    output_root = arguments.output_root.resolve()
    artifact_path = output_root / "artifacts/bridge-v1-rmbe01.bin"
    plan_path = output_root / "patches/bridge-v1-rmbe01.json"
    artifact_path.parent.mkdir(parents=True, exist_ok=True)
    plan_path.parent.mkdir(parents=True, exist_ok=True)
    artifact_path.write_bytes(artifact)
    plan_path.write_text(
        json.dumps(plan, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )
    print(
        json.dumps(
            {
                "artifact": str(artifact_path),
                "artifactSha256": sha256(artifact),
                "outputDolSha256": plan["expectedOutputSha256"],
                "patchPlan": str(plan_path),
            },
            sort_keys=True,
        )
    )


if __name__ == "__main__":
    main()
