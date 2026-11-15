# Website request to running-game acceptance

Last verified: 2026-08-12

This ledger is the honest boundary between configuration that Starworks can
represent, configuration the adapter can compile, and configuration that has
actually reached a running `RMBE01` game in Dolphin 2606. A unit test or a
successful memory write is not a live setup acceptance result.

## Acceptance rule

A live setup case is accepted only when all of the following are observed in
one run:

1. the runner starts or restores its isolated profile and attaches through
   Dolphin Memory Engine;
2. every menu input is guarded by the owning game task and expected state;
3. the runtime rules, stadium, and captain-brand fields equal the scheduled
   values before Begin;
4. both `COrderSelectTask` formation buffers contain the scheduled character,
   batting-slot, and fielding-position permutations;
5. gameplay reaches state `0x01`; and
6. the post-start batting orders and current defense are read back from the
   independent Stat Tracker field family.

The exact DOL, adapter, game build, checkpoint, Dolphin, and profile identities
must also match. Anything less is compile-only evidence.

The 2026-08-12 matrix used a configuration package downloaded from the real
local runner API after publishing through the website. Each derived case kept
those immutable revision/build identities, changed only website-exposed setup
values, used a fresh attempt/profile, and stopped after the independent
post-start checks. The seven new cases observed:

| Stadium ID | Rules `(innings, mercy, stars, items)` | Away/home captain brands | Result |
| ---: | --- | --- | --- |
| `2` | `(99,1,0,1)` | `2 / 1` | Gameplay state `1`, inning `1` |
| `3` | `(13,0,1,0)` | `3 / 4` | Gameplay state `1`, inning `1` |
| `4` | `(1,1,0,0)` | `11 / 5` | Gameplay state `1`, inning `1` |
| `5` | `(8,0,0,1)` | `9 / 6` | Gameplay state `1`, inning `1` |
| `6` | `(21,1,1,0)` | `8 / 7` | Gameplay state `1`, inning `1` |
| `7` | `(5,0,1,1)` | `2 / 10` | Gameplay state `1`, inning `1` |
| `8` | `(9,1,1,1)` | `8 / 0` | Gameplay state `1`, inning `1` |

The first case exposed an asynchronous DME sampling race: a menu could rewrite
captain bytes after the bridge's per-frame reassertion, so one read sometimes
observed the transient menu default. The executor now requires two matching
runtime observations on distinct advancing bridge heartbeats at every setup
boundary. The same case then passed with the expected values. This is a
sequencing correction, not a delay or screenshot heuristic.

A second four-game matrix partitioned the exact playable character table into
eight legal teams. Its post-start batting-order reads were:

- `0,7,16,24,32,40,48,56,64` and `1,8,17,25,33,41,49,57,65`;
- `2,10,18,26,34,42,50,58,66` and `3,11,19,27,35,43,51,59,67`;
- `4,12,20,28,36,44,52,60,68` and `5,13,21,29,37,45,53,61,69`; and
- `6,14,22,30,38,46,54,62,70` and `9,15,23,31,39,47,55,63,0`.

The repeated `0` only fills the 72nd team slot; the union is exactly `0..70`
with no missing playable character. Each game also verified the active defense
against a different cyclic fielding permutation.

## Request surface

| Website-controlled value | Accepted input surface | Compile/guard evidence | Live evidence | Remaining acceptance |
| --- | --- | --- | --- | --- |
| Execution mode | `cpu-vs-cpu` only | Contract literal and Python adapter mapping | Repeatedly reaches CPU-vs-CPU gameplay | None for the current surface |
| Stadium | Nine named stadium IDs | Operations UI catalog, queue schema, Python mapping, runtime read-back | All IDs `0..8` reached gameplay: Mario Stadium, Bowser Castle, Wario City, Yoshi Park, Peach Ice Garden, DK Jungle, Luigi's Mansion, Daisy Cruiser, and Bowser Jr.'s Playroom | Complete for the current input surface |
| Innings | Integer `1..99` | Web rule editor and Python byte/range guard | Boundary values `1` and `99`, normal `7`, and interior values `5`, `8`, `9`, `13`, and `21` reached gameplay | Complete for the current input surface |
| Mercy, stars, items | Boolean | Web rule editor and Python byte/range guard | Every boolean slot was exercised in mixed combinations; `(1,0,1)`, `(0,1,0)`, `(1,0,0)`, `(0,0,1)`, `(1,1,0)`, `(0,1,1)`, and `(1,1,1)` reached gameplay | Complete for the current input surface |
| Captain | Twelve captain characters | Draft/publish/queue/configuration boundaries and Python brand mapping | Every brand ID `0..11` reached gameplay across the matrix | Complete for the current input surface |
| Active roster character | Exact built-in indices `0..70` | Web validation, AutoTeam import guard, Python compiler and pack guard | A four-game/eight-team matrix covered all 71 unique indices through injection, final formation, gameplay state `1`, and post-start order/defense read-back | Complete for built-ins; unused `71..76` and profile-local Miis are intentionally rejected |
| Batting order | Any permutation of nine unique active players | Shared lineup validation and exact 27-byte team block | Normal, reversed, and multiple cyclic non-symmetric permutations were independently read back after game start | Complete for the permutation invariant; new character coverage remains below |
| Fielding | Bijection over `P,C,1B,2B,3B,SS,LF,CF,RF` | Shared lineup validation and exact formation-buffer read-back | Normal, remapped, and multiple cyclic rotations were verified through the current-defense records after start | Complete for the bijection invariant |
| Pitcher | The player assigned `P` | Shared lineup invariant | Multiple rotated pitchers reached gameplay and matched current defense | Complete for the current input surface |
| Stat profile | Any published profile the exact-DOL build compiler accepts | Full format parser, guarded target catalog, immutable build hash | Current demo profile/build | Run a visibly non-default full-v4 profile and verify representative bytes live |
| Ruleset/profile/content identities | Immutable published revision IDs and exact build SHA-256 | Web attempt snapshot, runner binding, checkpoint/build guards | Current reviewed demo identities | Repeat from a clean cache after publishing a second build |

## Intentionally unavailable requests

These values must fail before Dolphin launches; they are not deferred silently:

- arbitrary stadium slugs;
- non-captain characters in the captain slot;
- unused DOL roster records `71..76` as active players;
- Miis, until a station-local `RFL_DB.dat` identity mapping is designed;
- a lineup with anything other than nine unique active players and a complete
  fielding bijection;
- execution modes other than CPU-vs-CPU; and
- unknown runtime rule targets or values outside their adapter range.

Bench rosters may retain a non-portable character for historical data, but it
cannot be activated or selected as captain for a runnable revision.

## Proven setup paths

| Entry state | Exit evidence | Status |
| --- | --- | --- |
| Cold boot before Wii safety screen | File 1, settled Exhibition selection, committed result `1`, stadium selector | Live proven with matching native frame and task observation |
| Main menu with Minigames selected or carousel in motion | One observed move at a time; do not confirm until settled; reject any committed result other than Exhibition `1` | Live proven from visibly highlighted Minigames `2` to visibly labeled Exhibition plus stadium task/state read-back in 3.04 seconds |
| Reviewed pre-roster checkpoint at stadium sentinel `-1` | Directed stadium graph, confirmation, `CExhiMainTask` | Live proven |
| Captain selection | Captain states `2/3/4`, CPU level popup | Live proven |
| Member selection | Random Fill allocation, bridge receipt, task-owned formation buffers | Live proven |
| Order selection | `COrderSelectTask +0xC0/+0xC4` formation pointers, Next | Live proven |
| Game settings | Begin state, adapter-owned CPU transition, gameplay state `0x01` | Live proven |

The memory and task provenance for these gates is in
[`menu-observation.md`](menu-observation.md). Prior-art licensing and the reason
MSS-AutoTeam and Sluggers Stat Tracker may be used as direct references are in
[`../../PRIOR_ART.md`](../../PRIOR_ART.md).
