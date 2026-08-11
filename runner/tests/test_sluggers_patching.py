from __future__ import annotations

import hashlib
import json
from pathlib import Path, PurePosixPath

import pytest
from starworks_runner.games.sluggers.adapter import AdapterManifest
from starworks_runner.games.sluggers.errors import BuildIntegrityError
from starworks_runner.games.sluggers.patching import (
    ArtifactAppend,
    GuardedWrite,
    PrecompiledPatchApplier,
    PrecompiledPatchPlan,
    PrecompiledPatchSetApplier,
    encode_ppc_branch,
)


def sha256(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def create_plan(
    root: Path,
    *,
    source_bytes: bytes,
    expected_bytes: bytes,
    artifact_bytes: bytes,
    target_offset: int = 0x100,
    writes: list[dict[str, object]] | None = None,
) -> tuple[Path, Path, bytes]:
    source = root / "main.dol"
    artifact_directory = root / "artifacts"
    artifact_directory.mkdir()
    artifact = artifact_directory / "bridge-v1.bin"
    source.write_bytes(source_bytes)
    artifact.write_bytes(artifact_bytes)
    output = bytearray(source_bytes)
    output[target_offset : target_offset + len(artifact_bytes)] = artifact_bytes
    configured_writes = writes or [
        {
            "targetOffset": target_offset,
            "artifactOffset": 0,
            "sizeBytes": len(artifact_bytes),
            "expectedBytesHex": expected_bytes.hex(),
        }
    ]
    plan_value = {
        "schemaVersion": 1,
        "kind": "precompiled-patch-plan",
        "patchId": "synthetic-clean-room-hook-v1",
        "targetPath": "sys/main.dol",
        "expectedInputSha256": sha256(source_bytes),
        "expectedOutputSha256": sha256(output),
        "artifact": {
            "path": "bridge-v1.bin",
            "sha256": sha256(artifact_bytes),
            "sizeBytes": len(artifact_bytes),
        },
        "writes": configured_writes,
    }
    plan_path = root / "patch-plan.json"
    plan_path.write_text(json.dumps(plan_value), encoding="utf-8")
    return source, plan_path, bytes(output)


def test_guarded_precompiled_patch_is_atomic_and_source_preserving(
    tmp_path: Path,
) -> None:
    original_instruction = bytes.fromhex("7c0802a6")
    source_bytes = bytearray(2 * 1024 * 1024)
    source_bytes[0x100:0x104] = original_instruction
    artifact = encode_ppc_branch(0x80004100, 0x807A5000)
    source, plan_path, expected_output = create_plan(
        tmp_path,
        source_bytes=bytes(source_bytes),
        expected_bytes=original_instruction,
        artifact_bytes=artifact,
    )
    destination = tmp_path / "build/main.dol"

    receipt = PrecompiledPatchApplier().apply(
        source=source,
        destination=destination,
        artifact_root=tmp_path / "artifacts",
        plan=PrecompiledPatchPlan.load(plan_path),
    )

    assert source.read_bytes() == bytes(source_bytes)
    assert destination.read_bytes() == expected_output
    assert receipt["patchId"] == "synthetic-clean-room-hook-v1"
    assert receipt["expectedInputSha256"] == sha256(source_bytes)
    assert receipt["outputSha256"] == sha256(expected_output)
    assert not list(destination.parent.glob("*.patching"))


def test_modified_hook_site_fails_its_exact_byte_guard(tmp_path: Path) -> None:
    modified_source = bytearray(1024)
    modified_source[0x100:0x104] = bytes.fromhex("60000000")
    source, plan_path, _ = create_plan(
        tmp_path,
        source_bytes=bytes(modified_source),
        expected_bytes=bytes.fromhex("7c0802a6"),
        artifact_bytes=encode_ppc_branch(0x80004100, 0x807A5000),
    )

    with pytest.raises(BuildIntegrityError, match="expected-byte guard failed"):
        PrecompiledPatchApplier().apply(
            source=source,
            destination=tmp_path / "out/main.dol",
            artifact_root=tmp_path / "artifacts",
            plan=PrecompiledPatchPlan.load(plan_path),
        )
    assert not (tmp_path / "out/main.dol").exists()


def test_modified_artifact_and_in_place_patch_fail_closed(tmp_path: Path) -> None:
    source_bytes = bytes(1024)
    source, plan_path, _ = create_plan(
        tmp_path,
        source_bytes=source_bytes,
        expected_bytes=bytes(4),
        artifact_bytes=b"ABCD",
    )
    plan = PrecompiledPatchPlan.load(plan_path)
    (tmp_path / "artifacts/bridge-v1.bin").write_bytes(b"WXYZ")

    with pytest.raises(BuildIntegrityError, match="artifact hash or size"):
        PrecompiledPatchApplier().apply(
            source=source,
            destination=tmp_path / "out/main.dol",
            artifact_root=tmp_path / "artifacts",
            plan=plan,
        )
    with pytest.raises(BuildIntegrityError, match="must be different"):
        PrecompiledPatchApplier().apply(
            source=source,
            destination=source,
            artifact_root=tmp_path / "artifacts",
            plan=plan,
        )


def test_overlapping_patch_writes_and_invalid_branches_are_rejected(
    tmp_path: Path,
) -> None:
    writes = [
        {
            "targetOffset": 0x100,
            "artifactOffset": 0,
            "sizeBytes": 4,
            "expectedBytesHex": "00000000",
        },
        {
            "targetOffset": 0x102,
            "artifactOffset": 4,
            "sizeBytes": 4,
            "expectedBytesHex": "00000000",
        },
    ]
    _, plan_path, _ = create_plan(
        tmp_path,
        source_bytes=bytes(1024),
        expected_bytes=bytes(4),
        artifact_bytes=bytes(8),
        writes=writes,
    )
    with pytest.raises(BuildIntegrityError, match="overlap in the target"):
        PrecompiledPatchPlan.load(plan_path)
    with pytest.raises(BuildIntegrityError, match="word aligned"):
        encode_ppc_branch(0x80000001, 0x80001000)
    with pytest.raises(BuildIntegrityError, match="outside the relative branch range"):
        encode_ppc_branch(0x80000000, 0x84000000)


def test_schema_v2_appends_a_reviewed_artifact_slice_at_exact_eof(
    tmp_path: Path,
) -> None:
    source_bytes = bytes.fromhex("0000000011223344")
    artifact_bytes = b"TAIL" + b"PATCHED"
    artifact_directory = tmp_path / "artifacts"
    artifact_directory.mkdir()
    (artifact_directory / "append.bin").write_bytes(artifact_bytes)
    output = bytearray(source_bytes)
    output[0:4] = b"TAIL"
    output.extend(b"PATCHED")
    plan_value = {
        "schemaVersion": 2,
        "kind": "precompiled-patch-plan",
        "patchId": "append-v2",
        "targetPath": "sys/main.dol",
        "expectedInputSha256": sha256(source_bytes),
        "expectedOutputSha256": sha256(output),
        "artifact": {
            "path": "append.bin",
            "sha256": sha256(artifact_bytes),
            "sizeBytes": len(artifact_bytes),
        },
        "append": {
            "targetOffset": len(source_bytes),
            "artifactOffset": 4,
            "sizeBytes": 7,
        },
        "writes": [
            {
                "targetOffset": 0,
                "artifactOffset": 0,
                "sizeBytes": 4,
                "expectedBytesHex": "00000000",
            }
        ],
    }
    plan_path = tmp_path / "append-plan.json"
    plan_path.write_text(json.dumps(plan_value), encoding="utf-8")

    plan = PrecompiledPatchPlan.load(plan_path)

    assert plan.append == ArtifactAppend(len(source_bytes), 4, 7)
    assert plan.apply_to_bytes(source_bytes, artifact_directory) == bytes(output)


def test_schema_v2_append_must_start_at_eof(tmp_path: Path) -> None:
    source_bytes = bytes(8)
    artifact_bytes = b"ABCDWXYZ"
    artifacts = tmp_path / "artifacts"
    artifacts.mkdir()
    (artifacts / "append.bin").write_bytes(artifact_bytes)
    plan = PrecompiledPatchPlan(
        patch_id="bad-append",
        target_path=PurePosixPath("sys/main.dol"),
        expected_input_sha256=sha256(source_bytes),
        expected_output_sha256="0" * 64,
        artifact_path=PurePosixPath("append.bin"),
        artifact_sha256=sha256(artifact_bytes),
        artifact_size_bytes=len(artifact_bytes),
        writes=(GuardedWrite(0, 0, 4, bytes(4)),),
        append=ArtifactAppend(7, 4, 4),
    )

    with pytest.raises(BuildIntegrityError, match="does not start at the target EOF"):
        plan.apply_to_bytes(source_bytes, artifacts)


def test_adapter_manifest_exports_source_protocol_memory_and_release_gates() -> None:
    manifest = AdapterManifest.load()
    assert manifest.adapter_version == "0.3.3"
    assert manifest.protocol_version == 1
    assert manifest.bridge_source.name == "bridge_v1.c"
    assert len(manifest.artifacts) == 1
    assert len(manifest.patch_plans) == 1
    assert len(manifest.trusted_patch_set().plans) == 1
    assert manifest.static_target_catalog.name == "static_targets.v1.json"
    assert any(
        "Live Dolphin 2606 acceptance" in gate for gate in manifest.release_gates
    )
    assert any(
        "server-published stat profile" in gate
        for gate in manifest.release_gates
    )


def test_patch_set_rejects_cross_plan_conflicts_before_touching_the_tree(
    tmp_path: Path,
) -> None:
    game_root = tmp_path / "game"
    (game_root / "sys").mkdir(parents=True)
    target = game_root / "sys/main.dol"
    original = bytes(32)
    target.write_bytes(original)
    artifacts = tmp_path / "artifacts"
    artifacts.mkdir()
    (artifacts / "first.bin").write_bytes(b"AAAA")
    (artifacts / "second.bin").write_bytes(b"BBBB")
    plans = (
        PrecompiledPatchPlan(
            patch_id="first",
            target_path=PurePosixPath("sys/main.dol"),
            expected_input_sha256=sha256(original),
            expected_output_sha256="1" * 64,
            artifact_path=PurePosixPath("first.bin"),
            artifact_sha256=sha256(b"AAAA"),
            artifact_size_bytes=4,
            writes=(GuardedWrite(4, 0, 4, bytes(4)),),
        ),
        PrecompiledPatchPlan(
            patch_id="second",
            target_path=PurePosixPath("sys/main.dol"),
            expected_input_sha256=sha256(original),
            expected_output_sha256="2" * 64,
            artifact_path=PurePosixPath("second.bin"),
            artifact_sha256=sha256(b"BBBB"),
            artifact_size_bytes=4,
            writes=(GuardedWrite(6, 0, 4, bytes(4)),),
        ),
    )

    with pytest.raises(BuildIntegrityError, match="Trusted patch writes conflict"):
        PrecompiledPatchSetApplier(artifacts, plans).apply(game_root)

    assert target.read_bytes() == original
