from __future__ import annotations

import json

import pytest
from starworks_runner.games.sluggers.game_observation import (
    BASES_ADVANCED_ADDRESS,
    BATTER_BLOCK_ADDRESS,
    BATTER_BLOCK_END,
    GAME_TIMER_ADDRESS,
    GAMEPLAY_BLOCK_ADDRESS,
    GAMEPLAY_BLOCK_END,
    HOME_RUN_ADDRESS,
    PITCHER_BLOCK_ADDRESS,
    PITCHER_BLOCK_END,
    RUNNER_INDEX_BLOCK_ADDRESS,
    RUNNER_INDEX_BLOCK_END,
    GameSnapshot,
    SluggersMemoryReader,
)
from starworks_runner.games.sluggers.tracker import SluggersGameTracker


class FakeMemory:
    def __init__(self) -> None:
        self.values: dict[tuple[int, int], bytes] = {}
        self.reads: list[tuple[int, int]] = []

    def read(self, address: int, size: int) -> bytes:
        self.reads.append((address, size))
        return self.values.get((address, size), bytes(size))

    def write(self, address: int, value: bytes) -> None:
        raise AssertionError("The game tracker must be read-only")


def snapshot(**overrides: int | tuple[int, int, int]) -> GameSnapshot:
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
        "bases_advanced": 0,
        "ball_was_hit": 0,
        "bean_ball": 0,
        "home_run": 0,
        "base_runner_indices": (-1, -1, -1),
    }
    values.update(overrides)
    return GameSnapshot(**values)


def tracker() -> SluggersGameTracker:
    return SluggersGameTracker(
        away_team_id="away-team",
        home_team_id="home-team",
        character_ids={0: "mario", 1: "luigi", 2: "donkey-kong"},
        away_batting_order=(
            "mario",
            "luigi",
            "donkey-kong",
            "away-4",
            "away-5",
            "away-6",
            "away-7",
            "away-8",
            "away-9",
        ),
        home_batting_order=tuple(f"home-{index}" for index in range(1, 10)),
    )


def test_memory_reader_uses_bounded_read_only_blocks() -> None:
    memory = FakeMemory()
    gameplay = bytearray(GAMEPLAY_BLOCK_END - GAMEPLAY_BLOCK_ADDRESS)
    batter = bytearray(BATTER_BLOCK_END - BATTER_BLOCK_ADDRESS)
    pitcher = bytearray(PITCHER_BLOCK_END - PITCHER_BLOCK_ADDRESS)
    runner_indices = bytearray(RUNNER_INDEX_BLOCK_END - RUNNER_INDEX_BLOCK_ADDRESS)
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
    batter[0x168] = 1
    batter[0x169] = 1
    pitcher[2] = 1
    runner_indices[0] = 4
    runner_indices[0x1D4] = 0xFF
    runner_indices[0x3A8] = 7
    memory.values[(GAMEPLAY_BLOCK_ADDRESS, len(gameplay))] = bytes(gameplay)
    memory.values[(BATTER_BLOCK_ADDRESS, len(batter))] = bytes(batter)
    memory.values[(PITCHER_BLOCK_ADDRESS, len(pitcher))] = bytes(pitcher)
    memory.values[(GAME_TIMER_ADDRESS, 4)] = (12345).to_bytes(4, "big")
    memory.values[(BASES_ADVANCED_ADDRESS, 1)] = (2).to_bytes(1, "big", signed=True)
    memory.values[(HOME_RUN_ADDRESS, 1)] = b"\x01"
    memory.values[(RUNNER_INDEX_BLOCK_ADDRESS, len(runner_indices))] = bytes(
        runner_indices
    )

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
        bases_advanced=2,
        ball_was_hit=1,
        bean_ball=1,
        home_run=1,
        base_runner_indices=(4, -1, 7),
    )
    assert memory.reads == [
        (GAMEPLAY_BLOCK_ADDRESS, GAMEPLAY_BLOCK_END - GAMEPLAY_BLOCK_ADDRESS),
        (BATTER_BLOCK_ADDRESS, BATTER_BLOCK_END - BATTER_BLOCK_ADDRESS),
        (PITCHER_BLOCK_ADDRESS, PITCHER_BLOCK_END - PITCHER_BLOCK_ADDRESS),
        (GAME_TIMER_ADDRESS, 4),
        (BASES_ADVANCED_ADDRESS, 1),
        (HOME_RUN_ADDRESS, 1),
        (
            RUNNER_INDEX_BLOCK_ADDRESS,
            RUNNER_INDEX_BLOCK_END - RUNNER_INDEX_BLOCK_ADDRESS,
        ),
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
    saved = json.loads(json.dumps(game.state()))
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


@pytest.mark.parametrize(
    ("during", "result"),
    [
        ({"balls": 4, "pitches": 4}, "walk"),
        ({"strikes": 3, "pitches": 3}, "strikeout"),
        ({"bean_ball": 1, "pitches": 1}, "hit-by-pitch"),
        (
            {
                "away_hits": 1,
                "ball_was_hit": 1,
                "bases_advanced": 2,
                "pitches": 1,
            },
            "double",
        ),
        ({"ball_was_hit": 1, "outs_this_play": 1, "pitches": 1}, "out"),
    ],
)
def test_tracker_resolves_supported_scoreless_appearances(
    during: dict[str, int], result: str
) -> None:
    game = tracker()
    game.observe(snapshot())
    game.observe(snapshot(frame=101, **during))

    events = game.observe(
        snapshot(frame=102, batter_game_id=2, away_hits=during.get("away_hits", 0))
    )

    assert events[0].event_type == "plate-appearance-ended"
    assert events[0].payload == {
        "batterCharacterId": "mario",
        "battingSide": "away",
        "errorByCharacterId": None,
        "outsRecorded": during.get("outs_this_play", 0),
        "pitcherCharacterId": "luigi",
        "result": result,
        "rbi": 0,
        "scorerCharacterIds": [],
    }
    assert events[1].event_type == "batter-changed"


def test_new_batter_waits_for_previous_play_fields_to_clear() -> None:
    game = tracker()
    game.observe(snapshot())
    game.observe(
        snapshot(
            frame=150,
            ball_was_hit=1,
            outs=1,
            outs_this_play=1,
            pitches=1,
        )
    )

    first_boundary = game.observe(
        snapshot(
            frame=200,
            batter_game_id=1,
            ball_was_hit=1,
            outs=1,
            outs_this_play=1,
        )
    )
    assert first_boundary[0].event_type == "plate-appearance-ended"
    assert first_boundary[0].payload["outsRecorded"] == 1

    game.observe(snapshot(frame=210, batter_game_id=1, outs=1))
    game.observe(
        snapshot(
            frame=250,
            batter_game_id=1,
            away_hits=1,
            ball_was_hit=1,
            bases_advanced=1,
            outs=1,
            pitches=1,
        )
    )
    second_boundary = game.observe(
        snapshot(
            frame=300,
            batter_game_id=2,
            away_hits=1,
            ball_was_hit=1,
            bases_advanced=1,
            outs=1,
            outs_this_play=1,
        )
    )

    assert second_boundary[0].event_type == "plate-appearance-ended"
    assert second_boundary[0].payload["result"] == "single"
    assert second_boundary[0].payload["outsRecorded"] == 0
    assert game.pending_appearance is not None
    assert game.pending_appearance.awaiting_play_reset is True
    assert second_boundary[1].event_type == "batter-changed"


def test_final_appearance_precedes_the_next_half_inning() -> None:
    game = tracker()
    game.observe(snapshot())
    game.observe(
        snapshot(
            frame=150,
            ball_was_hit=1,
            outs_this_play=1,
            outs=3,
            pitches=1,
        )
    )

    events = game.observe(
        snapshot(
            frame=200,
            half=1,
            batter_game_id=2,
            pitcher_game_id=0,
        )
    )

    assert [event.event_type for event in events] == [
        "plate-appearance-ended",
        "inning-started",
        "batter-changed",
        "pitcher-changed",
    ]
    assert events[0].payload["battingSide"] == "away"
    assert events[1].payload == {"inning": 1, "half": "bottom"}


def test_tracker_withholds_ambiguous_scoring_appearance_and_warns() -> None:
    game = tracker()
    game.observe(snapshot())
    game.observe(
        snapshot(
            frame=101,
            away_score=2,
            away_hits=1,
            ball_was_hit=1,
            bases_advanced=2,
            runs_this_play=2,
            pitches=1,
        )
    )

    events = game.observe(
        snapshot(frame=102, batter_game_id=2, away_score=2, away_hits=1)
    )

    assert events[0].event_type == "bridge-warning"
    assert events[0].payload["code"] == "provisional-observation"
    assert "scorer and RBI attribution" in events[0].payload["message"]
    assert all(event.event_type != "plate-appearance-ended" for event in events)


def test_tracker_withholds_a_run_before_the_scoreboard_catches_up() -> None:
    game = tracker()
    game.observe(snapshot())
    game.observe(
        snapshot(
            frame=101,
            away_hits=1,
            ball_was_hit=1,
            bases_advanced=1,
            runs_this_play=1,
            pitches=1,
        )
    )

    events = game.observe(snapshot(frame=102, batter_game_id=2, away_hits=1))

    assert events[0].event_type == "bridge-warning"
    assert "scorer and RBI attribution" in events[0].payload["message"]
    assert all(event.event_type != "plate-appearance-ended" for event in events)


def test_tracker_attributes_a_bases_loaded_home_run_exactly() -> None:
    game = tracker()
    game.observe(snapshot(base_runner_indices=(1, 2, 3)))
    game.observe(
        snapshot(
            frame=101,
            away_score=4,
            away_hits=1,
            ball_was_hit=1,
            home_run=1,
            runs_this_play=4,
            pitches=1,
        )
    )

    events = game.observe(
        snapshot(frame=102, batter_game_id=2, away_score=4, away_hits=1)
    )

    assert events[0].event_type == "plate-appearance-ended"
    assert events[0].payload["result"] == "home-run"
    assert events[0].payload["rbi"] == 4
    assert events[0].payload["scorerCharacterIds"] == [
        "away-4",
        "donkey-kong",
        "luigi",
        "mario",
    ]


@pytest.mark.parametrize("result_fields", [{"balls": 4}, {"bean_ball": 1}])
def test_tracker_attributes_a_bases_loaded_force_run_exactly(
    result_fields: dict[str, int],
) -> None:
    game = tracker()
    game.observe(snapshot(base_runner_indices=(1, 2, 3)))
    game.observe(
        snapshot(
            frame=101,
            away_score=1,
            runs_this_play=1,
            pitches=1,
            **result_fields,
        )
    )

    events = game.observe(snapshot(frame=102, batter_game_id=2, away_score=1))

    assert events[0].event_type == "plate-appearance-ended"
    assert events[0].payload["rbi"] == 1
    assert events[0].payload["scorerCharacterIds"] == ["away-4"]


def test_tracker_withholds_scoring_when_a_runner_index_is_invalid() -> None:
    game = tracker()
    game.observe(snapshot(base_runner_indices=(1, 2, 12)))
    game.observe(
        snapshot(
            frame=101,
            away_score=4,
            away_hits=1,
            ball_was_hit=1,
            home_run=1,
            runs_this_play=4,
            pitches=1,
        )
    )

    events = game.observe(
        snapshot(frame=102, batter_game_id=2, away_score=4, away_hits=1)
    )

    assert events[0].event_type == "bridge-warning"
    assert all(event.event_type != "plate-appearance-ended" for event in events)


def test_tracker_restores_pending_appearance_without_duplicate_resolution() -> None:
    game = tracker()
    game.observe(snapshot())
    game.observe(snapshot(frame=101, strikes=3, pitches=3))
    restored = tracker()
    restored.restore(json.loads(json.dumps(game.state())))

    events = restored.observe(snapshot(frame=102, batter_game_id=2))

    assert [event.event_type for event in events[:2]] == [
        "plate-appearance-ended",
        "batter-changed",
    ]
    assert restored.observe(snapshot(frame=103, batter_game_id=2)) == []


def test_tracker_rejects_malformed_saved_state() -> None:
    with pytest.raises(Exception, match="unknown fields"):
        tracker().restore({"sequence": 1})

    game = tracker()
    game.observe(snapshot())
    saved = json.loads(json.dumps(game.state()))
    saved["last"]["base_runner_indices"] = [1, 2]
    with pytest.raises(Exception, match="snapshot is invalid"):
        tracker().restore(saved)
