from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

from starworks_runner.games.sluggers.bridge.memory import MemoryTransport
from starworks_runner.games.sluggers.errors import SluggersAdapterError

# Exact-RMBE01 research leads documented in
# docs/game-adapter/telemetry-discovery.md. Raw memory decoding stays isolated
# here so the semantic reducer does not become an address map.
# Runner-slot offsets were reconciled with trusted Sluggers Stat Tracker
# origin/main 72547b8909086b1bd2b4ba287afee4f61a1e963b and live DME evidence.
GAMEPLAY_BLOCK_ADDRESS = 0x900D5AA7
GAMEPLAY_BLOCK_END = 0x900D5E36
BATTER_BLOCK_ADDRESS = 0x900D692C
BATTER_BLOCK_END = 0x900D6A96
PITCHER_BLOCK_ADDRESS = 0x900D9B45
PITCHER_BLOCK_END = 0x900D9B48
GAME_TIMER_ADDRESS = 0x900DFCFC
BASES_ADVANCED_ADDRESS = 0x900D66D2
HOME_RUN_ADDRESS = 0x900D953C
RUNNER_INDEX_BLOCK_ADDRESS = 0x900DB7CD
RUNNER_INDEX_BLOCK_END = 0x900DBB76

INTRO_STATES = frozenset({0x04, 0x05})
PLAY_STATES = frozenset(
    {
        0x01,  # batting
        0x02,  # fielding
        0x03,  # mid-inning transition
        0x07,  # celebration
        0x08,  # load next batter
        0x0F,  # fielding transition
        0x13,  # home-run celebration
        0x14,  # home-run bases
        0x15,  # RBI celebration
        0x16,  # pre-pitch cutscene
    }
)
END_STATES = frozenset({0x09, 0x0E, 0x1B})

TeamSide = Literal["away", "home"]


@dataclass(frozen=True)
class GameSnapshot:
    frame: int
    state: int
    inning: int
    half: int
    away_score: int
    home_score: int
    away_hits: int
    home_hits: int
    balls: int
    strikes: int
    outs: int
    pitches: int
    batter_game_id: int
    pitcher_game_id: int
    runs_this_play: int
    outs_this_play: int
    bases_advanced: int = 0
    ball_was_hit: int = 0
    bean_ball: int = 0
    home_run: int = 0
    base_runner_indices: tuple[int, int, int] = (-1, -1, -1)

    @property
    def has_started(self) -> bool:
        if self.state in INTRO_STATES:
            return True
        return self.state in PLAY_STATES | END_STATES and 1 <= self.inning <= 99

    @property
    def has_ended(self) -> bool:
        return self.state in END_STATES

    @property
    def batting_side(self) -> TeamSide | None:
        if self.half == 0:
            return "away"
        if self.half == 1:
            return "home"
        return None


class SluggersMemoryReader:
    """Read one bounded semantic snapshot through Dolphin Memory Engine."""

    def __init__(self, transport: MemoryTransport) -> None:
        self.transport = transport

    def read(self) -> GameSnapshot:
        gameplay = self._read_block(GAMEPLAY_BLOCK_ADDRESS, GAMEPLAY_BLOCK_END)
        batter = self._read_block(BATTER_BLOCK_ADDRESS, BATTER_BLOCK_END)
        pitcher = self._read_block(PITCHER_BLOCK_ADDRESS, PITCHER_BLOCK_END)
        timer = self._read_block(GAME_TIMER_ADDRESS, GAME_TIMER_ADDRESS + 4)
        bases_advanced = self._read_block(
            BASES_ADVANCED_ADDRESS, BASES_ADVANCED_ADDRESS + 1
        )
        home_run = self._read_block(HOME_RUN_ADDRESS, HOME_RUN_ADDRESS + 1)
        runner_indices = self._read_block(
            RUNNER_INDEX_BLOCK_ADDRESS, RUNNER_INDEX_BLOCK_END
        )
        return GameSnapshot(
            frame=int.from_bytes(timer, "big"),
            state=gameplay[0x181],
            inning=gameplay[0x2F0],
            half=gameplay[0x37E],
            away_score=int.from_bytes(gameplay[0x2F1:0x2F3], "big"),
            home_score=int.from_bytes(gameplay[0x30B:0x30D], "big"),
            away_hits=gameplay[0x326],
            home_hits=gameplay[0x340],
            balls=gameplay[1],
            strikes=gameplay[0],
            outs=gameplay[2],
            pitches=batter[0],
            batter_game_id=batter[0xC3],
            pitcher_game_id=pitcher[2],
            runs_this_play=gameplay[0x389],
            outs_this_play=gameplay[0x38A],
            bases_advanced=int.from_bytes(bases_advanced, "big", signed=True),
            ball_was_hit=batter[0x168],
            bean_ball=int.from_bytes(batter[0x169:0x16A], "big", signed=True),
            home_run=home_run[0],
            base_runner_indices=tuple(
                int.from_bytes(
                    runner_indices[offset : offset + 1], "big", signed=True
                )
                for offset in (0, 0x1D4, 0x3A8)
            ),
        )

    def _read_block(self, start: int, end: int) -> bytes:
        expected = end - start
        value = self.transport.read(start, expected)
        if len(value) != expected:
            raise SluggersAdapterError(
                f"Dolphin returned a short game-memory read at 0x{start:08X}"
            )
        return value
