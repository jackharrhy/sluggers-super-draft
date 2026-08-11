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
`memory-observation` provenance still blocks automatic finalization until the
complete reducer and fault matrix are accepted.

## Live DME slice

The current reader takes four contiguous read-only snapshots for gameplay,
batter, pitcher, and frame timer state. On exact `RMBE01` in Dolphin 2606 it has
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
researched from those fields. Error, sacrifice, RBI, and scorer attribution
remain unavailable until the trace supplies unambiguous evidence; Starworks
will not collapse them into a guessed result.

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
