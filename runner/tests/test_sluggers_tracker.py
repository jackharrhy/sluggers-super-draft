from __future__ import annotations

import pytest
from starworks_runner.games.sluggers.tracker import (
    BATTER_BLOCK_ADDRESS,
    BATTER_BLOCK_END,
    GAME_TIMER_ADDRESS,
    GAMEPLAY_BLOCK_ADDRESS,
    GAMEPLAY_BLOCK_END,
    PITCHER_BLOCK_ADDRESS,
    PITCHER_BLOCK_END,
    GameSnapshot,
    SluggersGameTracker,
    SluggersMemoryReader,
)


class FakeMemory:
    def __init__(self) -> None:
        self.values: dict[tuple[int, int], bytes] = {}
        self.reads: list[tuple[int, int]] = []

    def read(self, address: int, size: int) -> bytes:
        self.reads.append((address, size))
        return self.values.get((address, size), bytes(size))

    def write(self, address: int, value: bytes) -> None:
        raise AssertionError("The game tracker must be read-only")


def snapshot(**overrides: int) -> GameSnapshot:
    values = {
        "frame": 100,
        "state": 0x01,
        "inning": 1,
        "half": 0,
        "away_score": 0,
        "home_score": 0,
        "away_hits": 0,
        "home_hits": 0,
        "balls": 0,
        "strikes": 0,
        "outs": 0,
        "pitches": 0,
        "batter_game_id": 0,
        "pitcher_game_id": 1,
        "runs_this_play": 0,
        "outs_this_play": 0,
    }
    values.update(overrides)
    return GameSnapshot(**values)


def tracker() -> SluggersGameTracker:
    return SluggersGameTracker(
        away_team_id="away-team",
        home_team_id="home-team",
        character_ids={0: "mario", 1: "luigi", 2: "donkey-kong"},
    )


def test_memory_reader_uses_four_contiguous_read_only_blocks() -> None:
    memory = FakeMemory()
    gameplay = bytearray(GAMEPLAY_BLOCK_END - GAMEPLAY_BLOCK_ADDRESS)
    batter = bytearray(BATTER_BLOCK_END - BATTER_BLOCK_ADDRESS)
    pitcher = bytearray(PITCHER_BLOCK_END - PITCHER_BLOCK_ADDRESS)
    gameplay[0] = 2
    gameplay[1] = 3
    gameplay[2] = 1
    gameplay[0x181] = 0x01
    gameplay[0x2F0] = 4
    gameplay[0x2F1:0x2F3] = (7).to_bytes(2, "big")
    gameplay[0x30B:0x30D] = (5).to_bytes(2, "big")
    gameplay[0x326] = 9
    gameplay[0x340] = 8
    gameplay[0x37E] = 1
    gameplay[0x389] = 2
    gameplay[0x38A] = 1
    batter[0] = 6
    batter[0xC3] = 2
    pitcher[2] = 1
    memory.values[(GAMEPLAY_BLOCK_ADDRESS, len(gameplay))] = bytes(gameplay)
    memory.values[(BATTER_BLOCK_ADDRESS, len(batter))] = bytes(batter)
    memory.values[(PITCHER_BLOCK_ADDRESS, len(pitcher))] = bytes(pitcher)
    memory.values[(GAME_TIMER_ADDRESS, 4)] = (12345).to_bytes(4, "big")

    value = SluggersMemoryReader(memory).read()

    assert value == snapshot(
        frame=12345,
        inning=4,
        half=1,
        away_score=7,
        home_score=5,
        away_hits=9,
        home_hits=8,
        balls=3,
        strikes=2,
        outs=1,
        pitches=6,
        batter_game_id=2,
        pitcher_game_id=1,
        runs_this_play=2,
        outs_this_play=1,
    )
    assert memory.reads == [
        (GAMEPLAY_BLOCK_ADDRESS, GAMEPLAY_BLOCK_END - GAMEPLAY_BLOCK_ADDRESS),
        (BATTER_BLOCK_ADDRESS, BATTER_BLOCK_END - BATTER_BLOCK_ADDRESS),
        (PITCHER_BLOCK_ADDRESS, PITCHER_BLOCK_END - PITCHER_BLOCK_ADDRESS),
        (GAME_TIMER_ADDRESS, 4),
    ]


def test_tracker_emits_lifecycle_inning_and_character_changes_once() -> None:
    game = tracker()

    assert game.observe(snapshot(state=0, inning=0, half=0)) == []
    started = game.observe(snapshot())
    assert [event.event_type for event in started] == [
        "game-started",
        "inning-started",
        "batter-changed",
        "pitcher-changed",
    ]
    assert [event.sequence for event in started] == [1, 2, 3, 4]
    assert game.observe(snapshot(frame=101)) == []

    bottom = game.observe(
        snapshot(
            frame=200,
            half=1,
            batter_game_id=2,
            pitcher_game_id=0,
        )
    )
    assert [event.event_type for event in bottom] == [
        "inning-started",
        "batter-changed",
        "pitcher-changed",
    ]
    assert bottom[1].payload == {"characterId": "donkey-kong", "side": "home"}
    assert bottom[2].payload == {"characterId": "mario", "side": "away"}


def test_tracker_does_not_publish_placeholder_players_during_intro() -> None:
    game = tracker()

    events = game.observe(
        snapshot(
            state=0x04,
            inning=1,
            batter_game_id=0,
            pitcher_game_id=0,
        )
    )

    assert [event.event_type for event in events] == [
        "game-started",
        "inning-started",
    ]

    # A transient load state must not suppress the first real matchup or cause
    # the inning to be announced twice.
    assert game.observe(snapshot(frame=101, state=0)) == []
    playing = game.observe(snapshot(frame=102, batter_game_id=0, pitcher_game_id=1))
    assert [event.event_type for event in playing] == [
        "batter-changed",
        "pitcher-changed",
    ]


def test_tracker_ignores_load_boundaries_and_scoreboard_replay_regressions() -> None:
    game = tracker()
    game.observe(snapshot(away_score=1, away_hits=2))

    assert (
        game.observe(
            snapshot(
                frame=200,
                state=0,
                away_score=0,
                away_hits=0,
            )
        )
        == []
    )
    assert (
        game.observe(
            snapshot(
                frame=201,
                away_score=0,
                away_hits=0,
            )
        )
        == []
    )

    assert game.last is not None
    assert game.last.away_score == 1
    assert game.last.away_hits == 2


def test_tracker_emits_one_final_score_and_can_restore_state() -> None:
    game = tracker()
    game.observe(snapshot())
    saved = game.state()
    restored = tracker()
    restored.restore(saved)

    ended = restored.observe(
        snapshot(frame=900, state=0x09, away_score=7, home_score=5)
    )

    assert [event.event_type for event in ended] == ["game-ended"]
    assert ended[0].sequence == 5
    assert ended[0].payload == {
        "awayRuns": 7,
        "homeRuns": 5,
        "reason": "completed",
    }
    assert restored.observe(snapshot(frame=901, state=0x0E)) == []


def test_tracker_rejects_malformed_saved_state() -> None:
    with pytest.raises(Exception, match="unknown fields"):
        tracker().restore({"sequence": 1})
