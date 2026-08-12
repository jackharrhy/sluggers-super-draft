# Sluggers Stat Tracker parity ledger

Last verified: 2026-08-11

This ledger inventories the fields in the local legacy Stat Tracker without
adopting its workbook or Python model as a Starworks contract. `Implemented`
means the exact supported build exposes the value through a live-validated DME
observation or reviewed game hook, `Derived` means the accepted event stream
reproducibly calculates it, and `Deferred` means it is unavailable. A schema,
decoder, or server derivation by itself does not satisfy either of the first two
states.

No metric in this ledger is represented as zero when it is unavailable. The
current server box-score shape is an implemented derivation target, but only
the narrow lifecycle/team rows below have live DME evidence. Plate-appearance
and player-stat rows remain acceptance-blocked until a complete RMBE01 trace
proves the new reducer inputs. The reducer emits only outcomes it can classify
exactly: scoreless supported appearances, home runs with exact occupied-base
identity, and bases-loaded walks or hit-by-pitches. Other scoring plays produce
a review warning rather than guessed attribution.

## Workstreams

- <a id="sw-telem-core"></a>`SW-TELEM-CORE`: prove lifecycle, inning,
  batter/pitcher, resolved plate appearance, score, substitution, and game-end
  hooks on the exact supported DOL.
- <a id="sw-telem-pitch"></a>`SW-TELEM-PITCH`: add pitch/count and star-pitch
  events after the core stream is stable.
- <a id="sw-telem-running"></a>`SW-TELEM-RUNNING`: add runner movement, steals,
  pickoffs, and inherited-run attribution.
- <a id="sw-telem-fielding"></a>`SW-TELEM-FIELDING`: add possession, putout,
  assist, error/bobble, double-play, and buddy-action attribution.
- <a id="sw-telem-sluggers"></a>`SW-TELEM-SLUGGERS`: add star swings/hits,
  home-run subtypes, and other Sluggers-specific outcomes.

## Game and team fields

| Legacy field | Status | Starworks source or reason | Workstream |
| --- | --- | --- | --- |
| away/home team identity and roster membership | Implemented and live proven through game start | The runner applies both scheduled formations at the final game-owned boundary and reads both initialized rosters back before Begin. A server-backed attempt passed the gate and entered CPU-vs-CPU gameplay; completion in the same run remains pending. | [core](#sw-telem-core) |
| batting order and starting positions | Implemented and live proven through game start | The same fail-closed read-back verifies all nine batting-order slots and active defensive positions against the immutable attempt. Full-match acceptance remains pending. | [core](#sw-telem-core) |
| stadium, regulation innings, mercy, stars, items, CPU control | Implemented | Runtime values are read back on the exact build; adapter-owned CPU activation is receipt- and gameplay-observed. Time of day remains deliberately fixed to day for the current runner. | [core](#sw-telem-core) |
| final away/home score, end reason | Implemented; combined acceptance pending | Replay-safe cumulative score observation and exact end states produced one `game-ended` event for a complete 4–11 adapter-owned CPU game. A separate later run proved scheduled formation through gameplay. One unattended run has not yet proven both together. | [core](#sw-telem-core) |
| score by inning, innings played | Partial | Live inning transitions and cumulative scores are observed. A stable scoring-event reducer is still required before per-inning lines are accepted. | [core](#sw-telem-core) |
| team hits | Implemented | Exact-build cumulative hit fields are live observed and clamped across replay memory regressions. | [core](#sw-telem-core) |
| team errors | Deferred | Requires resolved appearance and attributed fielding evidence. | [core](#sw-telem-core), [fielding](#sw-telem-fielding) |
| early quit / partial capture warning | Derived | Attempt failure/review state and telemetry health expose these conditions instead of converting them to stats. | [core](#sw-telem-core) |

## Batting fields

| Legacy fields | Status | Starworks source or reason | Workstream |
| --- | --- | --- | --- |
| plate appearances, at bats, hits, singles, doubles, triples, home runs, walks, strikeouts, hit by pitch, total bases | Reducer implemented; partial live evidence | The v0 DME reducer accumulates the trusted count, hit, bases-advanced, score/hit delta, outs, bean-ball, home-run, and initial base-occupant fields until a real batter/side change. Normal-speed attempts live-proved ordinary outs, singles, the prior-play reset gate, final-PA-before-next-inning ordering, and batting-order indices moving through the base slots across consecutive singles. The remaining result classes still need live examples. | [core](#sw-telem-core) |
| sacrifice flies, sacrifice bunts | Deferred | These subtypes are not yet unambiguous and remain unavailable rather than zero-filled. | [core](#sw-telem-core) |
| RBI | Partial; live acceptance pending | Exact RBI is emitted for a home run when every occupied runner slot is valid, and for a bases-loaded walk/HBP. Every other scoring play remains provisional. | [core](#sw-telem-core) |
| runs | Partial; runner identity live proven | Base slots at `0x900DB7CD`, `0x900DB9A1`, and `0x900DBB75` were live-observed as signed batting-order indices across consecutive singles. The reducer uses them only for exact home-run and bases-loaded force scoring; other cases remain unavailable. | [core](#sw-telem-core) |
| batting average, on-base percentage, slugging percentage, OPS | Deferred | Pure derivations of the accepted batting totals above. They must remain unavailable while the inputs are unavailable. | [core](#sw-telem-core) |
| one-run, two-run, three-run home runs; grand slams; inside-the-park home runs | Deferred | The core result distinguishes a home run but not these subtypes. | [Sluggers](#sw-telem-sluggers) |
| star singles, star doubles, star triples, star home runs, star hits, star swings, raw stars used, stars used, total star bases, star slugging percentage | Deferred | No accepted star-action event exists. | [Sluggers](#sw-telem-sluggers) |
| flyouts, ground outs, foul balls | Deferred | The core `out` result is intentionally not detailed enough. | [pitch](#sw-telem-pitch), [fielding](#sw-telem-fielding) |

## Pitching fields

| Legacy fields | Status | Starworks source or reason | Workstream |
| --- | --- | --- | --- |
| batters faced, outs pitched, hits allowed, singles/doubles/triples/home runs allowed, walks, strikeouts, bean balls, at bats against | Reducer implemented; partial live evidence | The server derives these from the same conservative scoreless appearance slice. Ordinary out and single inputs are now exact-build live proven; the remaining classes still require examples. | [core](#sw-telem-core) |
| runs allowed | Partial; live acceptance pending | Accepted exact scorer/RBI events can attribute these; ambiguous scoring events remain withheld. | [core](#sw-telem-core) |
| sacrifice flies/bunts allowed | Deferred | Sacrifice attribution is deliberately withheld until the required runner and out evidence is proven. | [core](#sw-telem-core) |
| innings pitched, total bases allowed, batting average against, on-base percentage against, slugging against, OPS against | Deferred | Pure derivations of unavailable accepted pitching totals. | [core](#sw-telem-core) |
| earned runs, ERA-7, ERA-9 | Deferred | Requires error and inherited-run attribution; the legacy tracker itself currently assumes runs are earned. Starworks will not preserve that assumption. | [fielding](#sw-telem-fielding), [running](#sw-telem-running) |
| pitches, balls, strikes | Deferred | No pitch/count event exists yet. | [pitch](#sw-telem-pitch) |
| star pitches, raw stars used, stars used | Deferred | No accepted star-pitch event exists. | [pitch](#sw-telem-pitch), [Sluggers](#sw-telem-sluggers) |
| pickoffs, pickoff attempts, inherited runs | Deferred | Requires runner and pitcher-change attribution. | [running](#sw-telem-running) |
| WHIP | Deferred | Pure derivation of walks, hits allowed, and innings pitched after those inputs are accepted. | [core](#sw-telem-core) |

## Running fields

| Legacy fields | Status | Starworks source or reason | Workstream |
| --- | --- | --- | --- |
| runs | Partial; runner identity live proven | Exact home-run and bases-loaded force cases resolve through the live-proven batting-order indices in the three base slots. Other runner-scoring paths remain deferred. | [core](#sw-telem-core) |
| stolen bases, caught stealing, steal attempts, caught-stealing percentage | Deferred | No runner-action event exists. | [running](#sw-telem-running) |
| close plays won, close plays lost | Deferred | The legacy model declares these fields but explicitly does not track them. A game-side resolution hook must be discovered. | [running](#sw-telem-running) |

## Fielding and position fields

| Legacy fields | Status | Starworks source or reason | Workstream |
| --- | --- | --- | --- |
| positions played | Deferred | Starting positions are configured; live substitutions can update this once the substitution hook is proven. | [core](#sw-telem-core) |
| errors | Deferred | The contract supports an attributed error, but no live hook produces it. | [fielding](#sw-telem-fielding) |
| putouts, assists, throwouts, double plays, triple plays | Deferred | No accepted fielding-resolution event exists. | [fielding](#sw-telem-fielding) |
| bobbles, buddy-jump attempts, buddy-jump outs | Deferred | No accepted Sluggers fielding-action event exists. | [fielding](#sw-telem-fielding) |
| fielding chances, fielding percentage | Deferred | Pure derivations of unavailable fielding totals. | [fielding](#sw-telem-fielding) |
| close plays won, close plays lost | Deferred | The legacy model declares these fields but explicitly does not track them. | [fielding](#sw-telem-fielding) |

## Research provenance

The trusted tracker `origin/main` at
`72547b8909086b1bd2b4ba287afee4f61a1e963b` identifies useful dynamic-memory
leads for RMBE01, including
game state near `0x900D5C28`, inning/half near `0x900D5D97` and `0x900D5E25`,
scores near `0x900D5D98` and `0x900D5DB2`, batter/pitcher identity near
`0x900D69EF` and `0x900D9B47`, and per-pitch result structures around
`0x900D5E30`. These are discovery leads only. They are not independently
verified function boundaries. The current v0 reader also consumes pitches at
`0x900D692C`, bases advanced at `0x900D66D2`, ball-hit/bean-ball flags at
`0x900D6A94`/`0x900D6A95`, and the home-run flag at `0x900D953C`. These new
reads and their reducer still require exact-build live acceptance. The runner
slots at `0x900DB7CD`, `0x900DB9A1`, and `0x900DBB75` were additionally proven
live to hold signed immutable batting-order indices. Polling still cannot
produce automatically confirmed Starworks results until the complete reducer
and fault matrix pass acceptance.
