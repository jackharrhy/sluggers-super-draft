from __future__ import annotations

import os
from pathlib import Path

from starworks_runner.games.sluggers.checkpoint import (
    clone_seed_profile,
    seed_profile_sha256,
)


def test_seed_profile_clone_keeps_save_and_discards_runtime_artifacts(
    tmp_path: Path,
) -> None:
    source = tmp_path / "source"
    (source / "Wii/title/RMBE01/data").mkdir(parents=True)
    (source / "Wii/title/RMBE01/data/gamedata").write_bytes(b"unlocked")
    (source / "Config").mkdir()
    (source / "Config/Dolphin.ini").write_text("[Core]\n", encoding="utf-8")
    (source / "Logs").mkdir()
    (source / "Logs/dolphin.log").write_text("volatile", encoding="utf-8")
    (source / "StateSaves").mkdir()
    (source / "StateSaves/RMBE01.s01").write_bytes(b"old")
    (source / "Load").mkdir()
    (source / "Load/WiiSD.raw").write_bytes(b"large and volatile")
    if os.name != "nt":
        os.mkfifo(source / "dead-process-pipe")

    target = clone_seed_profile(source, tmp_path / "target")

    assert (target / "Wii/title/RMBE01/data/gamedata").read_bytes() == b"unlocked"
    assert (target / "Config/Dolphin.ini").is_file()
    assert not (target / "Logs").exists()
    assert not (target / "StateSaves").exists()
    assert not (target / "Load/WiiSD.raw").exists()
    assert not (target / "dead-process-pipe").exists()
    assert len(seed_profile_sha256(target)) == 64
