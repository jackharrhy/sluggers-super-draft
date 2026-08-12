# Mario Super Sluggers telemetry discovery

This inventory preserves what the legacy Stat Tracker knows without making its
polling loop, workbook, absolute addresses, or Python objects into Starworks
contracts. Addresses below are research leads for the supported NTSC-U
revision, not portable symbols.

## Existing observations

The tracker observes match lifecycle state, inning and half, team score and
hits, balls/strikes/outs, current batter and pitcher, base occupants, runs and
outs on the current pitch, hit/landing/possession state, defensive positions,
substitutions, home-run and bean-ball flags, replay state, stadium/rules, and
some Sluggers-specific actions such as star swings, star pitches, bobbles,
buddy jumps, steals, and pickoffs.

Its workbook derives these output families:

- Game: teams, final and per-inning score, stadium/time, regulation innings,
  mercy/stars/items, starting lineups, early quit, and partial-capture warning.
- Batting: PA, AB, H, 1B/2B/3B/HR, runs, RBI, BB, K, HBP, sacrifices, total
  bases, star hits/usage, and rate statistics.
- Running: runs, stolen bases, caught stealing, and attempts.
- Fielding: positions, putouts, assists, errors/bobbles, buddy jumps, and
  double/triple plays.
- Pitching: batters faced, outs/innings, pitches, balls/strikes, K, BB/HBP,
  hit types and runs allowed, earned/inherited runs, star pitches, and pickoffs.

## Candidate symbol catalogue

| Semantic area | Legacy observation lead | Target decomp/bridge symbol |
| --- | --- | --- |
| Match lifecycle | state byte near `0x900d5c28` | match scene enter/exit and result commit functions |
| Inning transition | inning/half fields near `0x900d5e25` | inning state transition and side-swap functions |
| Plate appearance | batter/pitcher, count, current-pitch result structures | batter setup, pitch resolution, PA completion functions |
| Scoring | team score, current-pitch runs, base-runner slots | runner reaches home and score commit functions |
| Hit/out classification | hit, landing, possession, outs-on-pitch fields | batted-ball resolution and out commit functions |
| Lineup/positions | nine defensive slots and batting indices | team initialization and substitution/position functions |
| Match rules | innings, mercy, stars, items, stadium | ruleset and stadium initialization structures |
| Sluggers actions | star, buddy-jump, bobble, steal, pickoff flags | action resolution functions for later event extensions |

Every catalogue entry remains `candidate` until a supported build fingerprint,
structure layout, trace, and reproducible fixture establish it. Read-only DME
snapshots are the preferred v0 boundary because the existing tools already
prove that model and it keeps the implementation in ordinary Python. A game
hook is justified only for a concrete value that cannot be observed reliably.
The current blanket `memory-observation` review gate remains until a complete
destination-aware run and fault matrix prove the exact-build reducer; it is an
acceptance gate, not a permanent ban on DME-derived results.

## Trusted tracker baseline

The reducer was reconciled on 2026-08-11 with the current trusted Stat Tracker
`origin/main` at `72547b8909086b1bd2b4ba287afee4f61a1e963b`. Starworks uses its proven
RMBE01 addresses and transition knowledge directly, while keeping the smaller
immutable-event boundary needed by the web application. In particular, the
reference tracker accumulates pitch state across batting, fielding, home-run,
and load-next-batter states; it does not treat entry into
`LOAD_NEXT_BATTER` as sufficient proof that the batter's appearance ended.

## Live DME slice

The current reader takes three bounded read-only blocks plus scalar reads for
the frame timer, bases advanced, and home-run flag. On exact `RMBE01` in
Dolphin 2606 it has
live-observed:

- game start and the `0x01`/`0x02`/`0x03` gameplay transitions;
- inning and top/bottom changes;
- current batter and pitcher changes;
- cumulative team scores and hits; and
- the stable result states used for one final `game-ended` event.

The first complete adapter-owned trace covered seven innings, finished 4–11 in
1,153.9 seconds, and emitted 96 ordered events through `game-ended`. It remains
ineligible for result acceptance because that trace predates the final-formation
fix. A later server-backed attempt passed the game-owned batting-order and active
defense read-back and entered live CPU-vs-CPU gameplay, but was intentionally
stopped before completion. A single run has therefore not yet proven both the
correct formation and a healthy terminal event.

Two trace findings constrain the reducer:

- replay/load boundaries temporarily expose lower scoreboard values, so
  cumulative runs and hits are monotonic-clamped within one attempt; and
- `LOAD_NEXT_BATTER` does not necessarily complete a plate appearance—a runner
  can be retired while the same batter remains. The safe commit boundary is a
  real batter change after accumulating count, hit/landing, bases-advanced,
  score/hit deltas, and outs for the prior batter.

Walk, strikeout, hit-by-pitch, home run, ordinary hit, and ordinary out can be
resolved by the v0 reducer from the trusted fields. Until the new reads and
reducer are live-accepted, only scoreless supported appearances are emitted.
A pitcher change within an appearance, inconsistent counter delta, unknown
result, or ambiguous scoring play emits a `provisional-observation` warning and
withholds the appearance. Error and sacrifice attribution remain unavailable.
Scorer and RBI attribution is implemented only for a home run with valid
occupied-base slots and a bases-loaded walk or hit-by-pitch; it still requires
live acceptance. Starworks will not collapse other plays into a guessed result
or zero-fill missing attribution.

A normal-speed live run on 2026-08-11 exposed one more boundary rule: the game
retains prior-play result bytes briefly after it installs the next batter. The
first implementation therefore attached the previous out to the following
single. New appearances now wait for those transient fields to clear, matching
the trusted tracker's explicit per-batter context reset. A replacement attempt
then emitted an out with one out recorded followed by a single with zero outs
recorded. That run also showed the half-inning announcement preceding the final
appearance; the reducer now finalizes the old side before announcing the new
half. A clean follow-up run live-proved that corrected ordering, and a one-run
play emitted a review warning without a fabricated RBI or scorer list.
Ordinary outs, singles, the half-inning order, and scoring-warning path are live
proven; the remaining classifications still need equivalent live examples.

A focused DME trace first proved the reference tracker's runner model without
copying its mutable scoring fallback. The first-, second-, and third-base slots
at `0x900DB7CD`, `0x900DB9A1`, and `0x900DBB75` hold signed indices into the
immutable batting order. The trusted tracker also exposes each runner's
destination at `0x900DB921`, `0x900DBAF5`, and `0x900DBCC9`, plus the current
batter's lineup index/destination at `0x900DB5F9` and `0x900DB74D`. Starworks
now retains the maximum destination by batting-order index across a play and
accepts scorer identity only when the players reaching destination 4 exactly
match the scoreboard delta. Scheduled attempt `78cc0b45…` live-proved an
ordinary RBI single: King Boo batted Boo home from second with no provisional
warning. The same scheduled run later attributed Bowser Jr., Luigi, and Peach
on ordinary scoring singles, but one Toad scoring shape remained ambiguous and
failed closed. The interrupted run did not reach game end, so full-run score
consistency and additional scoring shapes remain acceptance gates; there is no
farthest-runner fallback.

## Semantic event boundary

The first stable stream is intentionally smaller than the legacy workbook:

1. `game-started`
2. `inning-started`
3. `batter-changed` and `pitcher-changed`
4. `plate-appearance-ended`
5. `substitution`
6. `game-ended`
7. `bridge-warning`

`plate-appearance-ended` carries the resolved outcome, scorers, RBI, and outs,
so the server can deterministically derive the core box score. More granular
pitch, fielding, running, and Sluggers-specific events will be added to the
single pre-release contract after their hook boundaries are proven. The
exhaustive field status is maintained in
[the tracker parity ledger](./tracker-parity-ledger.md).
