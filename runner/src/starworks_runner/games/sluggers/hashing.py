from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any


def sha256_file(path: Path, *, chunk_size: int = 1024 * 1024) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        while chunk := source.read(chunk_size):
            digest.update(chunk)
    return digest.hexdigest()


def canonical_json_bytes(value: Any) -> bytes:
    return json.dumps(
        value,
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
    ).encode("utf-8")


def sha256_json(value: Any) -> str:
    return hashlib.sha256(canonical_json_bytes(value)).hexdigest()


def sha256_tree(root: Path) -> str:
    entries: list[dict[str, Any]] = []
    for path in sorted(
        root.rglob("*"), key=lambda item: item.relative_to(root).as_posix()
    ):
        relative_path = path.relative_to(root).as_posix()
        if path.is_symlink():
            raise ValueError(
                f"Managed game trees may not contain symlinks: {relative_path}"
            )
        if path.is_dir():
            continue
        if not path.is_file():
            raise ValueError(
                f"Managed game trees may contain only regular files: {relative_path}"
            )
        entries.append(
            {
                "path": relative_path,
                "sha256": sha256_file(path),
                "sizeBytes": path.stat().st_size,
            }
        )
    return sha256_json(entries)


def write_json(path: Path, value: Any) -> None:
    path.write_text(
        f"{json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True)}\n",
        encoding="utf-8",
    )
