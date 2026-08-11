#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import struct
import subprocess
import tempfile
from pathlib import Path

BRIDGE_BASE_ADDRESS = 0x80001900
BRIDGE_ENTRY_ADDRESS = 0x80002700
BRIDGE_REGION_SIZE = 0x1700
MAIN_LOOP_HOOK_ADDRESS = 0x8039A688
TEAM_SELECTION_HOOK_ADDRESS = 0x8006AED4
CPU_CONTROL_HOOK_ADDRESS = 0x80063D4C
DOL_SECTION_FILE_OFFSET = 0x00716F20
BASE_DOL_SHA256 = "3018e262480ccbf0daa04fc96f1c3dfb340dc4007a13f007f9423751c1346151"
MAIN_LOOP_HOOK_FILE_OFFSET = 0x0033A388
TEAM_SELECTION_HOOK_FILE_OFFSET = 0x0000ABD4
CPU_CONTROL_HOOK_FILE_OFFSET = 0x00003A4C
DOL_SECTION_OFFSET_FIELD = 0x3C
DOL_SECTION_ADDRESS_FIELD = 0x84
DOL_SECTION_SIZE_FIELD = 0xCC
EXPECTED_HOOK_BYTES = (
    (MAIN_LOOP_HOOK_FILE_OFFSET, bytes.fromhex("48170c5d"), BRIDGE_REGION_SIZE),
    (
        TEAM_SELECTION_HOOK_FILE_OFFSET,
        bytes.fromhex("38a00000"),
        BRIDGE_REGION_SIZE + 4,
    ),
    (CPU_CONTROL_HOOK_FILE_OFFSET, bytes.fromhex("88080018"), BRIDGE_REGION_SIZE + 8),
)


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Build the reviewed RMBE01 Starworks bridge artifact",
    )
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--base-dol", type=Path)
    parser.add_argument("--patch-plan", type=Path)
    arguments = parser.parse_args()
    if bool(arguments.base_dol) != bool(arguments.patch_plan):
        raise SystemExit("--base-dol and --patch-plan must be provided together")

    package = (
        Path(__file__).resolve().parents[1] / "src/starworks_runner/games/sluggers"
    )
    bridge = package / "bridge"
    clang = require_tool("clang", "/opt/homebrew/opt/llvm/bin/clang")
    linker = require_tool("ld.lld", "/opt/homebrew/bin/ld.lld")
    objcopy = require_tool("llvm-objcopy", "/opt/homebrew/opt/llvm/bin/llvm-objcopy")
    nm = require_tool("llvm-nm", "/opt/homebrew/opt/llvm/bin/llvm-nm")
    common = [
        clang,
        "--target=powerpc-unknown-eabi",
        "-mcpu=750",
        "-m32",
        "-ffreestanding",
        "-fno-builtin",
        "-fno-stack-protector",
        "-fno-exceptions",
        "-Oz",
        "-c",
    ]
    with tempfile.TemporaryDirectory(prefix="starworks-bridge-") as temporary:
        build = Path(temporary)
        trampoline = build / "trampoline.o"
        implementation = build / "bridge.o"
        elf = build / "bridge.elf"
        code_path = build / "bridge.bin"
        run(*common, str(bridge / "trampoline_v1.S"), "-o", str(trampoline))
        run(*common, str(bridge / "bridge_v1.c"), "-o", str(implementation))
        run(
            linker,
            "-T",
            str(bridge / "bridge_v1.ld"),
            "--nostdlib",
            "-o",
            str(elf),
            str(trampoline),
            str(implementation),
        )
        run(objcopy, "-O", "binary", str(elf), str(code_path))
        code = code_path.read_bytes()
        available = BRIDGE_REGION_SIZE - (BRIDGE_ENTRY_ADDRESS - BRIDGE_BASE_ADDRESS)
        if len(code) > available:
            raise SystemExit(
                f"Bridge code is {len(code)} bytes but only {available} are reserved"
            )
        symbols = symbol_addresses(nm, elf)
        if symbols.get("StarworksMainLoopHook") != BRIDGE_ENTRY_ADDRESS:
            raise SystemExit("Main-loop bridge entry moved from its protocol address")
        team_hook = symbols.get("StarworksTeamSelectionHook")
        if team_hook is None:
            raise SystemExit("Team-selection bridge entry is missing")
        cpu_hook = symbols.get("StarworksCpuControlHook")
        if cpu_hook is None:
            raise SystemExit("CPU-control bridge entry is missing")

        artifact = bytearray(BRIDGE_REGION_SIZE)
        code_offset = BRIDGE_ENTRY_ADDRESS - BRIDGE_BASE_ADDRESS
        artifact[code_offset : code_offset + len(code)] = code
        artifact.extend(branch(MAIN_LOOP_HOOK_ADDRESS, BRIDGE_ENTRY_ADDRESS, link=True))
        artifact.extend(branch(TEAM_SELECTION_HOOK_ADDRESS, team_hook, link=False))
        artifact.extend(branch(CPU_CONTROL_HOOK_ADDRESS, cpu_hook, link=False))
        artifact.extend(
            struct.pack(
                ">III",
                DOL_SECTION_FILE_OFFSET,
                BRIDGE_BASE_ADDRESS,
                BRIDGE_REGION_SIZE,
            )
        )

    output = arguments.output.expanduser().resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_bytes(artifact)
    result = {
        "codeSizeBytes": len(code),
        "output": str(output),
        "sha256": hashlib.sha256(artifact).hexdigest(),
        "sizeBytes": len(artifact),
        "teamSelectionEntry": f"0x{team_hook:08X}",
        "cpuControlEntry": f"0x{cpu_hook:08X}",
    }
    if arguments.base_dol and arguments.patch_plan:
        base_dol = arguments.base_dol.expanduser().resolve().read_bytes()
        plan = build_patch_plan(base_dol, bytes(artifact))
        plan_path = arguments.patch_plan.expanduser().resolve()
        plan_path.parent.mkdir(parents=True, exist_ok=True)
        plan_path.write_text(
            json.dumps(plan, indent=2, sort_keys=True) + "\n", encoding="utf-8"
        )
        result["expectedOutputSha256"] = plan["expectedOutputSha256"]
        result["patchPlan"] = str(plan_path)
    print(json.dumps(result, sort_keys=True))
    return 0


def require_tool(name: str, preferred: str) -> str:
    preferred_path = Path(preferred)
    resolved = str(preferred_path) if preferred_path.is_file() else shutil.which(name)
    if not resolved:
        raise SystemExit(f"Required bridge build tool is unavailable: {name}")
    return resolved


def run(*command: str) -> None:
    subprocess.run(command, check=True)


def symbol_addresses(nm: str, elf: Path) -> dict[str, int]:
    completed = subprocess.run(
        [nm, "-P", str(elf)],
        check=True,
        capture_output=True,
        text=True,
    )
    symbols: dict[str, int] = {}
    for line in completed.stdout.splitlines():
        fields = line.split()
        if len(fields) >= 3:
            try:
                symbols[fields[0]] = int(fields[2], 16)
            except ValueError:
                continue
    return symbols


def branch(source: int, target: int, *, link: bool) -> bytes:
    delta = target - source
    if delta % 4 or not -(1 << 25) <= delta < (1 << 25):
        raise SystemExit(
            f"PowerPC branch from 0x{source:08X} to 0x{target:08X} is out of range"
        )
    instruction = 0x48000000 | (delta & 0x03FFFFFC) | int(link)
    return struct.pack(">I", instruction)


def build_patch_plan(base_dol: bytes, artifact: bytes) -> dict[str, object]:
    if len(base_dol) != DOL_SECTION_FILE_OFFSET:
        raise SystemExit("main.dol has the wrong size for the reviewed RMBE01 base")
    if hashlib.sha256(base_dol).hexdigest() != BASE_DOL_SHA256:
        raise SystemExit("main.dol is not the reviewed RMBE01 base")
    guarded = (
        (DOL_SECTION_OFFSET_FIELD, bytes(4)),
        (DOL_SECTION_ADDRESS_FIELD, bytes(4)),
        (DOL_SECTION_SIZE_FIELD, bytes(4)),
        *((offset, expected) for offset, expected, _ in EXPECTED_HOOK_BYTES),
    )
    for offset, expected in guarded:
        if base_dol[offset : offset + len(expected)] != expected:
            raise SystemExit(f"Reviewed byte guard failed at main.dol+0x{offset:X}")

    writes = [
        {
            "targetOffset": DOL_SECTION_OFFSET_FIELD,
            "artifactOffset": BRIDGE_REGION_SIZE + 12,
            "sizeBytes": 4,
            "expectedBytesHex": "00000000",
        },
        {
            "targetOffset": DOL_SECTION_ADDRESS_FIELD,
            "artifactOffset": BRIDGE_REGION_SIZE + 16,
            "sizeBytes": 4,
            "expectedBytesHex": "00000000",
        },
        {
            "targetOffset": DOL_SECTION_SIZE_FIELD,
            "artifactOffset": BRIDGE_REGION_SIZE + 20,
            "sizeBytes": 4,
            "expectedBytesHex": "00000000",
        },
    ]
    output = bytearray(base_dol)
    for target_offset, expected, artifact_offset in EXPECTED_HOOK_BYTES:
        writes.append(
            {
                "targetOffset": target_offset,
                "artifactOffset": artifact_offset,
                "sizeBytes": 4,
                "expectedBytesHex": expected.hex(),
            }
        )
    for write in writes:
        target_offset = int(write["targetOffset"])
        artifact_offset = int(write["artifactOffset"])
        size = int(write["sizeBytes"])
        output[target_offset : target_offset + size] = artifact[
            artifact_offset : artifact_offset + size
        ]
    output.extend(artifact[:BRIDGE_REGION_SIZE])
    return {
        "schemaVersion": 2,
        "kind": "precompiled-patch-plan",
        "patchId": "starworks-bridge-v1-rmbe01-rev0",
        "targetPath": "sys/main.dol",
        "expectedInputSha256": BASE_DOL_SHA256,
        "expectedOutputSha256": hashlib.sha256(output).hexdigest(),
        "artifact": {
            "path": "artifacts/bridge-v1-rmbe01.bin",
            "sha256": hashlib.sha256(artifact).hexdigest(),
            "sizeBytes": len(artifact),
        },
        "append": {
            "targetOffset": DOL_SECTION_FILE_OFFSET,
            "artifactOffset": 0,
            "sizeBytes": BRIDGE_REGION_SIZE,
        },
        "writes": writes,
    }


if __name__ == "__main__":
    raise SystemExit(main())
