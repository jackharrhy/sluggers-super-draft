# Sluggers Stat Tracker parity ledger

Last verified: 2026-08-10

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
and player-stat rows remain deferred until a complete accepted RMBE01 stream
produces their inputs.

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
| away/home team identity and roster membership | Implemented; acceptance blocked | The runner reads both initialized game-owned rosters and batting/fielding flags. Live evidence found both configured roster sets, but also showed that the current adapter lets the game swap/reorder the scheduled formation; the run now fails closed. | [core](#sw-telem-core) |
| batting order and starting positions | Deferred | A game-owned read-back gate is implemented and live evidence currently fails it. Final formation application must be fixed before these values are accepted. | [core](#sw-telem-core) |
| stadium, regulation innings, mercy, stars, items, CPU control | Implemented | Runtime values are read back on the exact build; adapter-owned CPU activation is receipt- and gameplay-observed. Time of day remains deliberately fixed to day for the current runner. | [core](#sw-telem-core) |
| final away/home score, end reason | Implemented; acceptance blocked | Replay-safe cumulative score observation and exact end states produced one `game-ended` event for a complete 4–11 adapter-owned CPU game. The trace is execution evidence, not a healthy result, because lineup read-back fails. | [core](#sw-telem-core) |
| score by inning, innings played | Partial | Live inning transitions and cumulative scores are observed. A stable scoring-event reducer is still required before per-inning lines are accepted. | [core](#sw-telem-core) |
| team hits | Implemented | Exact-build cumulative hit fields are live observed and clamped across replay memory regressions. | [core](#sw-telem-core) |
| team errors | Deferred | Requires resolved appearance and attributed fielding evidence. | [core](#sw-telem-core), [fielding](#sw-telem-fielding) |
| early quit / partial capture warning | Derived | Attempt failure/review state and telemetry health expose these conditions instead of converting them to stats. | [core](#sw-telem-core) |

## Batting fields

| Legacy fields | Status | Starworks source or reason | Workstream |
| --- | --- | --- | --- |
| plate appearances, at bats, hits, singles, doubles, triples, home runs, walks, strikeouts, hit by pitch, sacrifice flies, sacrifice bunts, RBI, total bases | Deferred | Server derivation is implemented from `plate-appearance-ended`; a real resolved-appearance hook is not. Sacrifice flies and bunts are currently one combined contract result and need separate attribution before parity. | [core](#sw-telem-core) |
| runs | Deferred | Derivable from scorer identities on accepted appearances; live scorer attribution is not hooked. | [core](#sw-telem-core) |
| batting average, on-base percentage, slugging percentage, OPS | Deferred | Pure derivations of the accepted batting totals above. They must remain unavailable while the inputs are unavailable. | [core](#sw-telem-core) |
| one-run, two-run, three-run home runs; grand slams; inside-the-park home runs | Deferred | The core result distinguishes a home run but not these subtypes. | [Sluggers](#sw-telem-sluggers) |
| star singles, star doubles, star triples, star home runs, star hits, star swings, raw stars used, stars used, total star bases, star slugging percentage | Deferred | No accepted star-action event exists. | [Sluggers](#sw-telem-sluggers) |
| flyouts, ground outs, foul balls | Deferred | The core `out` result is intentionally not detailed enough. | [pitch](#sw-telem-pitch), [fielding](#sw-telem-fielding) |

## Pitching fields

| Legacy fields | Status | Starworks source or reason | Workstream |
| --- | --- | --- | --- |
| batters faced, outs pitched, hits allowed, singles/doubles/triples/home runs allowed, runs allowed, walks, strikeouts, bean balls, at bats against, sacrifice flies/bunts allowed | Deferred | The server derives the core subset from resolved appearances, but the live event hook and the two sacrifice subtypes are missing. | [core](#sw-telem-core) |
| innings pitched, total bases allowed, batting average against, on-base percentage against, slugging against, OPS against | Deferred | Pure derivations of unavailable accepted pitching totals. | [core](#sw-telem-core) |
| earned runs, ERA-7, ERA-9 | Deferred | Requires error and inherited-run attribution; the legacy tracker itself currently assumes runs are earned. Starworks will not preserve that assumption. | [fielding](#sw-telem-fielding), [running](#sw-telem-running) |
| pitches, balls, strikes | Deferred | No pitch/count event exists yet. | [pitch](#sw-telem-pitch) |
| star pitches, raw stars used, stars used | Deferred | No accepted star-pitch event exists. | [pitch](#sw-telem-pitch), [Sluggers](#sw-telem-sluggers) |
| pickoffs, pickoff attempts, inherited runs | Deferred | Requires runner and pitcher-change attribution. | [running](#sw-telem-running) |
| WHIP | Deferred | Pure derivation of walks, hits allowed, and innings pitched after those inputs are accepted. | [core](#sw-telem-core) |

## Running fields

| Legacy fields | Status | Starworks source or reason | Workstream |
| --- | --- | --- | --- |
| runs | Deferred | Derivable from scorer identities once live resolved-appearance hooks exist. | [core](#sw-telem-core) |
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

The local tracker identifies useful dynamic-memory leads for RMBE01, including
game state near `0x900D5C28`, inning/half near `0x900D5D97` and `0x900D5E25`,
scores near `0x900D5D98` and `0x900D5DB2`, batter/pitcher identity near
`0x900D69EF` and `0x900D9B47`, and per-pitch result structures around
`0x900D5E30`. These are discovery leads only. They are not independently
verified function boundaries, and polling them cannot produce automatically
confirmed Starworks results.
