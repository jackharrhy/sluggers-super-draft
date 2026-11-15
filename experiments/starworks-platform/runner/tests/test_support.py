from __future__ import annotations

import json
import zipfile
from datetime import UTC, datetime
from pathlib import Path

import pytest
from starworks_runner.state import RunnerStateStore, StationRegistration
from starworks_runner.support import SupportBundleError, create_support_bundle


def test_support_bundle_is_explicit_small_and_redacted(tmp_path: Path) -> None:
    secret = "starworks_runner_secret-that-must-never-appear"
    rtmp = "rtmp://stream.example/live/private-key"
    state_path = tmp_path / "runner.sqlite3"
    game = tmp_path / f"user-owned-{secret}.rvz"
    game.write_bytes(b"copyrighted-game-placeholder")
    with RunnerStateStore(state_path) as state:
        state.save_registration(
            StationRegistration(
                "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
                15,
                60,
                "update-available",
                "0.1.0",
                "0.2.0",
            )
        )

    output = create_support_bundle(
        tmp_path / "support.zip",
        state_path=state_path,
        game_image=game,
        now=datetime(2026, 8, 10, 12, 0, tzinfo=UTC),
    )
    with zipfile.ZipFile(output) as archive:
        assert sorted(archive.namelist()) == [
            "diagnostics.json",
            "manifest.json",
            "state-summary.json",
        ]
        combined = b"\n".join(archive.read(name) for name in archive.namelist())
        manifest = json.loads(archive.read("manifest.json"))
        state = json.loads(archive.read("state-summary.json"))
    assert secret.encode() not in combined
    assert rtmp.encode() not in combined
    assert game.read_bytes() not in combined
    assert str(tmp_path).encode() not in combined
    assert manifest["privacy"] == {
        "containsCredential": False,
        "containsGameData": False,
        "containsRtmpSecret": False,
        "operatorCreated": True,
    }
    assert state["registration"]["version_status"] == "update-available"


def test_support_bundle_refuses_to_overwrite(tmp_path: Path) -> None:
    output = tmp_path / "support.zip"
    output.write_text("keep", encoding="utf-8")
    with pytest.raises(SupportBundleError, match="Refusing to overwrite"):
        create_support_bundle(output, state_path=tmp_path / "missing.sqlite3")
    assert output.read_text(encoding="utf-8") == "keep"
