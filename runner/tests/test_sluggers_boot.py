from pathlib import Path

import pytest
from PIL import Image, ImageDraw
from starworks_runner.games.sluggers.boot import (
    BootNavigationResult,
    BootPhase,
    BootStateMachine,
    FrameObservation,
    SluggersBootNavigator,
    observe_frame,
)
from starworks_runner.games.sluggers.bridge.layout import BridgeProtocolError
from starworks_runner.games.sluggers.errors import DolphinLaunchError
from starworks_runner.games.sluggers.menu_observation import (
    FILE_TASK_DESCRIPTOR,
    MAIN_MODE_TASK_DESCRIPTOR,
    MAIN_STADIUM_TASK_DESCRIPTOR,
    OPENING_TASK_DESCRIPTOR,
    SELECT_TASK_DESCRIPTOR,
    MenuObservation,
    MenuScene,
)


def frame(**changes: float | None) -> FrameObservation:
    values: dict[str, float | None] = {
        "black_fraction": 0.0,
        "white_fraction": 0.0,
        "blue_fraction": 0.0,
        "green_fraction": 0.0,
        "red_fraction": 0.0,
        "mean_luminance": 0.5,
        "change_from_previous": 0.0,
        "file_one_pink_fraction": 0.0,
        "middle_neutral_fraction": 0.0,
    }
    values.update(changes)
    return FrameObservation(**values)  # type: ignore[arg-type]


def test_frame_observation_classifies_black_and_safety(tmp_path: Path) -> None:
    black = tmp_path / "black.png"
    white = tmp_path / "white.png"
    Image.new("RGB", (864, 480), "black").save(black)
    Image.new("RGB", (864, 480), "white").save(white)

    assert observe_frame(black).is_black
    assert observe_frame(white, previous=black).is_wii_safety
    assert observe_frame(white, previous=black).change_from_previous == 1


def test_frame_observation_requires_file_one_specific_highlight() -> None:
    file_two = Image.new("RGB", (640, 448), (120, 120, 120))
    draw = ImageDraw.Draw(file_two)
    draw.rectangle((0, 0, 415, 447), fill=(50, 90, 180))
    draw.rectangle((416, 0, 447, 447), fill=(180, 50, 50))
    file_one = file_two.copy()
    selected = ImageDraw.Draw(file_one)
    selected.rectangle((125, 60, 128, 389), fill=(190, 70, 150))
    selected.rectangle((266, 60, 269, 389), fill=(190, 70, 150))

    initial = observe_frame(file_two)
    moved_left = observe_frame(file_one, previous=file_two)

    assert initial.is_file_select
    assert not initial.is_file_one_selected
    assert moved_left.is_file_one_selected


def test_boot_inputs_require_observed_transitions_and_postconditions() -> None:
    machine = BootStateMachine(has_existing_save=True)
    safety = frame(white_fraction=0.76, mean_luminance=0.95)

    assert machine.observe(safety, now=1) == ("A",)
    assert machine.observe(safety, now=1.5) == ()
    assert machine.observe(safety, now=2) == ("A",)
    assert machine.phase is BootPhase.WAITING_FOR_SAFETY

    assert machine.observe(frame(black_fraction=1), now=2.5) == ()
    assert machine.observe(frame(change_from_previous=0.1), now=3) == ()
    assert machine.phase is BootPhase.WAITING_FOR_INTRO
    assert machine.observe(frame(change_from_previous=0.2), now=3.5) == ()
    assert machine.observe(frame(change_from_previous=0.2), now=4) == ("A",)
    assert machine.phase is BootPhase.SKIPPING_INTRO

    title = frame(blue_fraction=0.34, green_fraction=0.2, red_fraction=0.14)
    assert machine.observe(title, now=4.5) == ()
    assert machine.observe(title, now=5) == ("A+B",)
    assert machine.phase is BootPhase.ADVANCING_TITLE


def test_boot_selects_known_complete_file_one_before_starting() -> None:
    machine = BootStateMachine(
        has_existing_save=True,
        phase=BootPhase.ADVANCING_TITLE,
    )
    file_two = frame(
        blue_fraction=0.65,
        red_fraction=0.05,
        mean_luminance=0.52,
    )
    file_one = frame(
        blue_fraction=0.65,
        red_fraction=0.05,
        mean_luminance=0.54,
        file_one_pink_fraction=0.02,
    )
    action_menu = frame(
        blue_fraction=0.02,
        mean_luminance=0.48,
        middle_neutral_fraction=0.91,
    )
    main_menu = frame(
        white_fraction=0.02,
        blue_fraction=0.34,
        green_fraction=0.06,
        red_fraction=0.1,
        mean_luminance=0.58,
    )

    assert machine.observe(file_two, now=1) == ()
    assert machine.observe(file_two, now=1.5) == ("D_LEFT",)
    assert machine.phase is BootPhase.SELECTING_FILE_ONE
    assert machine.observe(file_one, now=2) == ("A",)
    assert machine.phase is BootPhase.OPENING_FILE_ONE
    assert machine.observe(action_menu, now=2.5) == ()
    assert machine.observe(action_menu, now=3) == ("A",)
    assert machine.phase is BootPhase.STARTING_FILE_ONE
    assert machine.observe(main_menu, now=4) == ()
    assert machine.observe(main_menu, now=4.5) == ()
    assert machine.phase is BootPhase.AT_MAIN_MENU


def test_first_run_does_not_guess_through_an_unknown_save_prompt() -> None:
    machine = BootStateMachine(
        has_existing_save=False,
        phase=BootPhase.SKIPPING_INTRO,
        last_action_at=1,
    )

    assert machine.observe(frame(), now=20) == ()


def test_navigator_dispatches_observed_file_one_path(monkeypatch) -> None:
    title = frame(blue_fraction=0.34, green_fraction=0.2, red_fraction=0.14)
    file_two = frame(blue_fraction=0.65, red_fraction=0.05)
    file_one = frame(
        blue_fraction=0.65,
        red_fraction=0.05,
        file_one_pink_fraction=0.02,
    )
    action_menu = frame(
        blue_fraction=0.02,
        middle_neutral_fraction=0.91,
    )
    main_menu = frame(
        white_fraction=0.02,
        blue_fraction=0.34,
        green_fraction=0.06,
        red_fraction=0.1,
        mean_luminance=0.58,
    )
    observations = iter(
        [
            title,
            title,
            file_two,
            file_two,
            file_one,
            action_menu,
            action_menu,
            main_menu,
            main_menu,
        ]
    )
    monkeypatch.setattr(
        "starworks_runner.games.sluggers.boot.observe_frame",
        lambda *_args, **_kwargs: next(observations),
    )

    class RawFrame:
        def to_rgb(self) -> Image.Image:
            return Image.new("RGB", (640, 448), "black")

    class Reader:
        def read(self) -> RawFrame:
            return RawFrame()

    class Controller:
        def __init__(self) -> None:
            self.actions: list[str] = []

        def tap(self, button: str) -> None:
            self.actions.append(button)

        def chord(self, *buttons: str) -> None:
            self.actions.append("+".join(buttons))

    class Clock:
        value = 0.0

        def __call__(self) -> float:
            self.value += 0.25
            return self.value

    controller = Controller()
    navigator = SluggersBootNavigator(
        frame_reader=Reader(),
        controller=controller,
        has_existing_save=True,
    )
    navigator.machine.phase = BootPhase.SKIPPING_INTRO

    result = navigator.navigate_to_main_menu(
        monotonic=Clock(),
        sleep=lambda _seconds: None,
    )

    assert isinstance(result, BootNavigationResult)
    assert result.observed_frames == 9
    assert controller.actions == ["A+B", "D_LEFT", "A", "A"]


def test_navigator_uses_semantic_states_after_game_startup() -> None:
    observations = iter(
        [
            MenuObservation(
                scene=MenuScene.INTRO_MOVIE,
                root_descriptor=OPENING_TASK_DESCRIPTOR,
                root_active=True,
                root_state=4,
            ),
            MenuObservation(
                scene=MenuScene.TITLE,
                root_descriptor=OPENING_TASK_DESCRIPTOR,
                root_active=True,
                root_state=6,
            ),
            MenuObservation(
                scene=MenuScene.FILE_SELECT,
                root_descriptor=OPENING_TASK_DESCRIPTOR,
                root_active=True,
                root_state=9,
                child_descriptor=FILE_TASK_DESCRIPTOR,
                child_state=6,
                file_selection=1,
            ),
            MenuObservation(
                scene=MenuScene.FILE_SELECT,
                root_descriptor=OPENING_TASK_DESCRIPTOR,
                root_active=True,
                root_state=9,
                child_descriptor=FILE_TASK_DESCRIPTOR,
                child_state=6,
                file_selection=0,
            ),
            MenuObservation(
                scene=MenuScene.FILE_ACTION,
                root_descriptor=OPENING_TASK_DESCRIPTOR,
                root_active=True,
                root_state=9,
                child_descriptor=FILE_TASK_DESCRIPTOR,
                child_state=8,
            ),
            MenuObservation(
                scene=MenuScene.MAIN_MODE,
                root_descriptor=SELECT_TASK_DESCRIPTOR,
                root_active=True,
                root_state=7,
                child_descriptor=MAIN_MODE_TASK_DESCRIPTOR,
                child_state=4,
                main_mode_selection=0,
            ),
        ]
    )

    class Observer:
        def read(self) -> MenuObservation:
            return next(observations)

    class Reader:
        def read(self):
            raise AssertionError("XFB must not be read after semantic startup")

    class Controller:
        def __init__(self) -> None:
            self.actions: list[str] = []

        def tap(self, button: str) -> None:
            self.actions.append(button)

        def chord(self, *buttons: str) -> None:
            self.actions.append("+".join(buttons))

    class Clock:
        value = 0.0

        def __call__(self) -> float:
            self.value += 1
            return self.value

    controller = Controller()
    result = SluggersBootNavigator(
        frame_reader=Reader(),  # type: ignore[arg-type]
        controller=controller,
        has_existing_save=True,
        menu_observer=Observer(),
    ).navigate_to_main_menu(monotonic=Clock(), sleep=lambda _seconds: None)

    assert result.observed_frames == 0
    assert result.semantic_observations == 6
    assert controller.actions == ["A", "A+B", "D_LEFT", "A", "A"]


def test_navigator_never_returns_to_xfb_after_semantic_startup() -> None:
    observations: list[MenuObservation | Exception] = [
        MenuObservation(
            scene=MenuScene.INTRO_MOVIE,
            root_descriptor=OPENING_TASK_DESCRIPTOR,
            root_active=True,
            root_state=4,
        ),
        BridgeProtocolError("transient semantic read"),
        MenuObservation(
            scene=MenuScene.UNKNOWN,
            root_descriptor=0x80000000,
            root_active=True,
            root_state=None,
        ),
        MenuObservation(
            scene=MenuScene.MAIN_MODE,
            root_descriptor=SELECT_TASK_DESCRIPTOR,
            root_active=True,
            root_state=7,
            child_descriptor=MAIN_MODE_TASK_DESCRIPTOR,
            child_state=4,
            main_mode_selection=0,
        ),
    ]

    class Observer:
        def read(self) -> MenuObservation:
            value = observations.pop(0)
            if isinstance(value, Exception):
                raise value
            return value

    class Reader:
        def read(self):
            raise AssertionError("XFB was revived after semantic startup")

    class Controller:
        def tap(self, _button: str) -> None:
            pass

        def chord(self, *_buttons: str) -> None:
            pass

    class Clock:
        value = 0.0

        def __call__(self) -> float:
            self.value += 1
            return self.value

    result = SluggersBootNavigator(
        frame_reader=Reader(),  # type: ignore[arg-type]
        controller=Controller(),
        has_existing_save=True,
        menu_observer=Observer(),
    ).navigate_to_main_menu(monotonic=Clock(), sleep=lambda _seconds: None)

    assert result.observed_frames == 0
    assert result.semantic_observations == 2


def test_navigator_normalizes_main_cursor_before_entering_exhibition() -> None:
    observations = iter(
        [
            MenuObservation(
                scene=MenuScene.MAIN_MODE,
                root_descriptor=SELECT_TASK_DESCRIPTOR,
                root_active=True,
                root_state=7,
                child_descriptor=MAIN_MODE_TASK_DESCRIPTOR,
                child_state=4,
                main_mode_selection=2,
            ),
            MenuObservation(
                scene=MenuScene.MAIN_MODE,
                root_descriptor=SELECT_TASK_DESCRIPTOR,
                root_active=True,
                root_state=7,
                child_descriptor=MAIN_MODE_TASK_DESCRIPTOR,
                child_state=4,
                main_mode_selection=2,
            ),
            MenuObservation(
                scene=MenuScene.MAIN_MODE,
                root_descriptor=SELECT_TASK_DESCRIPTOR,
                root_active=True,
                root_state=7,
                child_descriptor=MAIN_MODE_TASK_DESCRIPTOR,
                child_state=4,
                main_mode_selection=2,
            ),
            MenuObservation(
                scene=MenuScene.MAIN_MODE,
                root_descriptor=SELECT_TASK_DESCRIPTOR,
                root_active=True,
                root_state=7,
                child_descriptor=MAIN_MODE_TASK_DESCRIPTOR,
                child_state=4,
                main_mode_selection=1,
            ),
            MenuObservation(
                scene=MenuScene.MAIN_MODE,
                root_descriptor=SELECT_TASK_DESCRIPTOR,
                root_active=True,
                root_state=7,
                child_descriptor=MAIN_MODE_TASK_DESCRIPTOR,
                child_state=4,
                main_mode_selection=1,
            ),
            MenuObservation(
                scene=MenuScene.MAIN_MODE,
                root_descriptor=SELECT_TASK_DESCRIPTOR,
                root_active=True,
                root_state=7,
                child_descriptor=MAIN_MODE_TASK_DESCRIPTOR,
                child_state=4,
                main_mode_selection=0,
            ),
            MenuObservation(
                scene=MenuScene.MAIN_MODE,
                root_descriptor=SELECT_TASK_DESCRIPTOR,
                root_active=True,
                root_state=7,
                child_descriptor=MAIN_MODE_TASK_DESCRIPTOR,
                child_state=4,
                main_mode_selection=0,
            ),
            # The selection word alone is not success. After A, the mode task
            # closes through states 8 and 9 before the distinct stadium task
            # exists. The navigator must continue observing both transitions.
            MenuObservation(
                scene=MenuScene.MAIN_MODE,
                root_descriptor=SELECT_TASK_DESCRIPTOR,
                root_active=True,
                root_state=7,
                child_descriptor=MAIN_MODE_TASK_DESCRIPTOR,
                child_state=8,
                main_mode_selection=0,
                main_mode_result=1,
            ),
            MenuObservation(
                scene=MenuScene.MAIN_MODE,
                root_descriptor=SELECT_TASK_DESCRIPTOR,
                root_active=True,
                root_state=7,
                child_descriptor=MAIN_MODE_TASK_DESCRIPTOR,
                child_state=9,
                main_mode_selection=0,
                main_mode_result=1,
            ),
            MenuObservation(
                scene=MenuScene.STADIUM_SELECT,
                root_descriptor=SELECT_TASK_DESCRIPTOR,
                root_active=True,
                root_state=7,
                child_descriptor=MAIN_STADIUM_TASK_DESCRIPTOR,
                child_state=1,
                stadium_selection=0,
            ),
        ]
    )

    class Observer:
        def read(self) -> MenuObservation:
            return next(observations)

    class Reader:
        def read(self):
            raise AssertionError("XFB must not be read at the semantic main menu")

    class Controller:
        def __init__(self) -> None:
            self.actions: list[str] = []

        def tap(self, button: str) -> None:
            self.actions.append(button)

        def chord(self, *buttons: str) -> None:
            self.actions.append("+".join(buttons))

    class Clock:
        value = 0.0

        def __call__(self) -> float:
            self.value += 0.4
            return self.value

    controller = Controller()
    result = SluggersBootNavigator(
        frame_reader=Reader(),  # type: ignore[arg-type]
        controller=controller,
        has_existing_save=True,
        menu_observer=Observer(),
    ).navigate_to_exhibition_stadium(monotonic=Clock(), sleep=lambda _seconds: None)

    assert result.semantic_observations == 10
    assert controller.actions == ["D_LEFT", "D_LEFT", "A"]


def test_navigator_rejects_a_committed_minigames_destination() -> None:
    observations = iter(
        [
            MenuObservation(
                scene=MenuScene.MAIN_MODE,
                root_descriptor=SELECT_TASK_DESCRIPTOR,
                root_active=True,
                root_state=7,
                child_descriptor=MAIN_MODE_TASK_DESCRIPTOR,
                child_state=4,
                main_mode_selection=0,
            ),
            MenuObservation(
                scene=MenuScene.MAIN_MODE,
                root_descriptor=SELECT_TASK_DESCRIPTOR,
                root_active=True,
                root_state=7,
                child_descriptor=MAIN_MODE_TASK_DESCRIPTOR,
                child_state=4,
                main_mode_selection=0,
            ),
            MenuObservation(
                scene=MenuScene.MAIN_MODE,
                root_descriptor=SELECT_TASK_DESCRIPTOR,
                root_active=True,
                root_state=7,
                child_descriptor=MAIN_MODE_TASK_DESCRIPTOR,
                child_state=4,
                main_mode_selection=0,
            ),
            MenuObservation(
                scene=MenuScene.MAIN_MODE,
                root_descriptor=SELECT_TASK_DESCRIPTOR,
                root_active=True,
                root_state=7,
                child_descriptor=MAIN_MODE_TASK_DESCRIPTOR,
                child_state=7,
                main_mode_selection=2,
                main_mode_result=3,
            ),
        ]
    )

    class Observer:
        def read(self) -> MenuObservation:
            return next(observations)

    class Reader:
        def read(self):
            raise AssertionError("XFB must not be read at the semantic main menu")

    class Controller:
        def tap(self, _button: str) -> None:
            pass

        def chord(self, *_buttons: str) -> None:
            pass

    class Clock:
        value = 0.0

        def __call__(self) -> float:
            self.value += 0.4
            return self.value

    navigator = SluggersBootNavigator(
        frame_reader=Reader(),  # type: ignore[arg-type]
        controller=Controller(),
        has_existing_save=True,
        menu_observer=Observer(),
    )

    with pytest.raises(DolphinLaunchError, match="wrong main-menu destination"):
        navigator.navigate_to_exhibition_stadium(
            monotonic=Clock(), sleep=lambda _seconds: None
        )
