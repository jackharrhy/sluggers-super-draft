from __future__ import annotations

import errno
import os
import stat
import time
from configparser import ConfigParser
from dataclasses import dataclass
from pathlib import Path
from typing import Self

from starworks_runner.games.sluggers.errors import DolphinLaunchError

WIIMOTE_PIPE_CONFIGURATION = """[Wiimote1]
Device = Pipe/0/{device_name}
Buttons/A = `Button A`
Buttons/B = `Button B`
Buttons/1 = `Button X`
Buttons/2 = `Button Y`
Buttons/- = `Button Z`
Buttons/+ = `Button START`
Extension = Nunchuk
Nunchuk/Buttons/C = `Button L`
Nunchuk/Buttons/Z = `Button R`
Nunchuk/Stick/Up = `Button D_UP`
Nunchuk/Stick/Down = `Button D_DOWN`
Nunchuk/Stick/Left = `Button D_LEFT`
Nunchuk/Stick/Right = `Button D_RIGHT`
[Wiimote2]
Device = Pipe/0/{device_name}
[Wiimote3]
Device = Pipe/0/{device_name}
[Wiimote4]
Device = Pipe/0/{device_name}
[BalanceBoard]
Device = Pipe/0/{device_name}
"""

HOTKEY_PIPE_CONFIGURATION = """[Hotkeys]
Device = Pipe/0/{device_name}
General/Take Screenshot = `Button X`
Save State/Save State Slot 1 = `Button Y`
"""

SUPPORTED_BUTTONS = frozenset(
    {
        "A",
        "B",
        "X",
        "Y",
        "Z",
        "START",
        "L",
        "R",
        "D_UP",
        "D_DOWN",
        "D_LEFT",
        "D_RIGHT",
    }
)


@dataclass
class DolphinPipeController:
    """Deterministic Dolphin controller input without foreground key injection."""

    profile_directory: Path
    device_name: str = "starworks"
    descriptor: int | None = None
    hotkey_descriptor: int | None = None

    @property
    def pipe_path(self) -> Path:
        return (
            self.profile_directory.expanduser().resolve() / "Pipes" / self.device_name
        )

    @property
    def hotkey_pipe_path(self) -> Path:
        return self.pipe_path.with_name(f"{self.device_name}-hotkeys")

    @property
    def screenshot_directory(self) -> Path:
        return self.profile_directory.expanduser().resolve() / "ScreenShots" / "RMBE01"

    @property
    def state_save_path(self) -> Path:
        return (
            self.profile_directory.expanduser().resolve() / "StateSaves" / "RMBE01.s01"
        )

    def prepare(self) -> None:
        if os.name != "posix":
            raise DolphinLaunchError(
                "This Dolphin controller-pipe backend currently requires a POSIX runner"
            )
        if not self.device_name or "/" in self.device_name or "\0" in self.device_name:
            raise DolphinLaunchError("Dolphin controller pipe name is invalid")
        profile = self.profile_directory.expanduser().resolve()
        pipes = profile / "Pipes"
        configuration = profile / "Config"
        pipes.mkdir(parents=True, exist_ok=True)
        configuration.mkdir(parents=True, exist_ok=True)
        for path in (self.pipe_path, self.hotkey_pipe_path):
            if path.exists():
                if not stat.S_ISFIFO(path.stat().st_mode):
                    raise DolphinLaunchError(
                        f"Refusing to replace non-pipe controller path: {path}"
                    )
            else:
                os.mkfifo(path, mode=0o600)
        (configuration / "WiimoteNew.ini").write_text(
            WIIMOTE_PIPE_CONFIGURATION.format(device_name=self.device_name),
            encoding="utf-8",
        )
        (configuration / "Hotkeys.ini").write_text(
            HOTKEY_PIPE_CONFIGURATION.format(device_name=f"{self.device_name}-hotkeys"),
            encoding="utf-8",
        )
        self._configure_profile(configuration / "Dolphin.ini")

    @staticmethod
    def _configure_profile(path: Path) -> None:
        dolphin = ConfigParser(interpolation=None, strict=False)
        dolphin.optionxform = str
        if path.is_file():
            dolphin.read(path, encoding="utf-8")
        if not dolphin.has_section("Analytics"):
            dolphin.add_section("Analytics")
        dolphin.set("Analytics", "Enabled", "False")
        dolphin.set("Analytics", "PermissionAsked", "True")
        if not dolphin.has_section("Interface"):
            dolphin.add_section("Interface")
        dolphin.set("Interface", "UsePanicHandlers", "False")
        dolphin.set("Interface", "ConfirmStop", "False")
        if not dolphin.has_section("Core"):
            dolphin.add_section("Core")
        # Menu timing, bridge polling, and telemetry frame deadlines are all
        # defined against real-time 100% emulation. Research seed profiles may
        # have disabled throttling, but an application-managed match must not
        # inherit that operator setting.
        dolphin.set("Core", "EmulationSpeed", "1.0")
        if not dolphin.has_section("General"):
            dolphin.add_section("General")
        dolphin.set(
            "General",
            "CurrentStatePath",
            str(path.parent.parent / "StateSaves"),
        )
        with path.open("w", encoding="utf-8") as stream:
            dolphin.write(stream)

    def connect(
        self,
        *,
        timeout_seconds: float = 10.0,
        monotonic=time.monotonic,
        sleep=time.sleep,
    ) -> None:
        if self.descriptor is not None or self.hotkey_descriptor is not None:
            raise DolphinLaunchError("Dolphin controller pipe is already connected")
        deadline = monotonic() + timeout_seconds
        try:
            self.descriptor = self._connect_pipe(
                self.pipe_path,
                deadline=deadline,
                monotonic=monotonic,
                sleep=sleep,
            )
            self.hotkey_descriptor = self._connect_pipe(
                self.hotkey_pipe_path,
                deadline=deadline,
                monotonic=monotonic,
                sleep=sleep,
            )
        except Exception:
            self.close()
            raise

    @staticmethod
    def _connect_pipe(
        path: Path,
        *,
        deadline: float,
        monotonic,
        sleep,
    ) -> int:
        while True:
            try:
                return os.open(path, os.O_WRONLY | os.O_NONBLOCK)
            except OSError as error:
                if error.errno not in {errno.ENXIO, errno.ENOENT}:
                    raise DolphinLaunchError(
                        f"Unable to connect Dolphin input pipe {path.name}: {error}"
                    ) from error
            if monotonic() >= deadline:
                raise DolphinLaunchError(
                    f"Dolphin did not open input pipe {path.name} before the timeout"
                )
            sleep(0.05)

    def command(self, value: str) -> None:
        self._write_command(self.descriptor, value, label="controller")

    @staticmethod
    def _write_command(descriptor: int | None, value: str, *, label: str) -> None:
        if descriptor is None:
            raise DolphinLaunchError(f"Dolphin {label} pipe is not connected")
        if "\n" in value or "\r" in value:
            raise DolphinLaunchError("Dolphin controller command must be one line")
        try:
            os.write(descriptor, (value + "\n").encode("ascii"))
        except (OSError, UnicodeEncodeError) as error:
            raise DolphinLaunchError(
                f"Unable to write Dolphin {label} command: {error}"
            ) from error

    def capture_screenshot(
        self,
        *,
        timeout_seconds: float = 5.0,
        monotonic=time.monotonic,
        sleep=time.sleep,
    ) -> Path:
        """Capture Dolphin's rendered XFB through its native GPU readback path."""

        if timeout_seconds <= 0:
            raise DolphinLaunchError("Dolphin screenshot timeout must be positive")
        directory = self.screenshot_directory
        before = set(directory.glob("*.png")) if directory.is_dir() else set()
        self._write_command(self.hotkey_descriptor, "PRESS X", label="hotkey")
        sleep(0.08)
        self._write_command(self.hotkey_descriptor, "RELEASE X", label="hotkey")
        deadline = monotonic() + timeout_seconds
        while True:
            candidates = (
                sorted(
                    directory.glob("*.png"), key=lambda path: path.stat().st_mtime_ns
                )
                if directory.is_dir()
                else []
            )
            for candidate in reversed(candidates):
                if candidate not in before and candidate.stat().st_size >= 24:
                    with candidate.open("rb") as stream:
                        if stream.read(8) == b"\x89PNG\r\n\x1a\n":
                            return candidate.resolve()
            if monotonic() >= deadline:
                raise DolphinLaunchError(
                    "Dolphin did not produce a native screenshot before the timeout"
                )
            sleep(0.05)

    def save_state_slot_one(
        self,
        *,
        timeout_seconds: float = 10.0,
        monotonic=time.monotonic,
        sleep=time.sleep,
    ) -> Path:
        """Create a tooling checkpoint through Dolphin's native state system.

        Match recovery deliberately does not use this method; failed attempts
        always restart from the immutable pre-game seed checkpoint.
        """

        if timeout_seconds <= 0:
            raise DolphinLaunchError("Dolphin save-state timeout must be positive")
        target = self.state_save_path
        prior_mtime = target.stat().st_mtime_ns if target.is_file() else None
        self._write_command(self.hotkey_descriptor, "PRESS Y", label="hotkey")
        sleep(0.08)
        self._write_command(self.hotkey_descriptor, "RELEASE Y", label="hotkey")
        deadline = monotonic() + timeout_seconds
        while True:
            if target.is_file() and target.stat().st_size > 0:
                current_mtime = target.stat().st_mtime_ns
                if prior_mtime is None or current_mtime != prior_mtime:
                    return target.resolve()
            if monotonic() >= deadline:
                raise DolphinLaunchError(
                    "Dolphin did not produce save-state slot one before the timeout"
                )
            sleep(0.05)

    def tap(
        self, button: str, *, delay_seconds: float = 0.08, sleep=time.sleep
    ) -> None:
        if button not in SUPPORTED_BUTTONS:
            raise DolphinLaunchError(f"Unsupported Dolphin controller button {button}")
        self.command(f"PRESS {button}")
        sleep(delay_seconds)
        self.command(f"RELEASE {button}")
        sleep(delay_seconds)

    def chord(
        self,
        *buttons: str,
        delay_seconds: float = 0.08,
        sleep=time.sleep,
    ) -> None:
        if not buttons:
            raise DolphinLaunchError("Dolphin controller chord cannot be empty")
        for button in buttons:
            if button not in SUPPORTED_BUTTONS:
                raise DolphinLaunchError(
                    f"Unsupported Dolphin controller button {button}"
                )
        for button in buttons:
            self.command(f"PRESS {button}")
        sleep(delay_seconds)
        for button in reversed(buttons):
            self.command(f"RELEASE {button}")
        sleep(delay_seconds)

    def hold_then_tap(
        self,
        held_button: str,
        tapped_button: str,
        *,
        hold_seconds: float,
        tap_seconds: float = 0.08,
        sleep=time.sleep,
    ) -> None:
        """Hold one input before tapping another without releasing the first."""

        for button in (held_button, tapped_button):
            if button not in SUPPORTED_BUTTONS:
                raise DolphinLaunchError(
                    f"Unsupported Dolphin controller button {button}"
                )
        if held_button == tapped_button:
            raise DolphinLaunchError(
                "Held and tapped Dolphin controller buttons must differ"
            )
        if hold_seconds < 0 or tap_seconds < 0:
            raise DolphinLaunchError("Dolphin controller delays cannot be negative")
        self.command(f"PRESS {held_button}")
        sleep(hold_seconds)
        self.command(f"PRESS {tapped_button}")
        sleep(tap_seconds)
        self.command(f"RELEASE {tapped_button}")
        self.command(f"RELEASE {held_button}")
        sleep(tap_seconds)

    def move_stick(
        self,
        x: int,
        y: int,
        *,
        delay_seconds: float = 0.08,
        sleep=time.sleep,
    ) -> None:
        if x not in {-1, 0, 1} or y not in {-1, 0, 1}:
            raise DolphinLaunchError(
                "Dolphin controller stick values must be -1, 0, or 1"
            )
        directions = []
        if x < 0:
            directions.append("D_LEFT")
        elif x > 0:
            directions.append("D_RIGHT")
        if y < 0:
            directions.append("D_UP")
        elif y > 0:
            directions.append("D_DOWN")
        for direction in directions:
            self.command(f"PRESS {direction}")
        sleep(delay_seconds)
        for direction in reversed(directions):
            self.command(f"RELEASE {direction}")
        sleep(delay_seconds)

    def close(self) -> None:
        if self.descriptor is not None:
            os.close(self.descriptor)
            self.descriptor = None
        if self.hotkey_descriptor is not None:
            os.close(self.hotkey_descriptor)
            self.hotkey_descriptor = None

    def __enter__(self) -> Self:
        self.prepare()
        return self

    def __exit__(self, *_: object) -> None:
        self.close()
