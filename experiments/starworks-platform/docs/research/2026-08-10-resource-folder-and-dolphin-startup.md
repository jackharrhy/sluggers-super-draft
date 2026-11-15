# Sluggers resource folder and deterministic Dolphin startup

**Date:** 2026-08-10
**Status:** Startup and CPU-play proof complete; scheduled-match acceptance pending

This note replaces screenshot-based startup guesses with a reproducible boot
design. The earlier capture reached an opening/attract sequence, not an
automated game. It is not evidence that Starworks navigated the menus, loaded
teams, or started gameplay.

## Local research corpus

The three supplied archives are preserved byte-for-byte under the ignored
`research/mario-sluggers-resource-folder/` directory. A small review
set was extracted under `review/`; the bundled WBFS and other large copyrighted
game material were neither selected as a Starworks base nor copied into a
tracked path.

| Archive | Size | SHA-256 |
| --- | ---: | --- |
| `The Mario Sluggers Resource Folder-20260810T135918Z-1-001.zip` | 2.0 GiB | `b69d10c875cb06692c1b9a4d7eb62d070ea8002457043fb0c84a30edf43b03e4` |
| `The Mario Sluggers Resource Folder-20260810T135918Z-1-002.zip` | 1.1 GiB | `71ba184c049251e065f5b4689dc6cfac112e96bf666419711767892a1d216a62` |
| `The Mario Sluggers Resource Folder-20260810T135918Z-1-003.zip` | 1.6 GiB | `7cf3492211cb8e91a0c389b975f9645d46e5b14f774f256d58741af8de8d79d4` |

The first archive contains the material most relevant to Starworks: a claimed
100% Dolphin save, netplay and modding guides, Gecko-code notes, address/stat
workbooks, an older Python stat editor, custom-stadium material, and a WBFS.
The other two archives are predominantly custom-stadium assets. There is no
Dolphin savestate, input movie, or controller profile in the three archives.

The archive is research input, not a license grant. No source code, binary
patch, save, copyrighted game file, model, texture, audio, or spreadsheet data
from it should be committed or redistributed until its provenance and license
permit that use. Facts learned from it should be independently verified against
the reviewed game build before becoming adapter contracts.

## The supplied Wii save

`review/100_ Savefile for Dolphin/data.bin` is a structurally valid encrypted
Wii save export rather than a Dolphin savestate:

- SHA-256: `74bd92d3125c51704172ce815161928884d50d08c4cc07812c674ccd2b618c81`
- title ID: `00010000524d4245` (`RMBE`)
- title: `Mario Super Sluggers`
- valid header MD5 and backup-header magic
- four valid file records: `gamedata`, `oekaki_0`, `oekaki_1`, and `oekaki_2`

The archive calls this the 100% save. Its `gamedata` is materially different
from the default save produced by the earlier isolated profiles and contains a
large run of enabled-looking flags. That makes it a credible candidate, but not
proof that every character and star state is unlocked. We must import it into
an isolated profile and verify the visible game state before giving it that
meaning.

Dolphin's standard import path decrypts and validates `data.bin`, then writes
the save into its emulated Wii NAND. Its implementation requires title metadata
to exist and reports that the game must be launched once when it does not. The
current desktop UI exposes this import, but the stock command line does not.
See Dolphin's [Wii save implementation](https://github.com/dolphin-emu/dolphin/blob/master/Source/Core/Core/HW/WiiSave.cpp)
and [command-line parser](https://github.com/dolphin-emu/dolphin/blob/master/Source/Core/UICommon/CommandLineParse.cpp).

The safe seed procedure is therefore:

1. Create an isolated Dolphin user directory with `--user`/`-u`.
2. Boot the reviewed `RMBE01` build once so Dolphin creates the title metadata.
3. Import the reviewed `data.bin` through Dolphin's Wii Save Import UI.
4. Boot again and visibly verify the expected unlocks and star state.
5. Record the Dolphin version, game/build manifest, relevant configuration
   hashes, imported-file hashes, and verification result.
6. Treat that vetted user directory as an immutable seed and clone it into a
   fresh attempt profile; never run an attempt in the seed itself.

Dolphin documents `-u` as selecting a session-specific user directory, which
contains saves and configuration. This is the supported isolation primitive:
[Controlling the Global User Directory](https://dolphin-emu.org/docs/guides/controlling-global-user-directory/).

## Save states are caches, not fixtures

Dolphin can start with `--save_state`, but its state implementation checks the
game identity and state format, newer state formats record the exact Dolphin
version, and Dolphin warns that states are not guaranteed to remain compatible
across versions. A normal NAND save is also not generally captured as the
authoritative contents of a state. See Dolphin's
[state implementation](https://github.com/dolphin-emu/dolphin/blob/master/Source/Core/Core/State.cpp).

A known-start-screen state can still be useful after we have proved the normal
boot path. If introduced, it must be:

- generated from the vetted seed profile;
- pinned to the exact Dolphin build, game-build hash, adapter build,
  configuration hash, and controller-profile hash;
- rejected when any pin differs;
- followed by a memory-observed screen/state assertion; and
- disposable and reproducible from a normal boot plus in-game save.

The in-game Wii save remains the durable baseline. The state is only a runner
image optimization.

## Controls and observable state

The Nintendo instruction booklet describes upright, sideways, and Nunchuk
control modes, and says the remote must be upright or use the Nunchuk for
non-game activities such as menus. The resource folder's netplay guide is more
specific operationally: menus require vertical controls, and players commonly
switch to horizontal controls for gameplay. References:

- [Nintendo's Wii manuals index](https://en-americas-support.nintendo.com/app/answers/detail/a_id/16890/~/wii-manuals)
- [Mario Super Sluggers instruction-booklet mirror](https://www.mariomayhem.com/downloads/mario_instruction_booklets/Mario_Super_Sluggers_-_ML1_Manual_-_WII.pdf)
- local `review/Mario Sluggers Netplay Guide.docx`, page 3

The runner maps the controller Pipe's directions to the Nunchuk stick and does
not bind pointer/IR input or an explicit orientation transition. A live run
proved that the Nunchuk mapping is sufficient for these menus. Binding the same
Pipe direction to both the Wii Remote D-pad and Nunchuk stick caused duplicate
menu movements, so they must not share one input token. The actual title-screen
gap was the need for a true held `A+B` chord, which the Pipe backend provides.
Add pointer input or an orientation transition only if an observed screen
proves it is required.

Dolphin's Pipe input backend accepts newline-delimited button and stick
commands, but its build configuration enables that backend only on Unix. It is
suitable for macOS and Linux, including a future Linux runner container; it is
not a Windows controller solution. The runner should keep its Python controller
interface and add a Windows backend before claiming automated Windows support.

Dolphin's built-in MemoryWatcher is also Unix-only and read-only. It can watch
32-bit values and pointer chains and emit changes through a Unix datagram
socket. That makes it a useful independent observer for menu-state discovery
and transition assertions, while the guarded Starworks bridge remains the
authority for writes, attempt identity, and semantic match events.

Official implementation references:

- [Dolphin controller configuration guide](https://dolphin-emu.org/docs/guides/configuring-controllers/)
- [Pipe input source](https://github.com/dolphin-emu/dolphin/tree/master/Source/Core/InputCommon/ControllerInterface/Pipes)
- [MemoryWatcher source](https://github.com/dolphin-emu/dolphin/blob/master/Source/Core/Core/MemoryWatcher.cpp)

## Resource insights worth preserving

The research set materially expands the evidence available for future clean
implementations:

- The modding guide documents a CPU-vs-CPU Gecko workflow and custom-stadium
  booting through an extracted `main.dol`.
- The Gecko notes collect CPU lineup editing, camera and star-mechanic codes,
  character unlock/star codes, and links to AutoTeam, DAT tools, and other
  Sluggers utilities.
- `Sluggers stats + Addresses.xlsx` describes the character stat table at
  `0x806CE9A7`, a 142-byte character stride, character chemistry beginning at
  `0x806CE9D0`, stock and starred stat tables, team-star weights, and several
  additional gameplay-data regions.
- The old Python editor independently uses the same stat-table base and stride
  and emits Gecko writes, but it has no included license and its large text
  format is not a Starworks contract.

These are excellent leads for provenance notes, address guards, and schema
design. Stat Editor is a trusted direct implementation source through active
contributor collaboration, so its proven behavior and suitable code may be
adapted with attribution. Its file format still does not become a Starworks
contract automatically; Starworks compiles its web-owned schema into
game-specific operations at the runner boundary.

## Deterministic startup design

The runner should advance through an explicit state machine rather than a timed
sequence of button presses:

```text
process-started
  -> title-screen-detected
  -> main-menu-detected
  -> baseball-selected
  -> team-select-detected
  -> runtime-configuration-applied
  -> begin-ready
  -> match-started
```

Each transition must have:

1. a memory-observed precondition tied to the reviewed `RMBE01` build;
2. the smallest explicit controller action;
3. a bounded timeout and memory-observed postcondition;
4. a safe retry/recovery policy or a fail-closed terminal error; and
5. a diagnostic screenshot and memory snapshot on failure.

Screenshots are diagnostics, not acceptance assertions. Attract-mode footage
must never satisfy a gameplay gate. Runtime team/stat/lineup writes happen only
after the corresponding screen/state is observed, and their values must be
read back before selecting Begin.

## Revised live acceptance gates

The next real-game run is accepted only when all applicable gates are backed by
logs and memory observations:

1. The imported save visibly exposes the expected unlocks and star state.
2. A command demonstrably changes the selected menu item from a known state.
3. Each startup-state transition is observed rather than inferred from time.
4. The runner observes team select before applying runtime configuration.
5. Team, lineup, stat, and rule writes are read back and match the attempt.
6. A game-state marker and bridge event prove that a match started.
7. Full acceptance ultimately requires a completed representative game with
   ordered semantic telemetry; no screenshot can substitute for this.

## Stock Dolphin versus a fork

Stock Dolphin remains the right first implementation. Its isolated user
directory, normal Wii save, controller Pipe on Unix, GDB endpoint, bridge, and
MemoryWatcher are enough to conduct the next proof.

A narrow Starworks fork becomes justified only when a measured requirement
cannot be made reliable through those interfaces. Current candidates are a
noninteractive Wii-save import command, a cross-platform controller transport,
stronger lifecycle/telemetry IPC, or deterministic capture integration. If one
is added, keep the patch small, upstreamable where possible, and separated
under Dolphin's GPL terms; do not fork merely to avoid building the startup
state machine.

## Live startup and CPU-vs-CPU result

The isolated Dolphin 2606 profile now has a repeatable fast path for the
reviewed `RMBE01` image:

- Tab temporarily disables throttling through the Wii safety sequence.
- A skips the opening movie as soon as it begins.
- A held together with B advances the title screen.
- File 1 is the supplied complete profile; the initial cursor is File 2, so a
  deliberate left movement is required before selecting it.
- Only the Nunchuk stick is mapped for menu movement. Mapping both the remote
  D-pad and Nunchuk stick to the same Pipe buttons produces duplicate moves.

A local, ignored pre-Begin checkpoint was captured at
`research/dolphin-profiles/rmbe01-seed-dolphin-2606/StateSaves/starworks-pre-begin.sav`.
It is 30,423,407 bytes with SHA-256
`166d07f811823844f444a2bbe5c6891ee957782cddbbb75be8a56eafab48118a`.
Dolphin restored it directly to the rules screen, and the runner launcher now
supports the stock `--save_state` option so repeated experiments do not replay
the boot or menu flow. A cold batch-mode relaunch reached that screen in about
four seconds. The first Metal restore exposed a nonfatal shader-pipeline panic;
the automated profile now disables Dolphin's interactive panic handler so the
same cold launch completes unattended while retaining the diagnostic dump.
The checkpoint is local research material, not a source artifact to commit or
distribute.

The resource-folder CPU-vs-CPU Gecko code was also proven against this exact
build. Its activation requires holding Minus (Pipe button `Z`) and pressing A
while Minus remains held; releasing Minus before A does not trigger the hook.
After the correct chord, both sides displayed `CPU` in the gameplay HUD and a
ball was put into play with no subsequent controller input. This proves
unattended gameplay activation.

The same checkpoint-backed process subsequently completed the game without
further gameplay input and reached the stable final score screen at `1–3`.
Local evidence is retained at
`research/live-full-game-result-2026-08-10.png` (91,923 bytes,
SHA-256 `37e996b75483c0f95f463c6b46f38542e1e937677e4294fe1f7284a0343f3686`).
This is live proof that the exact image, Dolphin 2606, validated save, Pipe
controller path, and research Gecko CPU mode can finish a game. It is not proof
of adapter-owned CPU control, scheduled-match orchestration, or semantic
telemetry, so those gates remain open.

## Managed pre-roster and adapter acceptance

The runner now owns a hash-pinned, ignored seed checkpoint at Exhibition
stadium selection. The current local manifest pins bridge artifact
`b5a9a75c…9161`, game build `1016a240…3d00`, patched DOL `c7af12d0…bcc6`, and
save-state `a9ca3037…9cc6`. It restored, negotiated, and produced a native
game-only frame without window focus.

From that state, the observed runner flow selected Level 4, waited for
`CMemberSelectTask` state `2` with cursor `0xFF` already on Random Fill, filled
both rosters, and advanced
through the reviewed team-selection hook, then reached Begin and activated the
adapter-owned CPU path with the reviewed Minus+A chord. Receipt mask `0x07`
proves both roster hook calls and CPU activation. The first acceptance run then
showed that Sluggers retained both configured roster sets but randomized batting
order and fielding positions after the hook. That run was correctly rejected by
the independent game-owned read-back gate.

On 2026-08-11, attempt `438f39a0-b4ca-41cd-93fd-95d2ad80a7da` exercised the
complete server-backed configuration path using `demo/sluggers-match.json`.
Starworks retained Random Fill only as the game's reliable allocation step, then
used DME at the final formation screen to locate the two adjacent initialized
team buffers, replace only each slot's character and position bytes, and read
the writes back before Begin. The subsequent live-game verifier accepted both
scheduled batting orders and the active defense positions. The CPU-vs-CPU game
then remained live for 140 station ticks before the operator intentionally
stopped the acceptance run. This proves exact scheduled team creation through
live gameplay, but not a newly completed or auto-confirmed scheduled result.

An earlier adapter-owned CPU path completed a seven-inning game without further
input. It finished 4–11 in 1,153.9 seconds and the DME reducer emitted 96
ordered events, ending once with `game-ended` at frame 87,033. This proves the
adapter-owned CPU path and read-only DME lifecycle through completion. It is
not an accepted scheduled match because it predates the successful final
formation write and read-back described above.

## Next experiment

1. Repeat the proven full-game adapter-owned CPU path with a formation that
   passes game-owned read-back.
2. Replace the bounded MEM2 formation discovery with a stable reviewed pointer
   or adapter hook if profiling shows the one-time scan is an operational cost.
3. Extend the live DME reducer from lifecycle, innings, players, score, and hits
   to resolved plate appearances; add a hook only for a measured missing value.
4. Prove the complete event stream, outage spool, result review, and retry path.
