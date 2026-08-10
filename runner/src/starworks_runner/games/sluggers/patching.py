from __future__ import annotations

import hashlib
import json
import os
import tempfile
from dataclasses import dataclass
from itertools import pairwise
from pathlib import Path, PurePosixPath

from starworks_runner.games.sluggers.errors import BuildIntegrityError
from starworks_runner.games.sluggers.hashing import sha256_file


def encode_ppc_branch(
    source_address: int, target_address: int, *, link: bool = False
) -> bytes:
    if source_address % 4 or target_address % 4:
        raise BuildIntegrityError("PowerPC branch addresses must be word aligned")
    displacement = target_address - source_address
    if displacement < -0x02000000 or displacement > 0x01FFFFFC:
        raise BuildIntegrityError(
            "PowerPC branch target is outside the relative branch range"
        )
    instruction = 0x48000000 | (displacement & 0x03FFFFFC) | int(link)
    return instruction.to_bytes(4, "big")


def _safe_relative_path(value: str, field_name: str) -> PurePosixPath:
    path = PurePosixPath(value)
    if path.is_absolute() or not path.parts or ".." in path.parts:
        raise BuildIntegrityError(f"{field_name} must be a safe relative path")
    return path


@dataclass(frozen=True)
class GuardedWrite:
    target_offset: int
    artifact_offset: int
    size_bytes: int
    expected_bytes: bytes


@dataclass(frozen=True)
class PrecompiledPatchPlan:
    patch_id: str
    target_path: PurePosixPath
    expected_input_sha256: str
    expected_output_sha256: str
    artifact_path: PurePosixPath
    artifact_sha256: str
    artifact_size_bytes: int
    writes: tuple[GuardedWrite, ...]

    @classmethod
    def load(cls, path: Path) -> PrecompiledPatchPlan:
        try:
            raw = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as error:
            raise BuildIntegrityError(f"Patch plan is unreadable: {path}") from error
        expected_keys = {
            "schemaVersion",
            "kind",
            "patchId",
            "targetPath",
            "expectedInputSha256",
            "expectedOutputSha256",
            "artifact",
            "writes",
        }
        if set(raw) != expected_keys:
            raise BuildIntegrityError("Patch plan has missing or unknown fields")
        if raw["schemaVersion"] != 1 or raw["kind"] != "precompiled-patch-plan":
            raise BuildIntegrityError("Unsupported patch-plan contract")
        artifact = raw["artifact"]
        if set(artifact) != {"path", "sha256", "sizeBytes"}:
            raise BuildIntegrityError("Patch artifact has missing or unknown fields")
        writes: list[GuardedWrite] = []
        for item in raw["writes"]:
            if set(item) != {
                "targetOffset",
                "artifactOffset",
                "sizeBytes",
                "expectedBytesHex",
            }:
                raise BuildIntegrityError("Guarded write has missing or unknown fields")
            try:
                expected_bytes = bytes.fromhex(item["expectedBytesHex"])
            except ValueError as error:
                raise BuildIntegrityError(
                    "Guarded write expected bytes are not hex"
                ) from error
            write = GuardedWrite(
                target_offset=item["targetOffset"],
                artifact_offset=item["artifactOffset"],
                size_bytes=item["sizeBytes"],
                expected_bytes=expected_bytes,
            )
            if (
                write.target_offset < 0
                or write.artifact_offset < 0
                or write.size_bytes <= 0
                or len(write.expected_bytes) != write.size_bytes
            ):
                raise BuildIntegrityError("Guarded write sizes or offsets are invalid")
            writes.append(write)
        plan = cls(
            patch_id=raw["patchId"],
            target_path=_safe_relative_path(raw["targetPath"], "targetPath"),
            expected_input_sha256=raw["expectedInputSha256"],
            expected_output_sha256=raw["expectedOutputSha256"],
            artifact_path=_safe_relative_path(artifact["path"], "artifact.path"),
            artifact_sha256=artifact["sha256"],
            artifact_size_bytes=artifact["sizeBytes"],
            writes=tuple(writes),
        )
        plan.validate()
        return plan

    def validate(self) -> None:
        if not self.patch_id or len(self.patch_id) > 127:
            raise BuildIntegrityError("Patch ID is empty or too long")
        for field_name, digest in (
            ("expectedInputSha256", self.expected_input_sha256),
            ("expectedOutputSha256", self.expected_output_sha256),
            ("artifact.sha256", self.artifact_sha256),
        ):
            if len(digest) != 64 or any(
                character not in "0123456789abcdef" for character in digest
            ):
                raise BuildIntegrityError(f"{field_name} must be lowercase SHA-256 hex")
        if self.artifact_size_bytes <= 0 or not self.writes:
            raise BuildIntegrityError("Patch artifact and writes must be non-empty")
        by_target = sorted(self.writes, key=lambda item: item.target_offset)
        by_artifact = sorted(self.writes, key=lambda item: item.artifact_offset)
        for left, right in pairwise(by_target):
            if left.target_offset + left.size_bytes > right.target_offset:
                raise BuildIntegrityError("Guarded patch writes overlap in the target")
        for left, right in pairwise(by_artifact):
            if left.artifact_offset + left.size_bytes > right.artifact_offset:
                raise BuildIntegrityError(
                    "Guarded patch writes overlap in the artifact"
                )
        for write in self.writes:
            if write.artifact_offset + write.size_bytes > self.artifact_size_bytes:
                raise BuildIntegrityError("Guarded write exceeds the patch artifact")

    def receipt(self) -> dict[str, str]:
        return {
            "patchId": self.patch_id,
            "targetPath": self.target_path.as_posix(),
            "expectedInputSha256": self.expected_input_sha256,
            "outputSha256": self.expected_output_sha256,
        }

    def apply_to_bytes(self, source: bytes, artifact_root: Path) -> bytes:
        input_sha256 = hashlib.sha256(source).hexdigest()
        if input_sha256 != self.expected_input_sha256:
            raise BuildIntegrityError(
                f"Patch {self.patch_id} input hash does not match its reviewed base"
            )
        artifact = self._read_artifact(artifact_root)
        output = bytearray(source)
        for write in self.writes:
            target_end = write.target_offset + write.size_bytes
            if target_end > len(output):
                raise BuildIntegrityError(
                    f"Patch {self.patch_id} write exceeds the target file"
                )
            actual_bytes = bytes(output[write.target_offset : target_end])
            if actual_bytes != write.expected_bytes:
                raise BuildIntegrityError(
                    f"Patch {self.patch_id} expected-byte guard failed at "
                    f"0x{write.target_offset:X}: expected {write.expected_bytes.hex()}, "
                    f"got {actual_bytes.hex()}"
                )
            artifact_end = write.artifact_offset + write.size_bytes
            output[write.target_offset : target_end] = artifact[
                write.artifact_offset : artifact_end
            ]
        actual_output_sha256 = hashlib.sha256(output).hexdigest()
        if actual_output_sha256 != self.expected_output_sha256:
            raise BuildIntegrityError(
                f"Patch {self.patch_id} output hash did not match its reviewed result"
            )
        return bytes(output)

    def _read_artifact(self, artifact_root: Path) -> bytes:
        artifact_root_path = artifact_root.resolve()
        artifact_path = (artifact_root_path / self.artifact_path).resolve()
        try:
            artifact_path.relative_to(artifact_root_path)
        except ValueError as error:
            raise BuildIntegrityError(
                "Patch artifact escapes its trusted root"
            ) from error
        if not artifact_path.is_file():
            raise BuildIntegrityError(f"Patch artifact does not exist: {artifact_path}")
        if (
            artifact_path.stat().st_size != self.artifact_size_bytes
            or sha256_file(artifact_path) != self.artifact_sha256
        ):
            raise BuildIntegrityError(
                f"Patch {self.patch_id} artifact hash or size is invalid"
            )
        return artifact_path.read_bytes()


class PrecompiledPatchApplier:
    """Apply a reviewed artifact to a new file, never to the source in place."""

    def apply(
        self,
        *,
        source: Path,
        destination: Path,
        artifact_root: Path,
        plan: PrecompiledPatchPlan,
    ) -> dict[str, str]:
        source_path = source.resolve()
        destination_path = destination.resolve()
        artifact_root_path = artifact_root.resolve()
        if source_path == destination_path:
            raise BuildIntegrityError(
                "Patch source and destination must be different files"
            )
        if not source_path.is_file():
            raise BuildIntegrityError(f"Patch source does not exist: {source_path}")
        if destination_path.exists():
            raise BuildIntegrityError(
                f"Patch destination already exists: {destination_path}"
            )
        output = plan.apply_to_bytes(source_path.read_bytes(), artifact_root_path)

        destination_path.parent.mkdir(parents=True, exist_ok=True)
        descriptor, temporary_name = tempfile.mkstemp(
            prefix=f".{destination_path.name}.",
            suffix=".patching",
            dir=destination_path.parent,
        )
        temporary_path = Path(temporary_name)
        try:
            with os.fdopen(descriptor, "wb") as file:
                file.write(output)
                file.flush()
                os.fsync(file.fileno())
            os.replace(temporary_path, destination_path)
        finally:
            temporary_path.unlink(missing_ok=True)
        if sha256_file(destination_path) != plan.expected_output_sha256:
            destination_path.unlink(missing_ok=True)
            raise BuildIntegrityError(
                f"Patch {plan.patch_id} promoted output failed final verification"
            )
        return plan.receipt()


class PrecompiledPatchSetApplier:
    """Preflight a trusted patch set completely before changing a fresh build tree."""

    def __init__(self, artifact_root: Path, plans: tuple[PrecompiledPatchPlan, ...]):
        self.artifact_root = artifact_root
        self.plans = plans

    def apply(self, game_root: Path) -> list[dict[str, str]]:
        self._reject_conflicts()
        root = game_root.resolve()
        by_path: dict[PurePosixPath, list[PrecompiledPatchPlan]] = {}
        for plan in self.plans:
            by_path.setdefault(plan.target_path, []).append(plan)
        outputs: dict[Path, bytes] = {}
        receipts: list[dict[str, str]] = []
        for relative_path, plans in by_path.items():
            target = (root / relative_path).resolve()
            try:
                target.relative_to(root)
            except ValueError as error:
                raise BuildIntegrityError(
                    "Patch target escapes the managed game tree"
                ) from error
            if not target.is_file():
                raise BuildIntegrityError(
                    f"Patch target does not exist: {relative_path}"
                )
            output = target.read_bytes()
            for plan in plans:
                output = plan.apply_to_bytes(output, self.artifact_root)
                receipts.append(plan.receipt())
            outputs[target] = output

        for target, output in outputs.items():
            descriptor, temporary_name = tempfile.mkstemp(
                prefix=f".{target.name}.", suffix=".patch-set", dir=target.parent
            )
            temporary_path = Path(temporary_name)
            try:
                with os.fdopen(descriptor, "wb") as file:
                    file.write(output)
                    file.flush()
                    os.fsync(file.fileno())
                os.replace(temporary_path, target)
            finally:
                temporary_path.unlink(missing_ok=True)
        return receipts

    def _reject_conflicts(self) -> None:
        writes = sorted(
            (
                (
                    plan.target_path,
                    write.target_offset,
                    write.target_offset + write.size_bytes,
                    plan.patch_id,
                )
                for plan in self.plans
                for write in plan.writes
            ),
            key=lambda item: (item[0].as_posix(), item[1], item[3]),
        )
        for left, right in pairwise(writes):
            if left[0] == right[0] and left[2] > right[1]:
                raise BuildIntegrityError(
                    f"Trusted patch writes conflict: {left[3]} and {right[3]}"
                )
