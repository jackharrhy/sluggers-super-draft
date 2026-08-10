from __future__ import annotations

import json
import os
import shutil
import tempfile
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from starworks_runner.contracts import validate_contract
from starworks_runner.games.sluggers.content import (
    ContentCompilationPlan,
    ContentPackCompiler,
    ContentPackInput,
)
from starworks_runner.games.sluggers.errors import BuildIntegrityError, DiscImageError
from starworks_runner.games.sluggers.fingerprints import (
    BaseFingerprint,
    FileFingerprint,
    SupportedBaseRegistry,
    fingerprint_extraction,
    fingerprint_file,
)
from starworks_runner.games.sluggers.hashing import (
    canonical_json_bytes,
    sha256_json,
    sha256_tree,
    write_json,
)
from starworks_runner.games.sluggers.patching import PrecompiledPatchSetApplier
from starworks_runner.games.sluggers.tools import DtkDiscTool

EMPTY_CONTENT_PACK_SHA256 = (
    "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
)
OUTPUT_PATHS = ("sys/main.dol", "files/dt_na.dat", "sys/fst.bin")


@dataclass(frozen=True)
class BuildRequest:
    image_path: Path
    cache_root: Path
    content_pack_sha256: str = EMPTY_CONTENT_PACK_SHA256
    content_pack: ContentPackInput | None = None
    adapter_version: str = "0.1.0"
    compiler_version: str = "0.1.0"


@dataclass(frozen=True)
class SourceSnapshot:
    size_bytes: int
    modified_ns: int
    inode: int

    @classmethod
    def capture(cls, path: Path) -> SourceSnapshot:
        metadata = path.stat()
        return cls(
            size_bytes=metadata.st_size,
            modified_ns=metadata.st_mtime_ns,
            inode=metadata.st_ino,
        )

    def report_value(self) -> dict[str, int]:
        return {
            "sizeBytes": self.size_bytes,
            "modifiedNs": self.modified_ns,
            "inode": self.inode,
        }


@dataclass(frozen=True)
class BuildResult:
    build_directory: Path
    game_directory: Path
    manifest: dict[str, Any]
    report: dict[str, Any]
    cache_hit: bool


Clock = Callable[[], datetime]


def _utc_now() -> datetime:
    return datetime.now(UTC)


class GameBuildService:
    """Construct immutable, content-addressed local builds from a user-owned image."""

    def __init__(
        self,
        disc_tool: DtkDiscTool,
        registry: SupportedBaseRegistry,
        *,
        clock: Clock = _utc_now,
        content_compiler: ContentPackCompiler | None = None,
        trusted_patch_set: PrecompiledPatchSetApplier | None = None,
    ) -> None:
        self.disc_tool = disc_tool
        self.registry = registry
        self.clock = clock
        self.content_compiler = content_compiler or ContentPackCompiler()
        self.trusted_patch_set = trusted_patch_set

    def build(self, request: BuildRequest) -> BuildResult:
        image = request.image_path.expanduser().resolve()
        cache_root = request.cache_root.expanduser().resolve()
        if not image.is_file():
            raise DiscImageError(f"Selected game image is not a regular file: {image}")
        if len(request.content_pack_sha256) != 64 or any(
            character not in "0123456789abcdef"
            for character in request.content_pack_sha256
        ):
            raise BuildIntegrityError(
                "content-pack SHA-256 must be 64 lowercase hex digits"
            )
        if (
            request.content_pack is None
            and request.content_pack_sha256 != EMPTY_CONTENT_PACK_SHA256
        ):
            raise BuildIntegrityError(
                "A non-empty content-pack hash requires its validated local inputs"
            )

        cache_root.mkdir(parents=True, exist_ok=True)
        staging_root = cache_root / ".staging"
        builds_root = cache_root / "builds"
        staging_root.mkdir(exist_ok=True)
        builds_root.mkdir(exist_ok=True)

        source_before = SourceSnapshot.capture(image)
        tool_sha256 = self.disc_tool.verify_pinned_binary()
        identity = self.disc_tool.inspect(image)
        if identity.game_id != "RMBE01" or identity.revision != 0:
            raise DiscImageError(
                f"Expected Mario Super Sluggers RMBE01 Rev 0, got "
                f"{identity.game_id} Rev {identity.revision}"
            )
        verification = self.disc_tool.verify_image(image)

        temporary_directory = Path(tempfile.mkdtemp(prefix="build-", dir=staging_root))
        try:
            extracted = temporary_directory / "extracted"
            self.disc_tool.extract(image, extracted)
            base_fingerprint, _ = fingerprint_extraction(
                extracted,
                expected_game_id=identity.game_id,
                expected_revision=identity.revision,
            )
            supported_base = self.registry.require_supported(base_fingerprint)

            content_plan: ContentCompilationPlan | None = None
            content_pack_sha256 = EMPTY_CONTENT_PACK_SHA256
            if request.content_pack is not None:
                content_plan = self.content_compiler.plan(
                    request.content_pack,
                    main_dol_sha256=base_fingerprint.main_dol_sha256,
                )
                content_pack_sha256 = content_plan.content_pack_sha256
                if (
                    request.adapter_version
                    != request.content_pack.manifest["adapterVersion"]
                ):
                    raise BuildIntegrityError(
                        "Build and content pack use different adapter versions"
                    )
                if request.content_pack_sha256 not in (
                    EMPTY_CONTENT_PACK_SHA256,
                    content_pack_sha256,
                ):
                    raise BuildIntegrityError(
                        "Requested content-pack hash does not match its resolved inputs"
                    )

            cache_key = self._cache_key(request, base_fingerprint, content_pack_sha256)
            final_directory = builds_root / cache_key
            artifact = temporary_directory / "artifact"
            game_directory = artifact / "game"
            shutil.copytree(extracted, game_directory, copy_function=shutil.copy2)

            patch_receipts = (
                self.trusted_patch_set.apply(game_directory)
                if self.trusted_patch_set
                else []
            )
            if content_plan:
                patch_receipts.extend(content_plan.apply(game_directory))

            outputs = tuple(
                fingerprint_file(game_directory, path) for path in OUTPUT_PATHS
            )
            try:
                game_tree_sha256 = sha256_tree(game_directory)
            except ValueError as error:
                raise BuildIntegrityError(str(error)) from error
            manifest = self._manifest(
                request,
                base_fingerprint,
                outputs,
                game_tree_sha256,
                content_pack_sha256,
                patch_receipts,
            )
            validate_contract("game-build-manifest", manifest)

            source_after = SourceSnapshot.capture(image)
            if source_after != source_before:
                raise BuildIntegrityError(
                    "The source image changed while Starworks was reading it; build discarded"
                )

            report = {
                "schemaVersion": 1,
                "kind": "game-build-report",
                "generatedAt": self.clock()
                .astimezone(UTC)
                .isoformat()
                .replace("+00:00", "Z"),
                "sourceImageName": image.name,
                "sourceImageBefore": source_before.report_value(),
                "sourceImageAfter": source_after.report_value(),
                "disc": {
                    "gameId": identity.game_id,
                    "revision": identity.revision,
                    "redumpName": verification.redump_name,
                    "supportedBase": supported_base.name,
                },
                "toolchain": {
                    "dtkVersion": self.disc_tool.release.version,
                    "dtkSha256": tool_sha256,
                    "adapterVersion": request.adapter_version,
                    "compilerVersion": request.compiler_version,
                },
                "cacheKeySha256": cache_key,
                "gameBuildSha256": manifest["buildSha256"],
                "sourceMutated": False,
            }
            write_json(artifact / "game-build-manifest.json", manifest)
            write_json(artifact / "build-report.json", report)
            self._fsync_tree_metadata(artifact)

            if final_directory.exists():
                result = self._read_existing(final_directory, manifest)
                shutil.rmtree(temporary_directory)
                return result

            try:
                os.rename(artifact, final_directory)
            except FileExistsError:
                result = self._read_existing(final_directory, manifest)
                shutil.rmtree(temporary_directory)
                return result

            return BuildResult(
                build_directory=final_directory,
                game_directory=final_directory / "game",
                manifest=manifest,
                report=report,
                cache_hit=False,
            )
        finally:
            if temporary_directory.exists():
                shutil.rmtree(temporary_directory)

    @staticmethod
    def _cache_key(
        request: BuildRequest,
        base: BaseFingerprint,
        content_pack_sha256: str,
    ) -> str:
        return sha256_json(
            {
                "baseGame": base.manifest_value(),
                "adapterVersion": request.adapter_version,
                "compilerVersion": request.compiler_version,
                "contentPackSha256": content_pack_sha256,
            }
        )

    @staticmethod
    def _manifest(
        request: BuildRequest,
        base: BaseFingerprint,
        outputs: tuple[FileFingerprint, ...],
        game_tree_sha256: str,
        content_pack_sha256: str,
        patch_receipts: list[dict[str, str]],
    ) -> dict[str, Any]:
        deterministic_receipt = {
            "schemaVersion": 1,
            "kind": "game-build-manifest",
            "baseGame": base.manifest_value(),
            "adapterVersion": request.adapter_version,
            "compilerVersion": request.compiler_version,
            "contentPackSha256": content_pack_sha256,
            "gameTreeSha256": game_tree_sha256,
            "outputs": [output.manifest_value() for output in outputs],
            "patchReceipts": patch_receipts,
            "compatible": True,
            "warnings": GameBuildService._warnings(content_pack_sha256, patch_receipts),
        }
        return {
            **deterministic_receipt,
            "buildSha256": sha256_json(deterministic_receipt),
        }

    @staticmethod
    def _warnings(
        content_pack_sha256: str, patch_receipts: list[dict[str, str]]
    ) -> list[dict[str, str]]:
        if content_pack_sha256 == EMPTY_CONTENT_PACK_SHA256 and not patch_receipts:
            return [
                {
                    "code": "NO_OP_BUILD",
                    "message": "No static content or bridge patch was applied.",
                }
            ]
        if not patch_receipts:
            return [
                {
                    "code": "RUNTIME_ONLY_CONTENT_PACK",
                    "message": "The content pack has no build-time mutations.",
                }
            ]
        return []

    @staticmethod
    def _read_existing(
        final_directory: Path, expected_manifest: dict[str, Any]
    ) -> BuildResult:
        manifest_path = final_directory / "game-build-manifest.json"
        report_path = final_directory / "build-report.json"
        game_directory = final_directory / "game"
        try:
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            report = json.loads(report_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as error:
            raise BuildIntegrityError(
                f"Cached build metadata is unreadable: {final_directory}"
            ) from error
        validate_contract("game-build-manifest", manifest)
        if canonical_json_bytes(manifest) != canonical_json_bytes(expected_manifest):
            raise BuildIntegrityError(
                f"Cached build does not match the deterministic rebuild: {final_directory}"
            )
        for output in manifest["outputs"]:
            actual = fingerprint_file(game_directory, output["path"])
            if (
                actual.sha256 != output["sha256"]
                or actual.size_bytes != output["sizeBytes"]
            ):
                raise BuildIntegrityError(
                    f"Cached output failed verification: {output['path']}"
                )
        try:
            actual_tree_sha256 = sha256_tree(game_directory)
        except ValueError as error:
            raise BuildIntegrityError(str(error)) from error
        if actual_tree_sha256 != manifest["gameTreeSha256"]:
            raise BuildIntegrityError("Cached game tree failed whole-tree verification")
        return BuildResult(
            build_directory=final_directory,
            game_directory=game_directory,
            manifest=manifest,
            report=report,
            cache_hit=True,
        )

    @staticmethod
    def _fsync_tree_metadata(artifact: Path) -> None:
        for file_name in ("game-build-manifest.json", "build-report.json"):
            with (artifact / file_name).open("rb") as file:
                os.fsync(file.fileno())
        directory_descriptor = os.open(artifact, os.O_RDONLY)
        try:
            os.fsync(directory_descriptor)
        finally:
            os.close(directory_descriptor)
