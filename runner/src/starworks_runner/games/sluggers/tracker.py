from __future__ import annotations

from dataclasses import asdict, dataclass, replace
from typing import Any, Literal

from starworks_runner.games.sluggers.bridge.configuration import (
    CHARACTER_GAME_IDS,
    CHARACTER_IDS,
)
from starworks_runner.games.sluggers.bridge.layout import BridgeProtocolError
from starworks_runner.games.sluggers.bridge.memory import MemoryTransport
from starworks_runner.games.sluggers.errors import SluggersAdapterError

# These addresses are exact-RMBE01 research leads documented in
# docs/game-adapter/telemetry-discovery.md. Keeping the reader here, rather than
# spreading addresses through the runner, gives us one narrow place to replace
# a lead when live trace evidence disproves it.
GAMEPLAY_BLOCK_ADDRESS = 0x900D5AA7
GAMEPLAY_BLOCK_END = 0x900D5E36
BATTER_BLOCK_ADDRESS = 0x900D692C
BATTER_BLOCK_END = 0x900D6A96
PITCHER_BLOCK_ADDRESS = 0x900D9B45
PITCHER_BLOCK_END = 0x900D9B48
GAME_TIMER_ADDRESS = 0x900DFCFC
BASES_ADVANCED_ADDRESS = 0x900D66D2
HOME_RUN_ADDRESS = 0x900D953C

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
TrackerEventType = Literal[
    "game-started",
    "inning-started",
    "batter-changed",
    "pitcher-changed",
    "plate-appearance-ended",
    "bridge-warning",
    "game-ended",
]


def match_character_ids(configuration: dict[str, Any]) -> dict[int, str]:
    """Map compact game IDs to this attempt's immutable character IDs."""

    result: dict[int, str] = {}
    for team in configuration["teams"]:
        for character_id in team["lineup"]["rosterCharacterIds"]:
            game_id = CHARACTER_GAME_IDS.get(character_id)
            if game_id is None:
                raise BridgeProtocolError(
                    f"Telemetry cannot map unsupported character {character_id}"
                )
            previous = result.setdefault(game_id, character_id)
            if previous != character_id:
                raise BridgeProtocolError(
                    f"Telemetry character aliases collide: {previous} and {character_id}"
                )
    return result


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


@dataclass(frozen=True)
class TrackerEvent:
    sequence: int
    frame: int
    event_type: TrackerEventType
    payload: dict[str, Any]


@dataclass
class PendingAppearance:
    batter_game_id: int
    pitcher_game_id: int
    batting_side: TeamSide
    start_score: int
    start_hits: int
    start_outs: int
    max_balls: int = 0
    max_strikes: int = 0
    max_pitches: int = 0
    max_bases_advanced: int = 0
    max_runs_this_play: int = 0
    max_outs_this_play: int = 0
    ball_was_hit: bool = False
    bean_ball: bool = False
    home_run: bool = False
    pitcher_changed: bool = False
    awaiting_play_reset: bool = True

    @property
    def has_activity(self) -> bool:
        return any(
            (
                self.max_balls,
                self.max_strikes,
                self.max_pitches,
                self.max_bases_advanced,
                self.max_runs_this_play,
                self.max_outs_this_play,
                self.ball_was_hit,
                self.bean_ball,
                self.home_run,
            )
        )


class SluggersMemoryReader:
    """Read the smallest useful live-game snapshot through DME.

    The fields are grouped into a few bounded reads. This is substantially
    cheaper and easier to trace than refreshing dozens of one-byte wrappers.
    """

    def __init__(self, transport: MemoryTransport) -> None:
        self.transport = transport

    def read(self) -> GameSnapshot:
        gameplay = self._read_block(GAMEPLAY_BLOCK_ADDRESS, GAMEPLAY_BLOCK_END)
        batter = self._read_block(BATTER_BLOCK_ADDRESS, BATTER_BLOCK_END)
        pitcher = self._read_block(PITCHER_BLOCK_ADDRESS, PITCHER_BLOCK_END)
        timer = self.transport.read(GAME_TIMER_ADDRESS, 4)
        bases_advanced = self.transport.read(BASES_ADVANCED_ADDRESS, 1)
        home_run = self.transport.read(HOME_RUN_ADDRESS, 1)
        if len(timer) != 4:
            raise SluggersAdapterError("Dolphin returned a short game-timer read")
        if len(bases_advanced) != 1:
            raise SluggersAdapterError("Dolphin returned a short bases-advanced read")
        if len(home_run) != 1:
            raise SluggersAdapterError("Dolphin returned a short home-run read")
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
        )

    def _read_block(self, start: int, end: int) -> bytes:
        expected = end - start
        value = self.transport.read(start, expected)
        if len(value) != expected:
            raise SluggersAdapterError(
                f"Dolphin returned a short game-memory read at 0x{start:08X}"
            )
        return value


class SluggersGameTracker:
    """Convert exact-build memory snapshots into a small semantic event stream."""

    def __init__(
        self,
        *,
        away_team_id: str,
        home_team_id: str,
        character_ids: dict[int, str],
    ) -> None:
        self.away_team_id = away_team_id
        self.home_team_id = home_team_id
        self.character_ids = dict(character_ids)
        self.last: GameSnapshot | None = None
        self.started = False
        self.ended = False
        self.sequence = 0
        self.pending_appearance: PendingAppearance | None = None

    def observe(self, snapshot: GameSnapshot) -> list[TrackerEvent]:
        events: list[TrackerEvent] = []
        if self.ended:
            return events

        # The same scoreboard bytes are reused while Sluggers enters a replay.
        # Runs and hits are cumulative within a game, so a decrease is never a
        # real game event. Retaining the last observed maximum keeps the final
        # score authoritative without following the legacy tracker's replay
        # pointer chain or spreading replay-specific branches through the
        # reducer.
        if self.last is not None:
            snapshot = replace(
                snapshot,
                away_score=max(self.last.away_score, snapshot.away_score),
                home_score=max(self.last.home_score, snapshot.home_score),
                away_hits=max(self.last.away_hits, snapshot.away_hits),
                home_hits=max(self.last.home_hits, snapshot.home_hits),
            )

        if not self.started and snapshot.has_started:
            self.started = True
            events.append(
                self._event(
                    snapshot,
                    "game-started",
                    {
                        "awayTeamId": self.away_team_id,
                        "homeTeamId": self.home_team_id,
                    },
                )
            )

        if self.started:
            if snapshot.state in PLAY_STATES:
                self._append_appearance_events(events, snapshot)
            self._append_inning_event(events, snapshot)
            if snapshot.state in PLAY_STATES:
                self._append_character_events(events, snapshot)
            if snapshot.has_ended:
                self._finish_pending_appearance(events, snapshot, "game end")
                self.ended = True
                events.append(
                    self._event(
                        snapshot,
                        "game-ended",
                        {
                            "awayRuns": snapshot.away_score,
                            "homeRuns": snapshot.home_score,
                            "reason": "completed",
                        },
                    )
                )

        # State 0 is a short load/replay boundary. It carries stale semantic
        # values, so it must not erase the last trustworthy inning or player
        # observation and cause duplicate events when gameplay resumes.
        if snapshot.has_started:
            self.last = snapshot
        return events

    def state(self) -> dict[str, Any]:
        return {
            "started": self.started,
            "ended": self.ended,
            "sequence": self.sequence,
            "last": asdict(self.last) if self.last is not None else None,
            "pendingAppearance": (
                asdict(self.pending_appearance)
                if self.pending_appearance is not None
                else None
            ),
        }

    def restore(self, value: dict[str, Any]) -> None:
        if set(value) != {
            "started",
            "ended",
            "sequence",
            "last",
            "pendingAppearance",
        }:
            raise SluggersAdapterError("Saved game tracker state has unknown fields")
        started = value["started"]
        ended = value["ended"]
        sequence = value["sequence"]
        raw_last = value["last"]
        raw_pending = value["pendingAppearance"]
        if not isinstance(started, bool) or not isinstance(ended, bool):
            raise SluggersAdapterError("Saved game tracker lifecycle is invalid")
        if not isinstance(sequence, int) or sequence < 0:
            raise SluggersAdapterError("Saved game tracker sequence is invalid")
        if raw_last is not None:
            if not isinstance(raw_last, dict):
                raise SluggersAdapterError("Saved game tracker snapshot is invalid")
            try:
                last = GameSnapshot(**raw_last)
            except (TypeError, ValueError) as error:
                raise SluggersAdapterError(
                    "Saved game tracker snapshot is invalid"
                ) from error
        else:
            last = None
        if raw_pending is not None:
            if not isinstance(raw_pending, dict):
                raise SluggersAdapterError(
                    "Saved game tracker appearance is invalid"
                )
            try:
                pending = PendingAppearance(**raw_pending)
            except (TypeError, ValueError) as error:
                raise SluggersAdapterError(
                    "Saved game tracker appearance is invalid"
                ) from error
            if pending.batting_side not in {"away", "home"}:
                raise SluggersAdapterError(
                    "Saved game tracker appearance side is invalid"
                )
        else:
            pending = None
        if ended and not started:
            raise SluggersAdapterError("Saved game tracker ended before it started")
        self.started = started
        self.ended = ended
        self.sequence = sequence
        self.last = last
        self.pending_appearance = pending

    def _append_appearance_events(
        self, events: list[TrackerEvent], snapshot: GameSnapshot
    ) -> None:
        side = snapshot.batting_side
        if side is None or self._character(snapshot.batter_game_id) is None:
            return
        pending = self.pending_appearance
        if pending is not None and (
            pending.batting_side != side
            or pending.batter_game_id != snapshot.batter_game_id
        ):
            self._finish_pending_appearance(events, snapshot, "batter change")
            pending = None
        if pending is None:
            score, hits = self._offense_totals(snapshot, side)
            pending = PendingAppearance(
                batter_game_id=snapshot.batter_game_id,
                pitcher_game_id=snapshot.pitcher_game_id,
                batting_side=side,
                start_score=score,
                start_hits=hits,
                start_outs=snapshot.outs,
            )
            self.pending_appearance = pending
        if pending.awaiting_play_reset:
            if not self._play_fields_are_clear(snapshot):
                return
            pending.awaiting_play_reset = False
        if pending.pitcher_game_id != snapshot.pitcher_game_id:
            pending.pitcher_changed = True
            pending.pitcher_game_id = snapshot.pitcher_game_id
        pending.max_balls = max(pending.max_balls, snapshot.balls)
        pending.max_strikes = max(pending.max_strikes, snapshot.strikes)
        pending.max_pitches = max(pending.max_pitches, snapshot.pitches)
        pending.max_bases_advanced = max(
            pending.max_bases_advanced, snapshot.bases_advanced
        )
        pending.max_runs_this_play = max(
            pending.max_runs_this_play, snapshot.runs_this_play
        )
        pending.max_outs_this_play = max(
            pending.max_outs_this_play, snapshot.outs_this_play
        )
        pending.ball_was_hit = pending.ball_was_hit or snapshot.ball_was_hit == 1
        pending.bean_ball = pending.bean_ball or snapshot.bean_ball == 1
        pending.home_run = (
            pending.home_run
            or snapshot.home_run == 1
            or snapshot.state in {0x13, 0x14}
        )

    @staticmethod
    def _play_fields_are_clear(snapshot: GameSnapshot) -> bool:
        """Wait out result bytes retained briefly for the previous batter."""

        return (
            snapshot.runs_this_play == 0
            and snapshot.outs_this_play == 0
            and snapshot.bases_advanced <= 0
            and snapshot.ball_was_hit != 1
            and snapshot.bean_ball != 1
            and snapshot.home_run != 1
            and snapshot.state not in {0x13, 0x14, 0x15}
        )

    def _finish_pending_appearance(
        self,
        events: list[TrackerEvent],
        snapshot: GameSnapshot,
        boundary: str,
    ) -> None:
        pending = self.pending_appearance
        self.pending_appearance = None
        if pending is None or not pending.has_activity:
            return
        batter = self._character(pending.batter_game_id)
        pitcher = self._character(pending.pitcher_game_id)
        if batter is None or pitcher is None:
            self._append_provisional_warning(
                events, snapshot, f"{boundary} exposed an unknown batter or pitcher"
            )
            return
        score, hits = self._offense_totals(snapshot, pending.batting_side)
        score_delta = score - pending.start_score
        hit_delta = hits - pending.start_hits
        if score_delta < 0 or hit_delta < 0 or hit_delta > 1:
            self._append_provisional_warning(
                events, snapshot, f"{boundary} exposed inconsistent score or hit deltas"
            )
            return
        cumulative_outs = max(0, snapshot.outs - pending.start_outs)
        outs_recorded = min(
            3, max(pending.max_outs_this_play, cumulative_outs)
        )
        result = self._appearance_result(pending, hit_delta, outs_recorded)
        if result is None:
            self._append_provisional_warning(
                events,
                snapshot,
                f"Plate appearance for {batter} could not be classified at {boundary}",
            )
            return
        if pending.pitcher_changed:
            self._append_provisional_warning(
                events,
                snapshot,
                f"Plate appearance for {batter} crossed a pitcher change",
            )
            return
        if score_delta != 0 or pending.max_runs_this_play != 0:
            self._append_provisional_warning(
                events,
                snapshot,
                f"Scoring plate appearance for {batter} needs scorer and RBI attribution",
            )
            return
        events.append(
            self._event(
                snapshot,
                "plate-appearance-ended",
                {
                    "batterCharacterId": batter,
                    "battingSide": pending.batting_side,
                    "errorByCharacterId": None,
                    "outsRecorded": outs_recorded,
                    "pitcherCharacterId": pitcher,
                    "result": result,
                    "rbi": 0,
                    "scorerCharacterIds": [],
                },
            )
        )

    @staticmethod
    def _appearance_result(
        pending: PendingAppearance, hit_delta: int, outs_recorded: int
    ) -> str | None:
        if pending.bean_ball:
            return "hit-by-pitch"
        if pending.max_balls >= 4:
            return "walk"
        if pending.max_strikes >= 3:
            return "strikeout"
        if pending.home_run:
            return "home-run"
        if hit_delta == 1:
            return {1: "single", 2: "double", 3: "triple"}.get(
                pending.max_bases_advanced
            )
        if pending.ball_was_hit and outs_recorded > 0:
            return "out"
        return None

    def _append_provisional_warning(
        self, events: list[TrackerEvent], snapshot: GameSnapshot, message: str
    ) -> None:
        events.append(
            self._event(
                snapshot,
                "bridge-warning",
                {
                    "code": "provisional-observation",
                    "droppedEvents": 0,
                    "message": message,
                },
            )
        )

    @staticmethod
    def _offense_totals(
        snapshot: GameSnapshot, side: TeamSide
    ) -> tuple[int, int]:
        if side == "away":
            return snapshot.away_score, snapshot.away_hits
        return snapshot.home_score, snapshot.home_hits

    def _append_inning_event(
        self, events: list[TrackerEvent], snapshot: GameSnapshot
    ) -> None:
        side = snapshot.batting_side
        if side is None or not 1 <= snapshot.inning <= 99:
            return
        if (
            self.last is None
            or self.last.inning != snapshot.inning
            or self.last.half != snapshot.half
        ):
            events.append(
                self._event(
                    snapshot,
                    "inning-started",
                    {
                        "inning": snapshot.inning,
                        "half": "top" if side == "away" else "bottom",
                    },
                )
            )

    def _append_character_events(
        self, events: list[TrackerEvent], snapshot: GameSnapshot
    ) -> None:
        batting_side = snapshot.batting_side
        if batting_side is None:
            return
        pitching_side: TeamSide = "home" if batting_side == "away" else "away"
        prior = self.last
        if (
            prior is None
            or prior.state not in PLAY_STATES
            or prior.batter_game_id != snapshot.batter_game_id
        ):
            character = self._character(snapshot.batter_game_id)
            if character is not None:
                events.append(
                    self._event(
                        snapshot,
                        "batter-changed",
                        {"characterId": character, "side": batting_side},
                    )
                )
        if (
            prior is None
            or prior.state not in PLAY_STATES
            or prior.pitcher_game_id != snapshot.pitcher_game_id
        ):
            character = self._character(snapshot.pitcher_game_id)
            if character is not None:
                events.append(
                    self._event(
                        snapshot,
                        "pitcher-changed",
                        {"characterId": character, "side": pitching_side},
                    )
                )

    def _character(self, game_id: int) -> str | None:
        if not 0 <= game_id < len(CHARACTER_IDS):
            return None
        return self.character_ids.get(game_id, CHARACTER_IDS[game_id])

    def _event(
        self,
        snapshot: GameSnapshot,
        event_type: TrackerEventType,
        payload: dict[str, Any],
    ) -> TrackerEvent:
        self.sequence += 1
        return TrackerEvent(
            sequence=self.sequence,
            frame=snapshot.frame,
            event_type=event_type,
            payload=payload,
        )
