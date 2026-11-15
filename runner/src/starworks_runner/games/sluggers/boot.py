from __future__ import annotations

import time
from collections.abc import Callable
from dataclasses import asdict, dataclass
from enum import StrEnum
from pathlib import Path
from typing import Protocol

from PIL import Image, ImageChops, ImageStat

from starworks_runner.games.sluggers.bridge.layout import BridgeProtocolError
from starworks_runner.games.sluggers.errors import DolphinLaunchError
from starworks_runner.games.sluggers.menu_observation import (
    MAIN_MODE_TASK_DESCRIPTOR,
    MenuObservation,
    MenuScene,
)

FrameSource = Path | Image.Image


_SAMPLE_SIZE = (48, 27)
_MAIN_MODE_SETTLE_SECONDS = 0.75


@dataclass(frozen=True)
class FrameObservation:
    """Small, resolution-independent description of one rendered game frame."""

    black_fraction: float
    white_fraction: float
    blue_fraction: float
    green_fraction: float
    red_fraction: float
    mean_luminance: float
    change_from_previous: float | None
    file_one_pink_fraction: float
    middle_neutral_fraction: float

    @property
    def is_black(self) -> bool:
        return self.black_fraction >= 0.85

    @property
    def is_wii_safety(self) -> bool:
        # Both pages of the Wii safety message are predominantly white. The
        # rule intentionally does not encode or distribute either game image.
        return self.white_fraction >= 0.65 and self.black_fraction <= 0.05

    @property
    def is_sluggers_title(self) -> bool:
        # The title composition is unusually stable: blue stands and sky,
        # green field, and the red logo. Ranges tolerate capture scaling and
        # minor renderer differences while excluding the opening movie frames.
        return (
            self.black_fraction <= 0.05
            and self.white_fraction <= 0.05
            and 0.27 <= self.blue_fraction <= 0.43
            and 0.14 <= self.green_fraction <= 0.27
            and 0.09 <= self.red_fraction <= 0.19
        )

    @property
    def is_file_select(self) -> bool:
        return (
            self.black_fraction <= 0.02
            and 0.58 <= self.blue_fraction <= 0.72
            and self.green_fraction <= 0.01
            and 0.03 <= self.red_fraction <= 0.08
        )

    @property
    def is_file_one_selected(self) -> bool:
        # The known-complete File 1 gains a pink outline when selected. The
        # initial cursor is File 2, whose blue outline does not satisfy this
        # region-specific postcondition.
        return self.is_file_select and self.file_one_pink_fraction >= 0.012

    @property
    def is_file_action_menu(self) -> bool:
        # The save action menu places a nearly neutral white band through the
        # middle of the frame and dims the blue file-selector background.
        return (
            self.black_fraction <= 0.03
            and self.blue_fraction <= 0.05
            and self.middle_neutral_fraction >= 0.75
        )

    @property
    def is_sluggers_main_menu(self) -> bool:
        return (
            self.black_fraction <= 0.02
            and self.white_fraction <= 0.05
            and 0.27 <= self.blue_fraction <= 0.42
            and 0.03 <= self.green_fraction <= 0.10
            and 0.07 <= self.red_fraction <= 0.14
            and 0.50 <= self.mean_luminance <= 0.65
        )

    def diagnostic_value(self) -> dict[str, float | None]:
        return asdict(self)


def observe_frame(
    source: FrameSource, *, previous: FrameSource | None = None
) -> FrameObservation:
    current = _sample(source)
    pixels = list(current.getdata())
    count = len(pixels)

    def fraction(predicate) -> float:
        return sum(predicate(red, green, blue) for red, green, blue in pixels) / count

    change = None
    if previous is not None:
        previous_sample = _sample(previous)
        channels = ImageStat.Stat(ImageChops.difference(current, previous_sample)).mean
        change = sum(channels) / len(channels) / 255

    full_size = _rgb(source)
    width, height = full_size.size
    file_one = full_size.crop(
        (
            width * 125 // 640,
            height * 60 // 448,
            width * 270 // 640,
            height * 390 // 448,
        )
    )
    middle = full_size.crop((0, height * 125 // 448, width, height * 335 // 448))

    return FrameObservation(
        black_fraction=fraction(lambda red, green, blue: max(red, green, blue) < 16),
        white_fraction=fraction(lambda red, green, blue: min(red, green, blue) > 235),
        blue_fraction=fraction(
            lambda red, green, blue: (
                blue > 110 and blue > red * 1.15 and blue > green * 1.03
            )
        ),
        green_fraction=fraction(
            lambda red, green, blue: (
                green > 100 and green > red * 1.15 and green > blue * 1.05
            )
        ),
        red_fraction=fraction(
            lambda red, green, blue: (
                red > 130 and red > green * 1.25 and red > blue * 1.25
            )
        ),
        mean_luminance=sum(sum(pixel) / 3 for pixel in pixels) / count / 255,
        change_from_previous=change,
        file_one_pink_fraction=_pixel_fraction(
            file_one,
            lambda red, green, blue: (
                red > 135 and blue > 80 and red > green * 1.2 and blue > green * 1.05
            ),
        ),
        middle_neutral_fraction=_pixel_fraction(
            middle,
            lambda red, green, blue: (
                min(red, green, blue) > 100
                and max(red, green, blue) - min(red, green, blue) < 35
            ),
        ),
    )


def _sample(source: FrameSource) -> Image.Image:
    return _rgb(source).resize(_SAMPLE_SIZE, Image.Resampling.BILINEAR)


def _rgb(source: FrameSource) -> Image.Image:
    if isinstance(source, Image.Image):
        return source.convert("RGB")
    with Image.open(source) as image:
        return image.convert("RGB")


def _pixel_fraction(image: Image.Image, predicate) -> float:
    return sum(predicate(red, green, blue) for red, green, blue in image.getdata()) / (
        image.width * image.height
    )


class BootPhase(StrEnum):
    WAITING_FOR_SAFETY = "waiting-for-safety"
    WAITING_FOR_INTRO = "waiting-for-intro"
    SKIPPING_INTRO = "skipping-intro"
    ADVANCING_TITLE = "advancing-title"
    SELECTING_FILE_ONE = "selecting-file-one"
    OPENING_FILE_ONE = "opening-file-one"
    STARTING_FILE_ONE = "starting-file-one"
    AT_MAIN_MENU = "at-main-menu"


@dataclass
class BootStateMachine:
    """Choose boot inputs from observed frames and verified profile state."""

    has_existing_save: bool
    phase: BootPhase = BootPhase.WAITING_FOR_SAFETY
    saw_safety: bool = False
    last_action_at: float | None = None
    dynamic_frames: int = 0
    title_frames: int = 0
    matching_frames: int = 0

    def observe(self, frame: FrameObservation, *, now: float) -> tuple[str, ...]:
        if self.phase is BootPhase.WAITING_FOR_SAFETY:
            return self._observe_safety(frame, now=now)
        if self.phase is BootPhase.WAITING_FOR_INTRO:
            return self._observe_intro(frame, now=now)
        if self.phase is BootPhase.SKIPPING_INTRO:
            return self._observe_title(frame, now=now)
        if self.phase is BootPhase.ADVANCING_TITLE:
            return self._observe_file_select(frame, now=now)
        if self.phase is BootPhase.SELECTING_FILE_ONE:
            return self._observe_file_one(frame, now=now)
        if self.phase is BootPhase.OPENING_FILE_ONE:
            return self._observe_file_action(frame, now=now)
        if self.phase is BootPhase.STARTING_FILE_ONE:
            return self._observe_main_menu(frame, now=now)
        return ()

    def _observe_safety(
        self, frame: FrameObservation, *, now: float
    ) -> tuple[str, ...]:
        if frame.is_wii_safety:
            self.saw_safety = True
            if self._action_due(now, interval=1.0):
                self.last_action_at = now
                return ("A",)
            return ()
        if self.saw_safety and not frame.is_black:
            self.phase = BootPhase.WAITING_FOR_INTRO
        return ()

    def _observe_intro(self, frame: FrameObservation, *, now: float) -> tuple[str, ...]:
        if frame.is_wii_safety:
            self.phase = BootPhase.WAITING_FOR_SAFETY
            return self._observe_safety(frame, now=now)
        change = frame.change_from_previous
        if frame.is_black or change is None:
            self.dynamic_frames = 0
            return ()
        self.dynamic_frames = self.dynamic_frames + 1 if change >= 0.04 else 0
        if self.dynamic_frames >= 2:
            self.phase = BootPhase.SKIPPING_INTRO
            self.last_action_at = now
            return ("A",)
        return ()

    def _observe_title(self, frame: FrameObservation, *, now: float) -> tuple[str, ...]:
        if frame.is_sluggers_title:
            self.title_frames += 1
            if self.title_frames >= 2:
                self.phase = BootPhase.ADVANCING_TITLE
                self.last_action_at = now
                return ("A+B",)
            return ()
        self.title_frames = 0
        # With an existing save, the only animated state between safety and
        # the title is the skippable intro. Retrying A is safe and is verified
        # by the title-screen postcondition. A first-run save prompt needs its
        # own explicit branch and is therefore never guessed through here.
        if (
            self.has_existing_save
            and not frame.is_black
            and self._action_due(now, interval=2.0)
        ):
            self.last_action_at = now
            return ("A",)
        return ()

    def _observe_file_select(
        self, frame: FrameObservation, *, now: float
    ) -> tuple[str, ...]:
        if frame.is_file_select:
            self.matching_frames += 1
            if self.matching_frames >= 2:
                self.phase = BootPhase.SELECTING_FILE_ONE
                self.matching_frames = 0
                self.last_action_at = now
                # File 2 is the initial cursor. File 1 is the known-complete
                # profile, so moving left is a required part of the contract.
                return ("D_LEFT",)
            return ()
        self.matching_frames = 0
        if frame.is_sluggers_title and self._action_due(now, interval=2.0):
            self.last_action_at = now
            return ("A+B",)
        return ()

    def _observe_file_one(
        self, frame: FrameObservation, *, now: float
    ) -> tuple[str, ...]:
        if frame.is_file_one_selected:
            # The selected border pulses off every other sampled frame. One
            # positive, File-1-specific observation is conclusive because this
            # phase is reachable only after a stable File 2 screen and Left.
            self.phase = BootPhase.OPENING_FILE_ONE
            self.matching_frames = 0
            self.last_action_at = now
            return ("A",)
        self.matching_frames = 0
        if frame.is_file_select and self._action_due(now, interval=1.5):
            # Left is idempotent at File 1 and retries a dropped Pipe input
            # without ever advancing to File 2 or File 3.
            self.last_action_at = now
            return ("D_LEFT",)
        return ()

    def _observe_file_action(
        self, frame: FrameObservation, *, now: float
    ) -> tuple[str, ...]:
        if frame.is_file_action_menu:
            self.matching_frames += 1
            if self.matching_frames >= 2:
                self.phase = BootPhase.STARTING_FILE_ONE
                self.matching_frames = 0
                self.last_action_at = now
                return ("A",)
            return ()
        self.matching_frames = 0
        if frame.is_file_one_selected and self._action_due(now, interval=1.5):
            self.last_action_at = now
            return ("A",)
        return ()

    def _observe_main_menu(
        self, frame: FrameObservation, *, now: float
    ) -> tuple[str, ...]:
        if frame.is_sluggers_main_menu:
            self.matching_frames += 1
            if self.matching_frames >= 2:
                self.phase = BootPhase.AT_MAIN_MENU
            return ()
        self.matching_frames = 0
        if frame.is_file_action_menu and self._action_due(now, interval=1.5):
            self.last_action_at = now
            return ("A",)
        return ()

    def _action_due(self, now: float, *, interval: float) -> bool:
        return self.last_action_at is None or now - self.last_action_at >= interval


class BootFrame(Protocol):
    def to_rgb(self) -> Image.Image: ...


class BootFrameReader(Protocol):
    def read(self) -> BootFrame: ...


class BootMenuObserver(Protocol):
    def read(self) -> MenuObservation: ...


class BootController(Protocol):
    def tap(self, button: str) -> None: ...

    def chord(self, *buttons: str) -> None: ...


@dataclass(frozen=True)
class BootNavigationResult:
    elapsed_seconds: float
    observed_frames: int
    semantic_observations: int = 0


class SluggersBootNavigator:
    """Reach the main menu using game state, with XFB only for early Wii UI."""

    def __init__(
        self,
        *,
        frame_reader: BootFrameReader,
        controller: BootController,
        has_existing_save: bool,
        menu_observer: BootMenuObserver | None = None,
        health_check: Callable[[], None] | None = None,
    ) -> None:
        self.frame_reader = frame_reader
        self.controller = controller
        self.machine = BootStateMachine(has_existing_save=has_existing_save)
        self.has_existing_save = has_existing_save
        self.menu_observer = menu_observer
        self.health_check = health_check
        self._last_semantic_action: str | None = None
        self._last_semantic_action_at: float | None = None

    def navigate_to_main_menu(
        self,
        *,
        timeout_seconds: float = 60.0,
        observation_interval_seconds: float = 0.5,
        diagnostic_directory: Path | None = None,
        monotonic=time.monotonic,
        sleep=time.sleep,
    ) -> BootNavigationResult:
        if timeout_seconds <= 0 or observation_interval_seconds <= 0:
            raise DolphinLaunchError("Sluggers boot timeouts must be positive")
        started_at = monotonic()
        deadline = started_at + timeout_seconds
        previous: Image.Image | None = None
        observed_frames = 0
        semantic_observations = 0
        semantic_game_started = False
        last_read_error: Exception | None = None
        last_menu_observation: MenuObservation | None = None
        maximum_file_one_pink_fraction = 0.0
        last_observation: FrameObservation | None = None
        diagnostics = (
            diagnostic_directory.expanduser().resolve()
            if diagnostic_directory is not None
            else None
        )
        if diagnostics is not None:
            diagnostics.mkdir(parents=True, exist_ok=False)
        while monotonic() < deadline:
            if self.health_check is not None:
                self.health_check()
            if self.menu_observer is not None:
                try:
                    menu = self.menu_observer.read()
                except BridgeProtocolError as error:
                    last_read_error = error
                else:
                    last_menu_observation = menu
                    if menu.scene not in (
                        MenuScene.SYSTEM_STARTUP,
                        MenuScene.UNKNOWN,
                    ):
                        semantic_game_started = True
                        semantic_observations += 1
                        now = monotonic()
                        action = self._semantic_action(menu, now=now - started_at)
                        if action is not None:
                            self._dispatch(action)
                        if menu.is_main_mode_ready:
                            return BootNavigationResult(
                                elapsed_seconds=now - started_at,
                                observed_frames=observed_frames,
                                semantic_observations=semantic_observations,
                            )
                        sleep(observation_interval_seconds)
                        continue
                    if semantic_game_started:
                        # Once an exact game task has appeared, rendered
                        # pixels are no longer an authority. A transient task
                        # read failure/unknown descriptor must wait or time
                        # out semantically rather than revive the old colour
                        # classifier mid-flow.
                        sleep(observation_interval_seconds)
                        continue
                if semantic_game_started:
                    sleep(observation_interval_seconds)
                    continue
            try:
                image = self.frame_reader.read().to_rgb()
            except BridgeProtocolError as error:
                # VI/XFB fields are legitimately uninitialized during the first
                # boot frames. Keep the last error for a useful bounded failure.
                last_read_error = error
                sleep(observation_interval_seconds)
                continue
            last_read_error = None
            now = monotonic()
            observation = observe_frame(image, previous=previous)
            previous = image
            observed_frames += 1
            last_observation = observation
            maximum_file_one_pink_fraction = max(
                maximum_file_one_pink_fraction,
                observation.file_one_pink_fraction,
            )
            if diagnostics is not None:
                image.save(
                    diagnostics / f"{observed_frames:03d}-{now - started_at:06.2f}.png"
                )
            for action in self.machine.observe(observation, now=now - started_at):
                self._dispatch(action)
            if self.machine.phase is BootPhase.AT_MAIN_MENU:
                return BootNavigationResult(
                    elapsed_seconds=now - started_at,
                    observed_frames=observed_frames,
                    semantic_observations=semantic_observations,
                )
            sleep(observation_interval_seconds)
        detail = f"; last XFB error: {last_read_error}" if last_read_error else ""
        if last_observation is not None:
            detail += (
                f"; last observation: {last_observation.diagnostic_value()}"
                "; maximum File 1 pink fraction: "
                f"{maximum_file_one_pink_fraction:.4f}"
            )
        if last_menu_observation is not None:
            detail += f"; last menu observation: {last_menu_observation}"
        raise DolphinLaunchError(
            "Sluggers did not reach the main menu before the timeout "
            f"(phase {self.machine.phase.value}, {observed_frames} frames){detail}"
        )

    def navigate_to_exhibition_stadium(
        self,
        *,
        timeout_seconds: float = 75.0,
        observation_interval_seconds: float = 0.05,
        diagnostic_directory: Path | None = None,
        monotonic=time.monotonic,
        sleep=time.sleep,
    ) -> BootNavigationResult:
        """Cold boot through the exact Exhibition -> stadium boundary.

        Reaching an input-ready main selector is not sufficient: its cursor can
        still be on Minigames or another mode. Normalize the game-owned
        selection to Exhibition with observed, bounded moves, press A once,
        and accept success only after CMainSelStadiumTask is input-ready.
        """

        if self.menu_observer is None:
            raise DolphinLaunchError(
                "Exhibition navigation requires semantic Sluggers menu observation"
            )
        started_at = monotonic()
        main = self.navigate_to_main_menu(
            timeout_seconds=timeout_seconds,
            observation_interval_seconds=max(observation_interval_seconds, 0.05),
            diagnostic_directory=diagnostic_directory,
            monotonic=monotonic,
            sleep=sleep,
        )
        deadline = started_at + timeout_seconds
        semantic_observations = main.semantic_observations
        pending_selection: int | None = None
        stable_selection: int | None = None
        stable_selection_since: float | None = None
        moves = 0
        pressed_exhibition = False
        last: MenuObservation | None = None

        while monotonic() < deadline:
            if self.health_check is not None:
                self.health_check()
            try:
                last = self.menu_observer.read()
            except BridgeProtocolError:
                sleep(observation_interval_seconds)
                continue
            semantic_observations += 1
            if last.is_stadium_ready:
                now = monotonic()
                return BootNavigationResult(
                    elapsed_seconds=now - started_at,
                    observed_frames=main.observed_frames,
                    semantic_observations=semantic_observations,
                )
            if pressed_exhibition:
                if (
                    last.child_descriptor == MAIN_MODE_TASK_DESCRIPTOR
                    and last.child_state is not None
                    and last.child_state >= 7
                    and last.main_mode_result != 1
                ):
                    raise DolphinLaunchError(
                        "Sluggers committed the wrong main-menu destination; "
                        f"expected Exhibition result 1, observed "
                        f"{last.main_mode_result}"
                    )
                if last.scene in {
                    MenuScene.MINIGAMES,
                    MenuScene.CHALLENGE,
                    MenuScene.TRAINING,
                    MenuScene.RECORDS,
                    MenuScene.GRAND_PRIX,
                }:
                    raise DolphinLaunchError(
                        "Sluggers entered the wrong main-menu destination: "
                        f"{last.scene.value}"
                    )
                sleep(observation_interval_seconds)
                continue
            if not last.is_main_mode_ready:
                stable_selection = None
                stable_selection_since = None
                sleep(observation_interval_seconds)
                continue

            selection = last.main_mode_selection
            if selection is None or not 0 <= selection <= 5:
                raise DolphinLaunchError(
                    f"Sluggers reported invalid main-mode selection {selection}"
                )
            now = monotonic()
            if selection != stable_selection:
                stable_selection = selection
                stable_selection_since = now
            settled = (
                stable_selection_since is not None
                and now - stable_selection_since >= _MAIN_MODE_SETTLE_SECONDS
            )
            if pending_selection is not None and selection == pending_selection:
                sleep(observation_interval_seconds)
                continue
            if pending_selection is not None:
                pending_selection = None
                stable_selection_since = now
                settled = False
            if not settled:
                sleep(observation_interval_seconds)
                continue
            if last.is_exhibition_selected:
                self.controller.tap("A")
                pressed_exhibition = True
                sleep(observation_interval_seconds)
                continue

            if moves >= 5:
                raise DolphinLaunchError(
                    "Sluggers could not normalize the main-mode cursor to Exhibition"
                )
            self.controller.tap("D_LEFT")
            pending_selection = selection
            moves += 1
            sleep(observation_interval_seconds)

        raise DolphinLaunchError(
            "Sluggers did not reach Exhibition stadium selection before the timeout; "
            f"last menu observation was {last}"
        )

    def _semantic_action(
        self, observation: MenuObservation, *, now: float
    ) -> str | None:
        action = None
        interval = 1.5
        if observation.scene is MenuScene.INTRO_MOVIE:
            action = "A"
        elif observation.scene is MenuScene.TITLE:
            action = "A+B"
        elif observation.scene is MenuScene.FILE_SELECT and self.has_existing_save:
            action = "A" if observation.is_file_one_selected else "D_LEFT"
            interval = 0.75
        elif (
            observation.scene is MenuScene.FILE_ACTION
            and observation.child_state == 8
            and self.has_existing_save
        ):
            action = "A"
        if action is None:
            return None
        if (
            action == self._last_semantic_action
            and self._last_semantic_action_at is not None
            and now - self._last_semantic_action_at < interval
        ):
            return None
        self._last_semantic_action = action
        self._last_semantic_action_at = now
        return action

    def _dispatch(self, action: str) -> None:
        if action == "A+B":
            self.controller.chord("A", "B")
            return
        self.controller.tap(action)
