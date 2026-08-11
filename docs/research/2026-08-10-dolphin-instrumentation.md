# Dolphin instrumentation decision

Last verified: 2026-08-10

## Outcome

Starworks will use three deliberately separate interfaces for the macOS alpha:

- The game-side bridge, read through Dolphin Memory Engine, is the authoritative
  source for menu preconditions, configuration receipts, and semantic events.
- Dolphin's pipe controller is the deterministic input path.
- Dolphin's native screenshot/frame-dumper path supplies game-only visual
  diagnostics and local recording artifacts.

GDB is optional reverse-engineering instrumentation for breakpoints, registers,
and CPU-paused inspection. It is not part of the unattended match runtime.

Screenshots are not an OCR or computer-vision correctness oracle. They make a
failed run inspectable without bringing Dolphin to the foreground, while bridge
observations continue to decide whether an action is safe and whether a result is
healthy.

## Exact sources inspected

- Dolphin 2606: tag `2606`, commit
  `6094cfcf7b8fba733b3116fdf3414d51c1c0e4a4`.
- Matt Wood's Dolphin GDB branch: commit
  `37504ba3ee66180258ba7c7934eb4269fda563ef`.
- `dolphin-re-mcp`: commit
  `80cccf134189131f681a0b9698dc9e0777a15685`.
- Python Dolphin Memory Engine 1.3.1: commit
  `3b89857067438e3fca6f97b3ad0614f9e12d03e4`.
- Dolphin Memory Engine: commit
  `b776fab4f9261b346493f3d629488e14c101addd`.
- Project Rio 2.2.0: commit
  `24154dd7b362fb215e1f8756e70a2821d4073825`.
- Project Rio ASM: commit
  `6b9748a87c9383c4eb5b2cf79cc1e7836c3cfb3d`.
- MSS AutoTeam: commit
  `66c7e439399b97c720d1fe14690de2e4d36121de`.

Local research clones live under the ignored top-level `research/` directory.

## Why not read the XFB through GDB?

The idea is technically possible only with additional cooperation, and is a poor
primary interface in stock Dolphin:

1. Dolphin 2606's GDB memory command accepts host RAM addresses. It does not expose
   the Video Interface MMIO registers at `0xCC002000`, so an external client cannot
   discover the active XFB solely by reading VI registers through the stub.
2. Dolphin's normal XFB-to-texture mode keeps the useful current image on the GPU;
   the corresponding emulated RAM need not contain the rendered frame.
3. Even after a game-side hook publishes the VI geometry and XFB address and
   XFB-to-RAM is enabled, one roughly 600–700 KiB YUYV frame requires more than 150
   4 KiB remote-protocol reads. That is useful as a diagnostic experiment, not as
   a control loop.

The native frame dumper already performs the correct operation: it copies the
current GPU XFB texture to a staging texture and encodes a screenshot or video.
Starworks now drives Dolphin's screenshot hotkey through a second private FIFO,
so this path works without window focus or desktop capture.

The same stock GDB stub also accepts the remote interrupt byte and execute
breakpoints. The runner transport now exposes both, plus exact stop waits and
register reads. This gives hook discovery and checkpoint maintenance a CPU-paused,
exact-address workflow instead of another timed menu loop. A second native hotkey
creates tooling-only seed checkpoints; match recovery remains forbidden from
saving or resuming mid-game state.

## GDB stub defects and why they do not require a fork

Matt Wood's `fix/gdbstub-save-state-resume` branch demonstrates a concrete
stock-Dolphin lifecycle defect that intersects Starworks' launch sequence:

1. `CoreTiming::DoState` replaces the active event queue with the queue stored in
   the savestate.
2. A state captured without an active GDB stub contains no `GDBStubUpdate` event.
3. Loading that state after the runner attaches leaves the socket and
   `GDBStub::IsActive()` intact, but no event remains to service packets.

This is not the source of every GDB failure. In particular, Dolphin 2606 returns
`E00` deliberately when `m` or `M` targets an address rejected by
`HostIsRAMAddress`; the save-state patch cannot make Video Interface MMIO or
GPU-only XFB data readable. It also does not explain Dolphin 2606's empty packet
after an interrupt. Those are separate behaviors.

The same research client found a real remote-protocol race: a breakpoint or
watchpoint stop packet can arrive while the client is waiting for another
command's acknowledgement. Starworks now queues that stop reply for the next
`wait_for_stop()` call instead of discarding it. The existing special handling
for Dolphin's empty post-interrupt packet remains separate.

The two Dolphin commits are small and apply cleanly to the exact 2606 source used
by Starworks. The first re-arms `GDBStubUpdate` after a successful state load.
The second removes a 20 microsecond sleep from each socket poll, polls every one
million rather than 100,000 emulated cycles, advertises the actual 10,000-byte
packet buffer, and enables `TCP_NODELAY` for TCP clients. Starworks' Unix-socket
build must guard the `TCP_NODELAY` call to TCP sockets; the research branch calls
it unconditionally and merely logs the resulting error on a local socket.

These defects matter for reverse-engineering sessions, but they do not satisfy
the product fork gate. The match runner no longer enables GDB, so loading a
savestate cannot erase a required GDB polling event or strand a one-shot debug
connection. A researcher may use Matt Wood's branch or rebase those patches onto
2606 when breakpoint work crosses state loads.

`dolphin-re-mcp` is useful optional reverse-engineering tooling: it packages
memory inspection, symbols, disassembly, breakpoint/watchpoint capture, and
diagnostic packet history. It is not a production runner dependency. Its
repository currently declares no license, and its broad interactive surface is
larger than the deterministic transport the match runner needs.

## Dolphin Memory Engine decision

MSS AutoTeam already demonstrates the right product-shaped memory boundary: it
attaches to Dolphin's process, resolves emulated MEM1/MEM2, and reads or writes
Wii virtual addresses directly. This avoids GDB packet latency, CPU-control
semantics, connection lifecycle, and savestate event-queue coupling.

The earlier Starworks decision classified DME as a Windows/Linux legacy backend
because the Python distribution did not support the alpha platform. That premise
is stale. Version 1.3.1 publishes a CPython stable-ABI macOS arm64 wheel and its
source contains a `task_for_pid`/Mach VM implementation. On macOS, the target
Dolphin executable must carry `com.apple.security.get-task-allow`. Starworks
proved this using an ad-hoc-signed disposable copy of the official application;
the installed `/Applications/Dolphin.app` was not modified.

The production implications are bounded:

- the runner manages a private DME-enabled copy of exact Dolphin 2606;
- code hashes and `--version` remain verified before launch;
- the operator is told that the managed copy is locally re-signed and therefore
  is not the original notarized bundle;
- only the reviewed `MemoryTransport` boundary can access emulated RAM; and
- the station enforces one managed Dolphin process, because DME 1.3.1 selects by
  process name rather than an explicit PID.

DME is MIT licensed. It does not expose GPU-only XFB textures, so it does not
replace Dolphin's native frame dumper. It also does not provide CPU registers or
breakpoints, so GDB remains valuable research tooling.

## Live proof

The managed Dolphin session restored the pre-roster checkpoint, completed its
DME handshake, and captured a game-only PNG in 3.3 seconds total:

- Size: 865 x 448 pixels.
- SHA-256:
  `6281275eeeb6d3d4ee6710c0a6d72eff4bb89af672cee9b6787ee39390cb4d40`.
- Observed screen: Exhibition stadium selection, with no Dolphin or desktop chrome.

The runner now captures this native frame on a live setup or bridge failure before
it tears Dolphin down, and includes the artifact path in the actionable failure.
Failure to produce a screenshot never hides or reclassifies the original error.

The same instrumentation shortened roster acceptance to a single persistent
session. A tooling savestate was captured with Random Fill highlighted; stepping
two A presses under CPU-paused inspection showed the first fills both teams and
the second crosses the adapter hooks. The connected executor then reached the
roster hook receipt. The current exact build is `1016a240…3d00`; its
adapter-owned Minus+A gate entered real CPU gameplay without installing a Gecko
code.

## What AutoTeam actually does

AutoTeam is useful input and patching prior art, but it does not capture or inspect
game frames. It:

- focuses the Dolphin window with `pygetwindow`;
- executes a fixed keyboard sequence;
- uses Dolphin Memory Engine for memory access; and
- installs a Gecko team-selection hook.

Starworks can reuse the reviewed game addresses and behavioral ideas, but a fixed
timed macro is not sufficient for an unattended runner that must fail closed.
One concrete navigation idea was retained and independently mapped with native
frames: after CPU level selection, four right transitions move the checkpoint's
Dixie Kong cursor onto Random Fill. Starworks then requires the bridge's
two-roster receipt instead of assuming the timed macro succeeded.
The first A fills both random rosters and changes the button to Next; the second A
crosses the reviewed team-selection hook. Live paused inspection observed receipt
mask `0x07`: both roster hooks and adapter-owned CPU control ran. A later read of
the game-owned batting-order and field-position structures showed that the
remaining menus reordered the formations. The receipt therefore cannot be
called lineup acceptance. The runner now performs independent game-owned
read-back and fails closed on this mismatch.

The DME-first proof used stock Dolphin 2606 with no GDB endpoint configured. On
macOS arm64, Python DME 1.3.1 attached, read game ID `RMBE01`, found bridge entry
signature `9421fff0`, initialized the control block, negotiated request epoch 2,
observed acknowledgement epoch 2 and heartbeat 38, consumed synthetic event
sequence 1, and captured the stadium-selection frame. Attach through event
receipt completed in 1.19 seconds. This proves the runtime bridge does not need a
Dolphin fork.

## Project Rio lesson

Project Rio moved semantic observation into its Dolphin fork. Its PowerPC frame
path obtains a `CPUThreadGuard`, calls Rio functions every frame, and the integrated
stat tracker reads emulated memory through Dolphin's host-read APIs. Quick-match
setup follows the same in-emulator direction.

This is much stronger prior art than external high-frequency GDB polling. The
current Sluggers runner already obtains lifecycle, inning, player, score, hit,
and end-state observations directly through DME. A reviewed game hook remains
an option for a specific value that cannot be made reliable through that
reducer; Rio defines a later direction only if this boundary becomes a measured
constraint.

## Fork triggers

A Dolphin fork remains unjustified unless at least one requirement fails through
DME, the game bridge, Pipe input, and native capture:

- game-side hooks cannot observe required semantics reliably or cheaply;
- DME observations cannot be made consistent enough for acceptance;
- the runner needs a direct headless frame/stream API instead of screenshot and
  local recording artifacts;
- emulator-owned overlays or low-latency broadcast frame delivery are required;
  or
- stock Dolphin lifecycle APIs prevent reliable station recovery.

Until then, the game-side adapter, DME transport, native screenshot path, and
stock Dolphin remain the alpha boundary. A force-XFB-to-RAM experiment may still
be useful for debugging, but it is explicitly not on the product critical path.

## Primary references

- [Dolphin 2606 GDB stub](https://github.com/dolphin-emu/dolphin/blob/2606/Source/Core/Core/PowerPC/GDBStub.cpp)
- [Dolphin 2606 frame dumper](https://github.com/dolphin-emu/dolphin/blob/2606/Source/Core/VideoCommon/FrameDumper.cpp)
- [Dolphin 2606 Video Interface](https://github.com/dolphin-emu/dolphin/blob/2606/Source/Core/Core/HW/VideoInterface.cpp)
- [Dolphin GDB save-state-resume branch](https://github.com/Matt-Wood-23/dolphin/tree/fix/gdbstub-save-state-resume)
- [dolphin-re-mcp](https://github.com/Matt-Wood-23/dolphin-re-mcp)
- [Python Dolphin Memory Engine](https://github.com/randovania/py-dolphin-memory-engine)
- [Dolphin Memory Engine](https://github.com/aldelaro5/dolphin-memory-engine)
- [Project Rio integrated stat tracker](https://github.com/ProjectRio/ProjectRio/blob/master/Source/Core/Core/MSB_StatTracker.cpp)
