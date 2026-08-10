from __future__ import annotations

from pathlib import Path

from starworks_runner.diagnostics import inspect_local_prerequisites


def test_prerequisite_report_distinguishes_ready_missing_and_unconfigured(
    tmp_path: Path,
) -> None:
    dolphin = tmp_path / "Dolphin"
    dolphin.write_text("test", encoding="utf-8")

    checks = inspect_local_prerequisites(
        game_image=None,
        dolphin_executable=dolphin,
        dtk_executable=tmp_path / "missing-dtk",
    )
    statuses = {check.key: check.status for check in checks}

    assert statuses["game-image"] == "not-configured"
    assert statuses["dolphin"] == "ready"
    assert statuses["dtk"] == "missing"
    assert statuses["platform"] == "ready"
