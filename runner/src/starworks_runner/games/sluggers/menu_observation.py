from __future__ import annotations

from dataclasses import dataclass
from enum import IntEnum, StrEnum
from typing import Protocol

from starworks_runner.games.sluggers.bridge.layout import BridgeProtocolError
from starworks_runner.games.sluggers.task_graph import SluggersTaskGraphReader


class MemoryReader(Protocol):
    def read(self, address: int, size: int) -> bytes: ...


# Exact-RMBE01 task objects and descriptors. See
# docs/game-adapter/menu-observation.md for constructor, switch, and live
# provenance. Unknown descriptors and states remain explicit and fail closed.
ROOT_TASK_ADDRESS = 0x900D4994
FILE_TASK_ADDRESS = 0x9032B134
# The main selector swaps different task classes into this same object address.
# The descriptor must therefore be checked before interpreting any fields.
MAIN_SELECTION_TASK_ADDRESS = 0x9032CF14
# Compatibility name for callers written before the stadium task was mapped.
MAIN_MODE_TASK_ADDRESS = MAIN_SELECTION_TASK_ADDRESS
FILE_SELECTION_ADDRESS = 0x807956BC  # r13 (0x807961C0) - 0xB04

SYSTEM_TASK_DESCRIPTOR = 0x806E1580
OPENING_TASK_DESCRIPTOR = 0x806CC8E8
TITLE_TASK_DESCRIPTOR = 0x806DA010
FILE_TASK_DESCRIPTOR = 0x806A2640
SELECT_TASK_DESCRIPTOR = 0x806D7E98
MAIN_MODE_TASK_DESCRIPTOR = 0x806BEE58
MAIN_SELECTION_ROOT_TASK_DESCRIPTOR = 0x806BEF60
MAIN_STADIUM_TASK_DESCRIPTOR = 0x806BF350
MAIN_STADIUM_CONFIRM_TASK_DESCRIPTOR = 0x806BF1D0
MAIN_SELECTION_LEAF_DESCRIPTORS = {
    MAIN_MODE_TASK_DESCRIPTOR,
    MAIN_STADIUM_TASK_DESCRIPTOR,
    MAIN_STADIUM_CONFIRM_TASK_DESCRIPTOR,
}


class MenuScene(StrEnum):
    SYSTEM_STARTUP = "system-startup"
    OPENING_LOADING = "opening-loading"
    INTRO_MOVIE = "intro-movie"
    TITLE = "title"
    FILE_LOADING = "file-loading"
    FILE_SELECT = "file-select"
    FILE_ACTION = "file-action"
    OPENING_TRANSITION = "opening-transition"
    SELECT_LOADING = "select-loading"
    MAIN_MODE = "main-mode"
    STADIUM_SELECT = "stadium-select"
    STADIUM_CONFIRM = "stadium-confirm"
    EXHIBITION = "exhibition"
    TRAINING = "training"
    MINIGAMES = "minigames"
    CHALLENGE = "challenge"
    RECORDS = "records"
    GRAND_PRIX = "grand-prix"
    SELECT_TRANSITION = "select-transition"
    UNKNOWN = "unknown"


class OpeningState(IntEnum):
    START = 0
    LOAD_LAYOUT = 1
    WAIT_FOR_LAYOUT = 2
    CREATE_INTRO = 3
    INTRO = 4
    CREATE_TITLE = 5
    TITLE = 6
    CREATE_FILE_SELECT = 7
    CREATE_FILE_SELECT_ALTERNATE = 8
    FILE_SELECT = 9
    CREATE_OPTIONS = 10
    OPTIONS = 11
    CREATE_MISC = 12
    MISC = 13
    EXIT_TO_SELECT = 14
    EXIT_ALTERNATE = 15


class SelectState(IntEnum):
    START = 0
    INITIALIZE = 1
    WAIT_FOR_INITIALIZE = 2
    LOAD_LAYOUT = 3
    WAIT_FOR_LAYOUT = 4
    PREPARE_MAIN_MODE = 5
    CREATE_MAIN_MODE = 6
    MAIN_MODE = 7
    CLOSE_MAIN_MODE = 8
    WAIT_FOR_CLOSE = 9
    CREATE_EXHIBITION = 10
    EXHIBITION = 11
    CREATE_TRAINING = 12
    TRAINING = 13
    CREATE_MINIGAMES = 14
    MINIGAMES = 15
    CREATE_CHALLENGE = 16
    CHALLENGE = 17
    CREATE_RECORDS = 18
    RECORDS = 19
    CREATE_GRAND_PRIX = 20
    GRAND_PRIX = 21
    PREPARE_EXIT = 22
    WAIT_FOR_EXIT = 23
    EXIT = 24


class MainModeSelection(IntEnum):
    # CMainSelModeTask returns selection + 1. CSelectTask's state-7 switch
    # maps those results to the concrete child tasks at 0x804A70B0.
    EXHIBITION = 0
    CHALLENGE = 1
    MINIGAME_PRIMARY = 2
    MINIGAME_SECONDARY = 3
    TRAINING = 4
    RECORDS = 5


@dataclass(frozen=True)
class MenuObservation:
    scene: MenuScene
    root_descriptor: int
    root_active: bool
    root_state: int | None
    child_descriptor: int | None = None
    child_state: int | None = None
    file_selection: int | None = None
    main_mode_selection: int | None = None
    main_mode_result: int | None = None
    stadium_selection: int | None = None
    stadium_previous_selection: int | None = None
    stadium_context: int | None = None
    stadium_result: int | None = None
    stadium_confirmation_selection: int | None = None

    @property
    def is_file_one_selected(self) -> bool:
        return self.scene is MenuScene.FILE_SELECT and self.file_selection == 0

    @property
    def is_main_mode_ready(self) -> bool:
        return (
            self.scene is MenuScene.MAIN_MODE
            and self.child_descriptor == MAIN_MODE_TASK_DESCRIPTOR
            and self.child_state == 4
            and self.main_mode_selection is not None
        )

    @property
    def is_exhibition_selected(self) -> bool:
        return (
            self.is_main_mode_ready
            and self.main_mode_selection == MainModeSelection.EXHIBITION
        )

    @property
    def is_stadium_ready(self) -> bool:
        return (
            self.scene is MenuScene.STADIUM_SELECT
            and self.child_descriptor == MAIN_STADIUM_TASK_DESCRIPTOR
            and self.child_state == 1
            and self.stadium_selection is not None
        )

    @property
    def is_stadium_confirmation_ready(self) -> bool:
        return (
            self.scene is MenuScene.STADIUM_CONFIRM
            and self.child_descriptor == MAIN_STADIUM_CONFIRM_TASK_DESCRIPTOR
            and self.child_state == 2
            and self.stadium_confirmation_selection == 0
        )


class SluggersMenuObserver:
    """Read the game's semantic menu state without interpreting rendered pixels."""

    def __init__(self, transport: MemoryReader) -> None:
        self.transport = transport

    def read(self) -> MenuObservation:
        root = self._read(ROOT_TASK_ADDRESS, 0x10, "root task")
        descriptor = int.from_bytes(root[4:8], "big")
        active = root[0] == 0
        if descriptor == SYSTEM_TASK_DESCRIPTOR:
            return MenuObservation(
                scene=MenuScene.SYSTEM_STARTUP,
                root_descriptor=descriptor,
                root_active=active,
                root_state=None,
            )
        if descriptor == OPENING_TASK_DESCRIPTOR:
            return self._read_opening(root, active=active)
        if descriptor == SELECT_TASK_DESCRIPTOR:
            return self._read_select(root, active=active)
        return MenuObservation(
            scene=MenuScene.UNKNOWN,
            root_descriptor=descriptor,
            root_active=active,
            root_state=None,
        )

    def _read_opening(self, root: bytes, *, active: bool) -> MenuObservation:
        state = root[9]
        scene = {
            OpeningState.INTRO: MenuScene.INTRO_MOVIE,
            OpeningState.TITLE: MenuScene.TITLE,
        }.get(_opening_state(state), MenuScene.OPENING_LOADING)
        child_descriptor = None
        child_state = None
        file_selection = None
        if state == OpeningState.FILE_SELECT:
            child = self._read(FILE_TASK_ADDRESS, 0x20, "opening child task")
            child_descriptor = int.from_bytes(child[4:8], "big")
            if child_descriptor == FILE_TASK_DESCRIPTOR:
                child_state = child[0x1C]
                if child_state < 6:
                    scene = MenuScene.FILE_LOADING
                elif child_state == 6:
                    scene = MenuScene.FILE_SELECT
                    file_selection = int.from_bytes(
                        self._read(FILE_SELECTION_ADDRESS, 4, "file selection"),
                        "big",
                        signed=True,
                    )
                elif child_state < 0x1D:
                    scene = MenuScene.FILE_ACTION
                else:
                    scene = MenuScene.OPENING_TRANSITION
            else:
                scene = MenuScene.OPENING_TRANSITION
        elif state > OpeningState.TITLE:
            scene = MenuScene.OPENING_TRANSITION
        return MenuObservation(
            scene=scene,
            root_descriptor=OPENING_TASK_DESCRIPTOR,
            root_active=active,
            root_state=state,
            child_descriptor=child_descriptor,
            child_state=child_state,
            file_selection=file_selection,
        )

    def _read_select(self, root: bytes, *, active: bool) -> MenuObservation:
        state = root[0x0C]
        scene = {
            SelectState.MAIN_MODE: MenuScene.MAIN_MODE,
            SelectState.EXHIBITION: MenuScene.EXHIBITION,
            SelectState.TRAINING: MenuScene.TRAINING,
            SelectState.MINIGAMES: MenuScene.MINIGAMES,
            SelectState.CHALLENGE: MenuScene.CHALLENGE,
            SelectState.RECORDS: MenuScene.RECORDS,
            SelectState.GRAND_PRIX: MenuScene.GRAND_PRIX,
        }.get(_select_state(state), MenuScene.SELECT_LOADING)
        child_descriptor = None
        child_state = None
        main_mode_selection = None
        main_mode_result = None
        stadium_selection = None
        stadium_previous_selection = None
        stadium_context = None
        stadium_result = None
        stadium_confirmation_selection = None
        if state == SelectState.MAIN_MODE:
            child = self._read_main_selection_task()
            child_descriptor = int.from_bytes(child[4:8], "big")
            if child_descriptor == MAIN_MODE_TASK_DESCRIPTOR:
                child_state = child[0x1C]
                # CMainSelModeTask commits selection + 1 here when A is
                # accepted. Unlike +0x30, this is not merely the currently
                # hovered carousel tile.
                main_mode_result = int.from_bytes(child[0x20:0x24], "big", signed=True)
                main_mode_selection = int.from_bytes(
                    child[0x30:0x34], "big", signed=True
                )
            elif child_descriptor == MAIN_STADIUM_TASK_DESCRIPTOR:
                # Reverse-engineered from CMainSelStadiumTask::update at
                # 0x803A41FC. Substate 1 accepts directional/A/B input;
                # +0x30 is the live selection and +0x2C the last stable one.
                scene = MenuScene.STADIUM_SELECT
                child_state = child[0x21]
                stadium_context = int.from_bytes(child[0x1C:0x20], "big", signed=True)
                stadium_result = int.from_bytes(child[0x24:0x28], "big", signed=True)
                stadium_previous_selection = int.from_bytes(
                    child[0x2C:0x30], "big", signed=True
                )
                stadium_selection = int.from_bytes(child[0x30:0x34], "big", signed=True)
            elif child_descriptor == MAIN_STADIUM_CONFIRM_TASK_DESCRIPTOR:
                # CMainSelSetumeiTask is the stadium explanation/confirmation
                # panel. Its state 2 accepts input; option 0 is the affirmative
                # action that continues into Exhibition.
                scene = MenuScene.STADIUM_CONFIRM
                child_state = child[0x19]
                stadium_confirmation_selection = int.from_bytes(
                    child[0x2C:0x30], "big", signed=True
                )
            else:
                scene = MenuScene.SELECT_TRANSITION
        elif state > SelectState.MAIN_MODE:
            scene = {
                SelectState.EXHIBITION: MenuScene.EXHIBITION,
                SelectState.TRAINING: MenuScene.TRAINING,
                SelectState.MINIGAMES: MenuScene.MINIGAMES,
                SelectState.CHALLENGE: MenuScene.CHALLENGE,
                SelectState.RECORDS: MenuScene.RECORDS,
                SelectState.GRAND_PRIX: MenuScene.GRAND_PRIX,
            }.get(_select_state(state), MenuScene.SELECT_TRANSITION)
        return MenuObservation(
            scene=scene,
            root_descriptor=SELECT_TASK_DESCRIPTOR,
            root_active=active,
            root_state=state,
            child_descriptor=child_descriptor,
            child_state=child_state,
            main_mode_selection=main_mode_selection,
            main_mode_result=main_mode_result,
            stadium_selection=stadium_selection,
            stadium_previous_selection=stadium_previous_selection,
            stadium_context=stadium_context,
            stadium_result=stadium_result,
            stadium_confirmation_selection=stadium_confirmation_selection,
        )

    def _read_main_selection_task(self) -> bytes:
        """Resolve the active leaf through the registry after savestate moves."""

        child = self._read(MAIN_SELECTION_TASK_ADDRESS, 0x34, "main selection task")
        descriptor = int.from_bytes(child[4:8], "big")
        if descriptor in MAIN_SELECTION_LEAF_DESCRIPTORS:
            return child
        if descriptor != MAIN_SELECTION_ROOT_TASK_DESCRIPTOR:
            return child

        candidates = [
            task
            for task in SluggersTaskGraphReader(self.transport).read()
            if task.active and task.descriptor in MAIN_SELECTION_LEAF_DESCRIPTORS
        ]
        if len(candidates) > 1:
            addresses = ", ".join(f"0x{task.task_address:08X}" for task in candidates)
            raise BridgeProtocolError(
                f"Sluggers registered multiple active main-selection tasks: {addresses}"
            )
        if not candidates:
            return child
        return self._read(
            candidates[0].task_address,
            0x34,
            "registered main selection task",
        )

    def _read(self, address: int, size: int, label: str) -> bytes:
        value = self.transport.read(address, size)
        if len(value) != size:
            raise BridgeProtocolError(f"Sluggers {label} read was short")
        return value


def _opening_state(value: int) -> OpeningState | None:
    try:
        return OpeningState(value)
    except ValueError:
        return None


def _select_state(value: int) -> SelectState | None:
    try:
        return SelectState(value)
    except ValueError:
        return None
