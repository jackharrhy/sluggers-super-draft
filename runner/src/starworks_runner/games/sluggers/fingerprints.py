from __future__ import annotations

import json
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

from starworks_runner.games.sluggers.errors import DiscImageError, UnsupportedBaseError
from starworks_runner.games.sluggers.hashing import sha256_file


@dataclass(frozen=True)
class FileFingerprint:
    path: str
    sha256: str
    size_bytes: int

    def manifest_value(self) -> dict[str, Any]:
        return {
            "path": self.path,
            "sha256": self.sha256,
            "sizeBytes": self.size_bytes,
        }


@dataclass(frozen=True)
class BaseFingerprint:
    game_id: str
    region: str
    revision: int
    disc_header_sha256: str
    main_dol_sha256: str
    data_archive_sha256: str
    fst_sha256: str

    def manifest_value(self) -> dict[str, Any]:
        return {
            "gameId": self.game_id,
            "region": self.region,
            "revision": self.revision,
            "discHeaderSha256": self.disc_header_sha256,
            "mainDolSha256": self.main_dol_sha256,
            "dataArchiveSha256": self.data_archive_sha256,
            "fstSha256": self.fst_sha256,
        }


@dataclass(frozen=True)
class SupportedBase:
    name: str
    fingerprint: BaseFingerprint


REQUIRED_FILES = (
    "disc/header.bin",
    "sys/main.dol",
    "files/dt_na.dat",
    "sys/fst.bin",
)


def fingerprint_file(root: Path, relative_path: str) -> FileFingerprint:
    path = root / relative_path
    if not path.is_file():
        raise DiscImageError(
            f"Extracted data partition is missing required file {relative_path}"
        )
    return FileFingerprint(
        path=relative_path,
        sha256=sha256_file(path),
        size_bytes=path.stat().st_size,
    )


def fingerprint_extraction(
    root: Path, *, expected_game_id: str, expected_revision: int
) -> tuple[BaseFingerprint, tuple[FileFingerprint, ...]]:
    files = tuple(fingerprint_file(root, path) for path in REQUIRED_FILES)
    by_path = {item.path: item for item in files}

    header_path = root / "disc/header.bin"
    with header_path.open("rb") as header_file:
        header = header_file.read(8)
    if len(header) != 8:
        raise DiscImageError("Extracted disc header is shorter than eight bytes")
    try:
        header_game_id = header[:6].decode("ascii")
    except UnicodeDecodeError as error:
        raise DiscImageError("Extracted disc header has a non-ASCII Game ID") from error
    header_revision = header[7]
    if (header_game_id, header_revision) != (expected_game_id, expected_revision):
        raise DiscImageError(
            "Extracted disc header does not match decomp-toolkit metadata: "
            f"expected {expected_game_id} Rev {expected_revision}, "
            f"got {header_game_id} Rev {header_revision}"
        )

    fingerprint = BaseFingerprint(
        game_id=header_game_id,
        region="NTSC-U",
        revision=header_revision,
        disc_header_sha256=by_path["disc/header.bin"].sha256,
        main_dol_sha256=by_path["sys/main.dol"].sha256,
        data_archive_sha256=by_path["files/dt_na.dat"].sha256,
        fst_sha256=by_path["sys/fst.bin"].sha256,
    )
    return fingerprint, files


class SupportedBaseRegistry:
    def __init__(
        self,
        entries: tuple[SupportedBase, ...],
        *,
        provisioning_note: str = "",
    ) -> None:
        self.entries = entries
        self.provisioning_note = provisioning_note

    @classmethod
    def load(cls, path: Path | None = None) -> SupportedBaseRegistry:
        registry_path = path or Path(__file__).with_name("supported_bases.v1.json")
        raw = json.loads(registry_path.read_text(encoding="utf-8"))
        if raw.get("schemaVersion") != 1:
            raise UnsupportedBaseError("Unsupported base-fingerprint registry version")
        if raw.get("gameId") != "RMBE01" or raw.get("region") != "NTSC-U":
            raise UnsupportedBaseError("Base registry targets the wrong game or region")
        entries = tuple(
            SupportedBase(
                name=item["name"],
                fingerprint=BaseFingerprint(
                    game_id=raw["gameId"],
                    region=raw["region"],
                    revision=item["revision"],
                    disc_header_sha256=item["discHeaderSha256"],
                    main_dol_sha256=item["mainDolSha256"],
                    data_archive_sha256=item["dataArchiveSha256"],
                    fst_sha256=item["fstSha256"],
                ),
            )
            for item in raw["revisions"]
        )
        return cls(entries, provisioning_note=raw.get("provisioningNote", ""))

    def require_supported(self, actual: BaseFingerprint) -> SupportedBase:
        for entry in self.entries:
            if entry.fingerprint == actual:
                return entry
        if not self.entries:
            detail = (
                self.provisioning_note or "No reviewed production fingerprint exists"
            )
            raise UnsupportedBaseError(
                "The RMBE01 supported-base registry is not provisioned yet. " + detail
            )

        same_revision = [
            entry
            for entry in self.entries
            if entry.fingerprint.game_id == actual.game_id
            and entry.fingerprint.revision == actual.revision
        ]
        if same_revision:
            expected = same_revision[0].fingerprint
            mismatches = [
                field
                for field in (
                    "disc_header_sha256",
                    "main_dol_sha256",
                    "data_archive_sha256",
                    "fst_sha256",
                )
                if getattr(expected, field) != getattr(actual, field)
            ]
            raise UnsupportedBaseError(
                "The selected RMBE01 base has modified or unknown files: "
                + ", ".join(mismatches)
            )
        raise UnsupportedBaseError(
            f"Unsupported game base {actual.game_id} Rev {actual.revision}; "
            "Starworks currently accepts only reviewed registry entries"
        )

    def to_diagnostic(self) -> dict[str, Any]:
        return {
            "supportedBases": [
                {"name": entry.name, **asdict(entry.fingerprint)}
                for entry in self.entries
            ],
            "provisioningNote": self.provisioning_note,
        }
