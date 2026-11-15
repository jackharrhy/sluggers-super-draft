from __future__ import annotations

import importlib.util
import platform
from dataclasses import dataclass
from pathlib import Path
from typing import Literal


@dataclass(frozen=True)
class PrerequisiteCheck:
    key: str
    label: str
    status: Literal["ready", "missing", "not-configured"]
    detail: str


def inspect_local_prerequisites(
    *,
    game_image: Path | None,
    dolphin_executable: Path | None,
    dtk_executable: Path | None,
) -> tuple[PrerequisiteCheck, ...]:
    checks = [
        _path_check("game-image", "Mario Super Sluggers dump", game_image),
        _path_check("dolphin", "Dolphin", dolphin_executable),
        _path_check("dtk", "decomp-toolkit", dtk_executable),
    ]
    dme_available = importlib.util.find_spec("dolphin_memory_engine") is not None
    checks.append(
        PrerequisiteCheck(
            key="dolphin-memory-engine",
            label="Dolphin Memory Engine",
            status="ready" if dme_available else "missing",
            detail="Python bridge transport installed"
            if dme_available
            else "Reinstall the runner on a supported platform",
        )
    )
    machine = platform.machine() or "unknown"
    checks.append(
        PrerequisiteCheck(
            key="platform",
            label="Native platform",
            status="ready",
            detail=f"{platform.system()} {machine}",
        )
    )
    return tuple(checks)


def _path_check(key: str, label: str, path: Path | None) -> PrerequisiteCheck:
    if path is None:
        return PrerequisiteCheck(
            key=key,
            label=label,
            status="not-configured",
            detail="Not selected",
        )
    resolved = path.expanduser().resolve()
    if not resolved.is_file():
        return PrerequisiteCheck(
            key=key,
            label=label,
            status="missing",
            detail=f"File not found: {resolved}",
        )
    return PrerequisiteCheck(
        key=key,
        label=label,
        status="ready",
        detail=str(resolved),
    )
