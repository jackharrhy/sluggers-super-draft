from __future__ import annotations

import os
import stat
from pathlib import Path

import pytest
from starworks_runner.games.sluggers.controller import DolphinPipeController
from starworks_runner.games.sluggers.errors import DolphinLaunchError


@pytest.mark.skipif(os.name != "posix", reason="Dolphin FIFO backend is POSIX-only")
def test_controller_prepares_a_private_fifo_and_deterministic_wiimote_mapping(
    tmp_path: Path,
) -> None:
    controller = DolphinPipeController(tmp_path)

    controller.prepare()

    assert stat.S_ISFIFO(controller.pipe_path.stat().st_mode)
    assert stat.S_ISFIFO(controller.hotkey_pipe_path.stat().st_mode)
    assert controller.pipe_path.stat().st_mode & 0o777 == 0o600
    assert controller.hotkey_pipe_path.stat().st_mode & 0o777 == 0o600
    configuration = (tmp_path / "Config/WiimoteNew.ini").read_text(encoding="utf-8")
    assert "Device = Pipe/0/starworks" in configuration
    assert "Buttons/A = `Button A`" in configuration
    assert "Nunchuk/Stick/Up = `Button D_UP`" in configuration
    hotkeys = (tmp_path / "Config/Hotkeys.ini").read_text(encoding="utf-8")
    assert "Device = Pipe/0/starworks-hotkeys" in hotkeys
    assert "General/Take Screenshot = `Button X`" in hotkeys
    assert "Save State/Save State Slot 1 = `Button Y`" in hotkeys
    dolphin = (tmp_path / "Config/Dolphin.ini").read_text(encoding="utf-8")
    assert "Enabled = False" in dolphin
    assert "PermissionAsked = True" in dolphin
    assert "UsePanicHandlers = False" in dolphin
    assert "ConfirmStop = False" in dolphin


@pytest.mark.skipif(os.name != "posix", reason="Dolphin FIFO backend is POSIX-only")
def test_controller_commands_are_bounded_and_written_as_lines(tmp_path: Path) -> None:
    controller = DolphinPipeController(tmp_path)
    controller.prepare()
    reader = os.open(controller.pipe_path, os.O_RDONLY | os.O_NONBLOCK)
    hotkey_reader = os.open(controller.hotkey_pipe_path, os.O_RDONLY | os.O_NONBLOCK)
    try:
        controller.connect(timeout_seconds=0.1)
        controller.tap("A", delay_seconds=0, sleep=lambda _: None)
        controller.chord("B", "A", delay_seconds=0, sleep=lambda _: None)
        controller.hold_then_tap(
            "Z", "A", hold_seconds=3, tap_seconds=0, sleep=lambda _: None
        )
        controller.move_stick(-1, 0, delay_seconds=0, sleep=lambda _: None)

        assert os.read(reader, 4096) == (
            b"PRESS A\nRELEASE A\n"
            b"PRESS B\nPRESS A\nRELEASE A\nRELEASE B\n"
            b"PRESS Z\nPRESS A\nRELEASE A\nRELEASE Z\n"
            b"PRESS D_LEFT\nRELEASE D_LEFT\n"
        )
        with pytest.raises(DolphinLaunchError, match="one line"):
            controller.command("PRESS A\nPRESS B")
        with pytest.raises(DolphinLaunchError, match="Unsupported"):
            controller.tap("HOME")
        with pytest.raises(DolphinLaunchError, match="cannot be empty"):
            controller.chord()
        with pytest.raises(DolphinLaunchError, match="must differ"):
            controller.hold_then_tap("A", "A", hold_seconds=0, sleep=lambda _: None)
        with pytest.raises(DolphinLaunchError, match="cannot be negative"):
            controller.hold_then_tap("Z", "A", hold_seconds=-1, sleep=lambda _: None)
    finally:
        controller.close()
        os.close(reader)
        os.close(hotkey_reader)


@pytest.mark.skipif(os.name != "posix", reason="Dolphin FIFO backend is POSIX-only")
def test_controller_collects_a_native_dolphin_screenshot(tmp_path: Path) -> None:
    controller = DolphinPipeController(tmp_path)
    controller.prepare()
    controller_reader = os.open(controller.pipe_path, os.O_RDONLY | os.O_NONBLOCK)
    hotkey_reader = os.open(controller.hotkey_pipe_path, os.O_RDONLY | os.O_NONBLOCK)
    ticks = iter((0.0, 0.0, 0.01))
    wrote_screenshot = False

    def produce_screenshot(_: float) -> None:
        nonlocal wrote_screenshot
        if wrote_screenshot:
            return
        wrote_screenshot = True
        screenshot = controller.screenshot_directory / "RMBE01_test.png"
        screenshot.parent.mkdir(parents=True)
        screenshot.write_bytes(b"\x89PNG\r\n\x1a\n" + bytes(24))

    try:
        controller.connect(timeout_seconds=0.1)
        screenshot = controller.capture_screenshot(
            timeout_seconds=0.1,
            monotonic=lambda: next(ticks),
            sleep=produce_screenshot,
        )

        assert screenshot.name == "RMBE01_test.png"
        assert os.read(hotkey_reader, 4096) == b"PRESS X\nRELEASE X\n"
    finally:
        controller.close()
        os.close(controller_reader)
        os.close(hotkey_reader)


@pytest.mark.skipif(os.name != "posix", reason="Dolphin FIFO backend is POSIX-only")
def test_controller_collects_a_native_dolphin_save_state(tmp_path: Path) -> None:
    controller = DolphinPipeController(tmp_path)
    controller.prepare()
    controller_reader = os.open(controller.pipe_path, os.O_RDONLY | os.O_NONBLOCK)
    hotkey_reader = os.open(controller.hotkey_pipe_path, os.O_RDONLY | os.O_NONBLOCK)
    ticks = iter((0.0, 0.0, 0.01))
    wrote_state = False

    def produce_state(_: float) -> None:
        nonlocal wrote_state
        if wrote_state:
            return
        wrote_state = True
        controller.state_save_path.parent.mkdir(parents=True)
        controller.state_save_path.write_bytes(b"checkpoint")

    try:
        controller.connect(timeout_seconds=0.1)
        state = controller.save_state_slot_one(
            timeout_seconds=0.1,
            monotonic=lambda: next(ticks),
            sleep=produce_state,
        )

        assert state == controller.state_save_path
        assert os.read(hotkey_reader, 4096) == b"PRESS Y\nRELEASE Y\n"
    finally:
        controller.close()
        os.close(controller_reader)
        os.close(hotkey_reader)


def test_controller_refuses_to_replace_a_regular_file(tmp_path: Path) -> None:
    path = tmp_path / "Pipes/starworks"
    path.parent.mkdir(parents=True)
    path.write_text("not a pipe", encoding="utf-8")

    with pytest.raises(DolphinLaunchError, match="non-pipe"):
        DolphinPipeController(tmp_path).prepare()


@pytest.mark.skipif(os.name != "posix", reason="Dolphin FIFO backend is POSIX-only")
def test_controller_preserves_existing_dolphin_profile_settings(tmp_path: Path) -> None:
    configuration = tmp_path / "Config/Dolphin.ini"
    configuration.parent.mkdir(parents=True)
    configuration.write_text(
        "[General]\nWirelessMac = 00:17:ab:00:00:01\n\n[Analytics]\nID = existing-id\n",
        encoding="utf-8",
    )

    DolphinPipeController(tmp_path).prepare()

    contents = configuration.read_text(encoding="utf-8")
    assert "WirelessMac = 00:17:ab:00:00:01" in contents
    assert "ID = existing-id" in contents
    assert "Enabled = False" in contents
    assert "PermissionAsked = True" in contents
    assert "UsePanicHandlers = False" in contents
    assert "ConfirmStop = False" in contents
