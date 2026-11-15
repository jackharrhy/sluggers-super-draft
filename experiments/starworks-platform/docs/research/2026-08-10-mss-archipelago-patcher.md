# MSS Archipelago world and AP patcher research

Last verified: 2026-08-10

## Sources and provenance

- [`MarioManTAW/mss-ap-patcher`](https://github.com/MarioManTAW/mss-ap-patcher),
  tag `v1.0.0`, commit
  `c6ce6cea91d090d0ab045b8facde6fc204657916`.
- [`MarioManTAW/Archipelago`](https://github.com/MarioManTAW/Archipelago/tree/sluggers/worlds/mario_super_sluggers),
  branch `sluggers`, tag `sluggers-v1.0.0`, commit
  `e5d0a433b40f063af7b1fccfa4e121b92fbc31cc`.

The standalone patcher has no declared license and is reference-only. The
Sluggers world is within the Archipelago repository's MIT license and has no
more-specific license file. No implementation from either project was copied
into Starworks during this review. Every address remains a research lead until
independently verified against Starworks' exact `RMBE01` Rev 0 DOL and guarded
by expected input bytes or hashes.

## What the system does

The Archipelago host produces an `.apmss` ZIP containing the standard
`archipelago.json` manifest and an `mss.json` declarative payload. The payload
contains resolved item placements plus settings such as starting captain,
goal-character count, shop behavior, stat and music shuffles, puzzle choices,
quiz sets, and text randomization.

The standalone patcher keeps Nintendo data local:

1. WIT extracts the user's ISO, CISO, or WBFS into a temporary filesystem.
2. Python applies fixed-offset changes to `disc/header.bin`, `sys/main.dol`, and
   `files/dt_na.dat`.
3. WIT rebuilds the result as a WBFS.
4. The runtime client uses Dolphin Memory Engine to connect the patched game to
   the Archipelago server.

This is strong product precedent for Starworks' cloud/local boundary: the web
can distribute a small declarative configuration while the runner combines it
with a user-owned, locally verified image. Starworks does not need the `.apmss`
format or a rebuilt WBFS; its current validated contracts, guarded managed-build
cache, and extracted-filesystem Dolphin launch are the safer form of the same
idea.

## Architectural lessons

### DME is a proven long-lived Wii client transport

The active client depends on `dolphin-memory-engine>=1.3.0`, attaches to a
running Dolphin, validates `RMBE01` at `0x80000000`, validates an `AP` patched-game
marker at `0x80000010`, and polls every 100 ms. It reconnects after failed reads
or process loss and continues synchronizing server items and game flags.

This independently corroborates Starworks' DME-first decision. It does not
provide register access, breakpoints, rendered-frame capture, or semantic match
events, so it does not replace GDB research tooling, Dolphin-native screenshots,
or the Starworks game-side bridge.

### Stable mutations belong in the local build

The Archipelago `1.0.0` release moved most DOL mutations, the starting captain,
goal count, stats, and music from runtime DME writes into the local patcher. Its
release notes state that this was done to improve stability. The client retains
only genuinely live state synchronization and a few save/session repairs.

That is direct support for the Starworks split:

- full stat-profile and other stable global changes are compiled into an
  immutable, locally generated build;
- teams, lineups, rules, stadium, and CPU mode remain per-match runtime data;
- the runtime bridge acknowledges exactly when those values have been consumed.

### Blind team-array writes are not a reliable AutoTeam replacement

The Archipelago branch originally appended newly received character IDs into a
team array beginning at `0x80E55C10`. Commit
`96179e000a9fa7caf656652c6712411732869e0c` removed those five lines with the
message `Remove buggy auto-team feature`.

The failed approach was a direct write into an apparently available slot with no
game-state precondition, hook, atomic transaction, or read-back receipt. This is
useful negative evidence: Starworks should retain its reviewed team-selection
hook and lineup receipt mask instead of reducing team installation to arbitrary
live array writes.

### Persistent cursors are valuable, but authority still belongs off-game

The client stores the next expected Archipelago item index at `0x80E55000`, then
increments it after applying each item. This is a compact idempotency pattern for
reconnects. Starworks already has the stronger equivalent: spool-before-upload,
attempt nonce attribution, sequence cursors, and server-side acceptance. A game
memory cursor may be useful as an additional diagnostic, but it must not become
the authoritative match ledger or permit resuming a failed match from a
mid-game savestate.

## New binary and domain leads

The projects provide useful, independently testable leads beyond the league
match alpha:

- a substantial Challenge Mode state map in the `0x80E55xxx` range, including
  characters, stages, missions, goals, coins, items, day/night state, shops, and
  cutscene flags;
- relationships between Challenge Mode mission IDs, required character counts,
  captains, and chemistry pairs;
- item/shop text encoding and fixed `dt_na.dat` text locations;
- music-selection sites and puzzle/quiz data locations;
- a two-byte disc-header identity marker that is visible at Wii address
  `0x80000010`; and
- another independent use of the character-record table beginning at DOL file
  offset `0x6CAAA9`, with stride `0x8E`.

The stat randomizer groups specific bytes into pitching, batting, fielding, and
running bundles. Those positions line up with Starworks' independently mapped
Stat Editor record: displayed ratings plus the low bytes of their underlying
component values. This corroborates the existing table base, stride, and field
semantics; it does not add a new Starworks mapping without exact-DOL mutation
proof.

## Patterns Starworks should not inherit

- The patcher has no exact source-image hash, per-write expected-byte guards,
  bounds catalogue, overlap detection, or post-build manifest verification.
- It accepts a directory containing any supported WIT input format and assumes
  the North American layout.
- Some patch-time randomization uses local unseeded Python randomness, so the
  same `.apmss` payload need not materialize an identical image.
- The shell wrapper uses a fixed `tmp` directory and recursively deletes it.
- The runtime client uses many independent scalar reads and writes rather than
  atomic configuration publication or a stable snapshot protocol.
- Its temporary in-game test is explicitly a convenient coin flag rather than a
  semantically correct lifecycle signal.
- Polling static flags at 10 Hz is adequate for persistent Challenge Mode checks,
  but can miss transient baseball events and cannot provide attribution-rich
  plate-appearance telemetry.

Starworks therefore keeps all randomness resolved in the immutable input,
verifies the exact source and every guarded target, writes through staging,
hashes the complete output, and uses game hooks for transient match semantics.

## Effect on the Starworks plan

No Dolphin fork or architecture change is justified. This prior art strengthens
the current critical path:

1. finish automated provisioning of the private DME-enabled Dolphin copy;
2. keep DME as the Python runner's runtime-memory transport;
3. finish the acknowledged adapter-owned flow through Begin;
4. implement semantic baseball hooks rather than broad flag polling; and
5. preserve the guarded, deterministic local-build pipeline for full stat
   profiles and stable patches.

Challenge Mode randomization and Archipelago interoperability are possible later
features, not playable-alpha requirements.
