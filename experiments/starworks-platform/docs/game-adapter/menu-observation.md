# Sluggers menu observation

Starworks reads Mario Super Sluggers' own task state for menu automation. It
does not infer game-owned screens from elapsed time, and it does not add a new
frame-colour classifier for each screen.

This mapping is for the supported North American `RMBE01` Rev 0 DOL only. The
runner's existing build verification is the guard that makes these addresses
valid.

## Observation layers

| Layer | Purpose | Authority |
| --- | --- | --- |
| Dolphin process health | Detect crash or exit during every wait | Host process handle and exit status |
| Early Wii startup | Dismiss the system safety screen before game tasks exist | Guest XFB, retained as a narrow fallback |
| Opening and main selection | Identify intro, title, file, file action, and top-level mode | Game task descriptor and state fields |
| Later selection screens | Discover registered task objects without scanning RAM | NpLib task-manager containers |
| Live match | Identify gameplay and semantic baseball state | Existing bridge and bounded DME fields |

## Exact-DOL evidence

The stable root object is `0x900D4994`. Its descriptor identifies which
top-level task was constructed in place:

| Task | Descriptor | State field | Constructor/update evidence |
| --- | --- | --- | --- |
| `Opening::COpeningTask` | `0x806CC8E8` | object `+0x09` | `0x8045A238` / `0x8045A3C4` |
| `Select::CSelectTask` | `0x806D7E98` | object `+0x0C` | `0x804A6888` / `0x804A6BBC` |

The opening switch constructs `COpMovieTask`, `CTitleTask`, and
`CFileSelTask`. Its live-proven states are:

| Opening state | Meaning |
| --- | --- |
| `4` | Intro movie is active and may be skipped with A |
| `6` | Title screen is active and requires A+B |
| `9`, File task state `5` | File selector is loading |
| `9`, File task state `6` | File selector accepts input |
| `9`, File task state `8` | Selected file action menu accepts A |

`CFileSelTask` is at `0x9032B134` during this flow. Its constructor and update
are `0x802D61B4` and `0x802D6ADC`. The selected file is the signed word at
`0x807956BC`, derived from the exact DOL's SDA base (`r13 = 0x807961C0`) and
the task's `-0xB04(r13)` access. File 1 is value `0`.

The main-selection anchor is at `0x9032CF14`, but the game constructs several
different task classes in that storage. Code must check the descriptor before
interpreting fields. After a savestate restore the anchor may instead contain
`CMainSelRootTask` (`0x806BEF60`) while the active leaf is relocated. In that
case the observer resolves the one active leaf through the bounded NpLib task
registry; a live checkpoint placed `CMainSelStadiumTask` at `0x9032D03C`.
`CMainSelModeTask` has descriptor `0x806BEE58`, state byte
`+0x1C`, committed-result word `+0x20`, and hover-selection word `+0x30`.
State `4` is input-ready. Its update writes `selection + 1` to `+0x20` when A
is accepted; `CSelectTask` consumes that committed result in state `7`, which
provides this exact mode mapping:

| Selection | Mode |
| --- | --- |
| `0` | Exhibition |
| `1` | Challenge |
| `2`, `3` | Minigames entry points |
| `4` | Training |
| `5` | Records |

The complete-save profile normally opens with Exhibition (`0`) selected. The
runner does not assume that cursor position, however: it reads descriptor
`0x806BEE58`, state `4`, and the selection word; when necessary it sends one
bounded Left at a time, requires the observed selection to change, and lets the
new selection settle before sending another input. It presses A only after
settled selection `0`, then requires committed result `+0x20 == 1`, the mode
task to close, and the distinct stadium descriptor to appear. A hover word or
a frame showing the carousel in motion is not acceptance evidence. This guard
was added after an earlier probe sent inputs while the carousel oscillated and
visibly entered Minigames; that probe is invalid evidence and must not be
described as an Exhibition success. A clean current-build run after the fix
reached the stadium task in 24.93 seconds. Five seconds later, one native frame
visibly showed the Exhibition stadium selector while the same live process
reported `CMainSelStadiumTask`, input state `1`, and selection `0`.
A separate clean run deliberately moved the settled hover through `0 -> 1 ->
2`; a native frame visibly highlighted Minigames while memory reported hover
`2` and no committed result. Starting from that exact state, the corrected
navigator moved one settled selection at a time and reached a native frame
visibly labeled Exhibition in 3.04 seconds, paired with descriptor
`0x806BF350`, input state `1`, and stadium selection `0`.

The same object becomes `CMainSelStadiumTask` (`0x806BF350`). Its input-ready
substate is byte `+0x21 == 1`, live stadium selection is word `+0x30`, previous
stable selection is `+0x2C`, and result is `+0x24`. A clean live run selected
Mario Stadium (`0`) and observed substates `1 -> 3 -> 4`, result `1`. The next
object is the distinct `CMainSelSetumeiTask` (`0x806BF1D0`), the stadium
explanation/confirmation panel. Its input-ready state is byte `+0x19 == 2`;
option word `+0x2C == 0` is the affirmative path. Confirming it produced
`CExhiMainTask` (`0x806A1EB0`) and Select root state `11` without entering
Minigames.

The stadium selector is a directed graph rather than a rectangular grid.
Resetting to verified Exhibition `0` before every probe produced these edges:

| Value | Left | Right | Up | Down |
| --- | ---: | ---: | ---: | ---: |
| `0` | 0 | 3 | 7 | 0 |
| `2` | 7 | 2 | 5 | 3 |
| `3` | 0 | 3 | 2 | 3 |
| `4` | 4 | 8 | 11 | 7 |
| `5` | 8 | 5 | 5 | 2 |
| `7` | 7 | 2 | 4 | 0 |
| `8` | 4 | 5 | 11 | 3 |
| `11` | 11 | 8 | 11 | 4 |

Values `1` and `6` were not reachable in this selector context, and `11` is a
special tile. Starworks therefore does not pretend that these UI values are a
complete public stadium enum. It navigates only along observed edges, chooses
safe tile `0` when a scheduled stadium has no proven tile, and relies on the
runtime bridge to continuously apply and read back the exact scheduled stadium
at the game-owned byte `0x811F769D` before proceeding.

The reviewed pre-roster checkpoint restores with the selector at sentinel
`-1`, between tiles. A live restore proved the one entry edge `D_UP: -1 -> 8`.
The runner verifies both values around that input and then uses the ordinary
directed graph; the other sentinel directions remain intentionally unmapped.

## Generic task registry

The word at `0x80795A94` (`-0x72C(r13)`) points to NpLib's task manager.
`0x8051F714` registers tasks in one of its bounded containers. Each list entry
points to a 32-byte task node with these fields:

| Node offset | Meaning |
| --- | --- |
| `+0x08` | Parent task node |
| `+0x0C` | First child task node |
| `+0x10` | Next sibling task node |
| `+0x14` | Task object pointer |
| `+0x1C` | Completion result consumed by the parent state machine |

The task object's `+0x04` descriptor points to exact-DOL class metadata: the
update-function pointer is at descriptor `+0x08` and the NUL-terminated class
name begins at descriptor `+0x10`. The bounded reader therefore decodes later
task names directly instead of requiring a hand-maintained address for every
screen; catalogued names remain guards for the established path. Twelve update
symbols have been prepared as a focused contribution to the CC0 `mss-decomp`
project. Each class-name/update-pointer pair was mechanically validated from
its embedded descriptor, and the decomp compiled and linked to the expected
exact-DOL SHA-1. A live main-menu traversal found
`Select::CMainSelModeTask` through this registry without a MEM1/MEM2 scan. The
reader validates every pointer, caps container and task counts, detects cycles,
and never writes to game memory.

This is intentionally the integration surface for Exhibition, stadium, team,
order, and rules observation. The Main Mode -> Exhibition -> stadium ->
confirmation -> `CExhiMainTask` path is live-proven.

The same exact-DOL task metadata now guards the final three setup actions:

| Task | Descriptor / update | Ready field | Proven action |
| --- | --- | --- | --- |
| `Select::CExhiCaptainTask` | `0x806A1E40` / `0x802CB688` | anchor `0x9032CF14`, `+0x18 == 2`, then `3`, then `4` | Three separately guarded A presses join the CPU side, confirm its captain, and open CPU Level |
| `popup_menu::CMenuPopUpTask` | `0x806D37B0` / `0x80474B40` | `+0x88 == 2`; selection word `+0x9C` | Selection `1` is Level 2; two guarded right inputs produce `2`/Level 3 and `3`/Level 4; A advances |
| `Select::CMemberSelectTask` | `0x8063B1A8` / `0x8006F184` | `+0x231 == 2`, cursor `+0x36B == 0xFF` | A fills both rosters; after 45 bridge frames a second A produces receipt mask `0x03` |
| `Select::COrderSelectTask` | `0x8063C208` / `0x80080010` | `+0xB8 == 5` | The untouched screen already highlights Next; A advances |
| `Select::CGameSettingTask` | `0x8063CAB0` / `0x800866FC` | `+0x25 == 2` | The untouched screen already highlights Begin; the adapter-owned Z+A transition starts CPU play |

A live run through those gates reached game state `4`, inning `1`, score `0-0`.
Moving right on the member or order screens was disproven: it selects roster
characters (Toadsworth in the former probe and Waluigi/Wario/Shy Guy in the
latter) rather than the action button. A second live run used these five task
observers from captain selection through Begin and reached game state `4`,
inning `1`, score `0-0` without a setup sleep.

## Checkpoint and RNG boundary

Community CPU-vs-CPU practice reports that RNG changes during lineup selection:
a savestate immediately before starting the match repeats home/away, while a
state before lineup can vary. Until independently measured, Starworks treats
this as an operational constraint rather than a fully mapped mechanism:

- the canonical seed checkpoint stays before lineup and before the suspected
  RNG commitment;
- scheduled away/home assignment is observed and verified after lineup rather
  than accepted as random;
- a post-lineup or pre-Begin state is a debugging artifact and cannot be a
  production seed;
- future RNG work must record the first task/state where away/home becomes
  stable across repeated restores.

## Why XFB remains

The XFB reader was valuable as a visual labelling oracle and remains useful
before Sluggers constructs its root task. Once `COpeningTask` appears, the
production navigator stops reading full frames and uses semantic state. A clean
live run reached ready-state Exhibition in about 23.9 seconds using seven early
XFB observations and 34 small task observations.

XFB remains only for the Wii-owned startup interval before Sluggers exposes a
root task, and as an explicit lab diagnostic. Production permanently stops
consulting pixels after the first semantic game task appears—even if a later
memory read is transiently unavailable or unknown. New game screens must not
be implemented as colour thresholds when a game-owned task or state field can
be established.
