from __future__ import annotations

import json
import platform
import sys
import zipfile
from dataclasses import asdict
from datetime import UTC, datetime
from importlib.metadata import PackageNotFoundError, version
from pathlib import Path
from typing import Any

from starworks_runner.diagnostics import inspect_local_prerequisites
from starworks_runner.state import RunnerStateStore


class SupportBundleError(RuntimeError):
    pass


def create_support_bundle(
    output: Path,
    *,
    state_path: Path,
    game_image: Path | None = None,
    dolphin_executable: Path | None = None,
    dtk_executable: Path | None = None,
    now: datetime | None = None,
) -> Path:
    """Create a deliberately small diagnostic archive with no secrets or game data."""
    destination = output.expanduser().resolve()
    if destination.exists():
        raise SupportBundleError(f"Refusing to overwrite existing file: {destination}")
    destination.parent.mkdir(parents=True, exist_ok=True)
    created_at = (now or datetime.now(UTC)).astimezone(UTC)
    try:
        runner_version = version("starworks-runner")
    except PackageNotFoundError:
        runner_version = "0.1.0"

    checks = inspect_local_prerequisites(
        game_image=game_image,
        dolphin_executable=dolphin_executable,
        dtk_executable=dtk_executable,
    )
    diagnostics = {
        "runnerVersion": runner_version,
        "pythonVersion": platform.python_version(),
        "platform": {
            "architecture": platform.machine(),
            "operatingSystem": platform.system(),
            "release": platform.release(),
        },
        "prerequisites": [
            {
                "key": check.key,
                "label": check.label,
                "status": check.status,
                "detail": (
                    check.detail
                    if check.key in {"platform", "dolphin-memory-engine"}
                    else "Configured file is readable"
                    if check.status == "ready"
                    else "Configured file is unavailable"
                    if check.status == "missing"
                    else "Not configured"
                ),
            }
            for check in checks
        ],
    }
    state = _support_state(state_path)
    manifest = {
        "schemaVersion": 1,
        "kind": "starworks-runner-support-bundle",
        "createdAt": created_at.isoformat().replace("+00:00", "Z"),
        "privacy": {
            "containsCredential": False,
            "containsGameData": False,
            "containsRtmpSecret": False,
            "operatorCreated": True,
        },
        "files": ["diagnostics.json", "state-summary.json"],
    }
    try:
        with zipfile.ZipFile(
            destination, "x", compression=zipfile.ZIP_DEFLATED
        ) as archive:
            _write_json(archive, "manifest.json", manifest)
            _write_json(archive, "diagnostics.json", diagnostics)
            _write_json(archive, "state-summary.json", state)
    except OSError as error:
        destination.unlink(missing_ok=True)
        raise SupportBundleError(f"Unable to create support bundle: {error}") from error
    return destination


def _support_state(state_path: Path) -> dict[str, Any]:
    if not state_path.expanduser().exists():
        return {
            "stateDatabasePresent": False,
            "registration": None,
            "activeRun": None,
            "pendingLifecycleActions": [],
            "pendingTelemetryCount": 0,
        }
    with RunnerStateStore(state_path) as state:
        registration = state.load_registration()
        active = state.load_active_run()
        pending_updates = state.list_pending_updates()
        pending_telemetry = (
            state.list_pending_telemetry(active.envelope["attemptId"]) if active else []
        )
    registration_value = asdict(registration) if registration else None
    active_value = (
        {
            "attemptId": active.envelope["attemptId"],
            "stage": active.stage,
            "lastCapturedSequence": active.last_captured_sequence,
            "pendingOutcome": active.pending_outcome,
        }
        if active
        else None
    )
    return {
        "stateDatabasePresent": True,
        "registration": registration_value,
        "activeRun": active_value,
        "pendingLifecycleActions": [item.message["action"] for item in pending_updates],
        "pendingTelemetryCount": len(pending_telemetry),
    }


def _write_json(archive: zipfile.ZipFile, name: str, value: object) -> None:
    archive.writestr(
        name,
        json.dumps(value, indent=2, sort_keys=True, ensure_ascii=True) + "\n",
    )


assert sys.version_info >= (3, 12)
