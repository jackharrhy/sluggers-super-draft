# Starworks

Starworks is a multi-league platform for running Mario Super Sluggers leagues from league creation through draft, game execution, stat tracking, and broadcast.

The existing Sluggers Super Draft, Sluggers Stat Editor, Sluggers Stat Tracker, MSS AutoTeam, Project Rio, Sluggies DAT Tools, and public Sluggers reverse-engineering projects are research and implementation inputs. Stat Editor, Stat Tracker, and AutoTeam are trusted direct code references through active contributor and maintainer collaboration; reuse their proven implementation knowledge with attribution. None of these projects' current architectures, file formats, or boundaries are automatically part of Starworks.

## Current state

**Last verified:** 2026-08-11 on `codex/starworks-platform`

Starworks has a substantial platform and runner foundation, but it is not yet a
playable alpha. Status claims use three separate meanings:

- **Implemented** — code and automated tests exist.
- **Live proven** — exercised against the exact supported game and Dolphin build.
- **Product complete** — connected through the real workflow with recovery and
  acceptance coverage.

| Area | Status | Next gate |
| --- | --- | --- |
| Multi-tenant leagues, Discord invitations, drafts, rosters, lineups, trades, schedules, and results | Application/data layer implemented; the league home is now a legacy-aligned standings/player-leaders page, while Matches, Teams, Results, and Admin have focused routes and read models; lineup revisions use a portrait-first captain/batting/fielding editor | Continue user acceptance and connect a live healthy game to the Results workflow |
| Runner registration, leases, attempts, build verification, and local event spool | Implemented; web-to-native registration, claim, actionable failure detail, and one fresh retry are live proven | Complete and accept a scheduled match |
| Exact `RMBE01` build, stock Dolphin 2606, DME transport, Pipe control, and native frame diagnostics on macOS arm64 | Live proven | Clean-station acceptance |
| Complete CPU-vs-CPU game | Live proven with both the research Gecko path and adapter-owned CPU control | Repeat to completion with the now-proven scheduled formation path |
| Runtime rules, stadium, captains, rosters, batting order, fielding, and CPU control | Live proven through game start | Exact server-backed teams and active defense passed game-owned read-back; complete a full accepted run |
| Full Stat Editor v4 profile | Lossless 507-line import/export and focused editing implemented; all 16,406 guarded cells match the exact stock DOL and trusted v4.1 editor defaults; representative mutations for all 24 patterns are build- and Dolphin/DME-live-proven | Carry a server-published profile through an unattended scheduled match |
| Sluggers league rules | Supported rules use typed controls for innings, mercy, stars, items, and the web draft timer; unsupported imported settings are preserved read-only | Live-accept each supported runtime rule and add a target only when the adapter supports it |
| Semantic game telemetry and box-score derivation | Partial, with a complete live DME game trace and a tested conservative appearance reducer | Lifecycle, innings, batter/pitcher changes, cumulative score/hits, game end, ordinary outs/singles, correct half-inning ordering, and fail-closed scoring warnings are live proven; accept remaining result classes, then add scorer/RBI attribution without guessing |
| Health-gated automatic result confirmation and one-retry recovery | Implemented | Full live server/runner fault matrix |
| Runner operator UI and local recording | Implemented | Live operator/capture acceptance during a scheduled match |
| RTMP/headless broadcast and non-macOS runners | Deferred | Post-alpha decision gates |

### Playable-alpha definition

The first supported alpha is macOS arm64, stock Dolphin 2606 through a
runner-managed DME-enabled copy, and an exact North American `RMBE01` Rev 0
dump. From a site-admin-provisioned league, Starworks
must publish a complete Stat Editor v4-equivalent profile, draft and schedule a
match, claim it on one runner, build and launch the correct local game,
configure both teams and CPU play without manual input, capture core semantic
events through completion, and automatically confirm only a healthy result.

The runner may reattach to the same valid live process. Otherwise it fails the
attempt and the web queues exactly one fresh attempt; a second failure or any
telemetry inconsistency enters commissioner review. Extended legacy tracker
metrics may be deferred only in the
[tracked parity ledger](docs/game-adapter/tracker-parity-ledger.md) and must
appear as unavailable rather than zero.

### Current critical path

1. Repeat the already-proven adapter-owned full-game path to completion using
   the now-proven server-backed formation and game-owned read-back gate.
2. Continue live acceptance of the implemented DME snapshot reducer beyond the
   now-proven ordinary out and single. Prove walks, strikeouts, hit-by-pitch,
   extra-base hits, and the warning path for scoring plays; then add scorer/RBI
   and remaining outcome attribution only where measured evidence supports it.
   Capture a complete healthy event stream and keep unavailable metrics explicit
   in the parity ledger.
3. Pass the clean-station happy path, network outage, reattach, one-retry, and
   commissioner-review matrix repeatedly on macOS arm64.
4. Carry a server-published Stat Editor profile through the unattended match
   path. Continue focused user acceptance of the now-separated Matches, Teams,
   Results, and Admin workspaces, following the legacy application's navigation
   and player-first visual language rather than adding dashboard-style
   super-pages.

### Latest acceptance evidence

On 2026-08-11, the complete Stat Editor v4 catalogue was rechecked against a
fresh extraction of the user-owned exact `RMBE01` Rev 0 ISO. The clean
`main.dol` matched SHA-256
`3018e262480ccbf0daa04fc96f1c3dfb340dc4007a13f007f9423751c1346151`.
All 16 region hashes, 24 virtual/file mappings, and 16,406 scalar cells passed.
The verifier then parsed the trusted Sluggers Stat Editor v4.1 source without
executing it; all ten stock matrices and all 16,406 encoded cells matched the
game byte-for-byte. Finally, one representative value in every pattern was
compiled and all 16,406 guarded writes were applied to a temporary DOL copy,
producing 30 changed bytes and output SHA-256
`37d57a5665660de3b4acfca689b8eb3bf6abec5f99e13e7d68918396cfcaf7dd`
without altering the clean source. This completes exact-DOL and compiler
acceptance. The exercise also exposed and fixed a real composition defect:
content guards previously compared the bridge-mutated DOL with the clean
whole-file hash even though every guarded stat region remained exact. The
builder now carries the already-verified base fingerprints through sequential,
non-overlapping bridge and content application while preserving region hashes,
virtual/file mapping checks, and expected-byte guards.

The resulting bridge-plus-profile managed build had build SHA-256
`8ed08246ccba97b1f36f9df8eccf530c0d6ffc5051b0b3a4fe6f325ca6f0c525`
and `main.dol` SHA-256
`95fa2cfa474f8c5492c928c320ac877f80f9bce0d2f09ab3b278c7c837762740`.
It launched in the runner-managed Dolphin 2606, DME attached, and one changed
cell from each of all 24 patterns read back exactly from live emulated memory.
That includes the complete character/chemistry families, trajectories, speed,
pitching, size/catch/hitbox tables, team stars, star handicaps, all three star
boost codecs, and all six handicap instruction immediates. The remaining
product gate is carrying a profile published by the web application through a
normal scheduled runner attempt, not further address discovery.

On 2026-08-11, the local-only Mushroom League fixture exercised the real Remix,
PostgreSQL, and Python runner path. The checkpoint package integrity mismatch
was reconciled, and CLI failures now include their actionable detail. A friendly
JSON match definition was published as normal immutable lineup revisions and
queued as a normal server attempt. Attempt
`438f39a0-b4ca-41cd-93fd-95d2ad80a7da` was leased by the native runner, launched
Dolphin, applied both exact teams at the final formation boundary, passed the
game-owned batting-order and active-defense verifier, and entered live
CPU-vs-CPU play. It remained healthy for 140 station ticks before an intentional
operator stop. This proves the scheduled team path through gameplay, but not a
completed healthy result or automatic confirmation.

The local demo now also includes a full 101-character, 49-field Stat Editor v4
profile: an immutable published revision supplies the seeded two-team draft
room while an editable next revision remains the Stat Editor sandbox. The
Remix application accepts real v4 file uploads and provides focused, typed
screens for characters, chemistry, trajectory names/activation/tables, global
speed curves, team star gains, star boosts, and handicap parameters. Cloned
revisions show prior values inline only where a field changed. Every section
preserves the complete profile and exports the original 507-line representation
losslessly. The profile page is a short section directory rather than a 101-row
super-page; the dedicated character directory keeps the legacy portrait-first
language. Stat Editor and AutoTeam numeric roster slots resolve through the
same readable character catalogue. The local seed is idempotent and prints a
direct draft-room URL.

The league workspace now exposes separate Matches, Teams, Results, and Admin
routes with separate controllers and purpose-sized service read models.
The Teams route uses readable character names and the legacy portrait assets
for rosters and trade selection; raw game IDs are no longer the manager-facing
interaction. Ruleset and lineup revisions no longer expose JSON or monospace
comparison panels. A ruleset starts from the five controls Starworks supports
today, while unsupported imported settings remain visible and unchanged. The
lineup editor keeps the draft/trade-authored roster fixed and provides portrait
rows for captain, batting slot, and fielding position; the player at P becomes
the pitcher. Published lineups render as compact roster summaries instead of
disabled forms. The local seed creates immutable published parents plus
deterministic editable rules and lineup drafts without rewriting history.
Match-attempt creation now selects an immutable ruleset instead of exposing a
raw JSON override field. Results now presents standings, recent scorecards, and
portrait-first player leaders from accepted derivations. Scorer review is
separate from scheduling and uses team/player names plus supported baseball
stats instead of entity IDs, JSON paths, or caller-supplied current values. The
idempotent demo seed includes one historical accepted result for visual testing
without making it runner-claimable, and prints direct draft, match, and Results
URLs. The adapter compile preview also summarizes player tuning, rules, captain,
batting order, and fielding without leaking the operation bundle as raw JSON.
The advertorial league workspace home has been replaced by the legacy site's
data-first shape: league and season identity, top-five standings, and
portrait-first player leaders. Publication policy now belongs to Admin rather
than sharing the home page. The overview read model redacts standings and
player totals independently for anonymous visitors, and its season rebuild uses
one joined derivation query instead of querying once per confirmed attempt.
The completed verification pass includes 35 contract tests, 79 Remix tests,
148 runner tests, and all 16 PostgreSQL integration tests.

On 2026-08-11 a normal-speed live smoke test also forced a seed
profile that had disabled throttling back to `EmulationSpeed = 1.0`, restored
the managed checkpoint, passed scheduled formation read-back, entered inning
one, and advanced DME telemetry. That is live synchronization evidence, not a
completed-game acceptance result.

## Product principles

- Build one platform with two user-facing programs: the web application and the local runner.
- Keep league management, drafting, configuration, results, and public views on the web.
- Keep copyrighted game material, Dolphin, hardware access, game building, capture, and runtime memory access on the runner.
- Treat all cross-program messages as one validated, evolving v0 contract. Add
  compatibility versions only when Starworks reaches its first release boundary.
- Make every league-scoped record explicitly tenant-scoped from the beginning.
- Use immutable revisions for rules, stats, rosters, lineups, content packs, and game builds so completed matches remain reproducible.
- Prefer a modular monolith and ordinary background work in the web process until a separate worker is justified by measured load.
- Use existing tools as behavioral specifications and sources of knowledge, not as permanent compatibility constraints.

## Product boundary

### Starworks web

The web application owns:

- Site administration and league provisioning.
- Discord-first authentication and invitation-based account activation.
- League membership, roles, seasons, schedules, and permissions.
- Immutable stat-profile and ruleset revisions.
- Draft rooms, pick clocks, queues, and draft history.
- Teams, rosters, lineups, field positions, captains, and trades.
- Match scheduling, runner assignment, attempts, and lifecycle state.
- Validated stat events, derived box scores, standings, and history.
- Content-pack manifests and user-supplied assets.
- Public league pages and broadcast overlays.
- Audit logs and administrative recovery tools.

The web application does not receive or store game images, extracted Nintendo assets, full patched game files, raw process-memory instructions, or arbitrary PowerPC code.

### Starworks runner

The runner is a Python 3.12 native application with a PySide6 interface. It owns:

- Station registration and secure job claiming.
- Discovery and verification of a user-owned Mario Super Sluggers dump.
- Deterministic construction and caching of managed game builds.
- Dolphin installation/profile discovery and process lifecycle.
- Team, lineup, ruleset, and match loading.
- Runtime communication with the game adapter.
- Stat/event capture, validation, persistence queues, and retry.
- Save states and recovery where they can be used safely.
- Local video/audio capture. RTMP and broadcast automation remain post-alpha.
- Local diagnostics, logs, build reports, and support bundles.

The runner is not a second league-management UI. It presents the controls and diagnostics needed to operate a station and run assigned matches.

### Sluggers game adapter

The Sluggers adapter lives inside the runner repository and is not another deployed service. It contains:

- Supported game fingerprints and region/revision metadata.
- Static content compilers and guarded binary patch definitions.
- A shared symbol/address catalogue.
- The current pre-release runtime protocol.
- The small game-side Starworks bridge and its build artifacts.
- Adapter compatibility tests and Dolphin boot fixtures that contain no game data.

The matching decompilation project remains an upstream research project. Starworks consumes pinned, reviewed outputs such as symbols, headers, and compiled bridge artifacts.

## Technology decisions

### Web

- Remix 3, initialized in `web/` with `npx remix@next new web` rather than
  repurposing the original single-tenant React Router application.
- TypeScript and Remix's `remix/ui` rendering model; the new application does
  not introduce React as a parallel UI layer.
- PostgreSQL with Drizzle ORM.
- Zod as the source of truth for API and manifest validation.
- JSON Schema generated from Zod for validation in Python.
- Discord OAuth and Discord bot integration as first-class capabilities.
- No public self-service registration.
- No email dependency at launch; Mailpit remains an optional development profile for later email work.

### Runner

- Python 3.12.
- PySide6 for the native UI.
- Pydantic or JSON Schema validation generated from the web-owned contracts.
- A pinned Dolphin release initially.
- Dolphin Memory Engine 1.3.1 as the primary runtime-memory transport, kept
  behind the game-adapter interface; direct process APIs do not leak into match
  orchestration.
- Pinned external binaries where they solve a narrow problem well, including `decomp-toolkit` for game identification and extraction.

Using a Rust implementation of a pinned CLI does not make the runner a Rust application. Python remains responsible for the runner, orchestration, UI, and product behavior.

### Local development

The repository root owns `compose.yml` with:

- Remix web application.
- PostgreSQL.
- Garage for S3-compatible object storage.
- Optional Mailpit profile.

The native runner normally runs outside Compose. A containerized Linux runner is a later deployment profile, not a local-development prerequisite.

The original Sluggers Super Draft implementation is retained under
`legacy/sluggers-super-draft/` as migration input and behavioral prior art.

### Production

Production deployment lives under a dedicated deployment directory and uses:

- Traefik.
- Remix application instances.
- PostgreSQL.
- Garage.
- Backups, observability, and secrets supplied by the deployment environment.

## Tenancy and identity

- Only a site administrator creates a league.
- Accounts are provisioned or invited; a visitor cannot create an account or league.
- A person has one Starworks identity and may belong to multiple leagues.
- Discord is the first login and notification channel.
- Initial roles are `site_admin`, `league_admin`, `commissioner`, `manager`, `scorekeeper`, `runner_operator`, and `member`.
- Authorization is checked against league membership and role on every league-scoped mutation.
- Database uniqueness constraints include the tenant key whenever the concept is tenant-owned.
- Cross-league public views use explicit publication settings rather than accidental data exposure.

## Domain model

The important aggregate roots are:

- Site, person, identity, invite, and runner station.
- League, membership, season, conference/division, and venue.
- Character catalogue and exact game-build compatibility.
- Stat definition, stat profile, and stat-profile revision.
- Ruleset and ruleset revision.
- Draft, draft slot, pick, queue, and clock state.
- Team, roster revision, lineup revision, and trade.
- Match, match attempt, runner assignment, and game-build requirement.
- Content pack, content-pack revision, asset, and build manifest.
- Raw stat event, accepted stat event, correction, box score, and standing.

Published revisions are immutable. A match references the exact revisions used to run it.

## Contracts

The first cross-program contracts are:

### `ContentPackManifest`

Describes high-level, distributable inputs:

- Contract kind and current pre-release discriminator.
- Target game ID and supported revisions.
- Stat-profile and ruleset revisions.
- Trusted adapter build identity.
- User-created assets by content hash.
- Declarative target assignments.

It does not contain original game buffers or absolute offsets into one user's dump.

### `GameBuildManifest`

Produced locally by the runner:

- Base-game fingerprint.
- Adapter and compiler build identities.
- Content-pack hash.
- Output hashes.
- Applied patch receipts.
- Compatibility and warning information.

### `RunEnvelope`

Describes one match attempt:

- League, season, match, and attempt IDs.
- Non-reusable attempt nonce.
- Required game-build hash.
- Team, roster, and lineup revisions.
- Dynamic rule overrides.
- Runner lease and expiry.

### `TelemetryEnvelope`

Carries ordered game events:

- Current v0 contract discriminator; no compatibility matrix exists before the
  first release boundary.
- Match and attempt identity.
- Monotonic sequence number and game frame.
- Event type and validated payload.
- Adapter/build identity.
- Optional checksum or state fingerprint.

## Game integration model

Game integration has three separate layers.

### Static content compilation

The Python runner:

1. Identifies and verifies the user's supported game dump.
2. Extracts it into a private, managed workspace.
3. Applies a trusted adapter and content-pack revision.
4. Checks expected original bytes before every binary mutation.
5. Writes into a new build rather than modifying the user's source dump.
6. Produces an atomic, content-addressed output and build report.
7. Launches Dolphin against the managed extracted filesystem.

Early builds may patch `main.dol`, `dt_na.dat`, and `fst.bin`. Full generated game files stay local to the runner.

The `.sluggie` format may be supported as a local Blender import/export boundary after licensing is resolved. It is not a Starworks cloud contract.

### Runtime bridge

The game-side bridge is a small, trusted PowerPC module. Its current
responsibilities are limited to:

- Protocol and build handshake.
- Match-attempt nonce validation.
- Reading dynamic team, lineup, stat, and ruleset configuration.
- Exposing an explicit heartbeat and configuration receipts.
- Reporting overflow, incompatibility, and fatal adapter errors.

The Python runner communicates through a documented control block and reads
game-owned match state through the same DME adapter boundary. The server sends
declarative match data, never arbitrary Gecko or executable code. The reserved
event ring remains available for a future measured need; it is not evidence
that semantic game hooks are installed today.

The current game-side adapter compiles maintainable C and small reviewed
PowerPC trampolines. Dolphin Memory Engine is the host-side transport. Semantic
hooks are added only when a concrete DME observation cannot be made reliable;
replacing or extending game code does not imply replacing DME.

### Targeted decompilation

Starworks contributes to and consumes the existing `mss-decomp` work instead of starting another competing project by default.

Priority vertical slices are:

- Character stat lookup and loading.
- Team, captain, roster, and lineup initialization.
- Match lifecycle and results transitions.
- Batter, runner, pitcher, and fielder state.
- At-bat resolution and scoring.
- Stat/event-producing gameplay functions.
- Resource directory, model, icon, and texture loading.
- Relevant RNG and synchronization boundaries.

Full matching decompilation and a native PC port are not launch dependencies.

## Content strategy

There are three progressively better content modes:

1. Runtime-only configuration for leagues using stock assets.
2. Locally materialized `main.dol`/`dt_na.dat` builds for stat and asset replacement.
3. A game-side external override archive that contains only replacements and avoids rebuilding a large DAT for every content pack.

The external override archive is the preferred long-term design, but it requires targeted resource-loader research and a proven prototype.

Garage stores content-pack manifests and user-supplied assets. It does not store materialized game builds.

## Match execution

A match attempt follows this lifecycle:

1. The web creates an immutable run envelope.
2. An authorized runner station claims a short-lived lease.
3. The runner verifies or builds the required game-build hash.
4. The runner starts Dolphin in an isolated profile.
5. The bridge completes its build/nonce handshake.
6. The runner loads the teams and starts the game flow.
7. Telemetry is buffered locally and uploaded idempotently.
8. Capture can publish an RTMP stream and overlay data.
9. The game ends and the web derives a provisional result from immutable events.
10. A healthy result auto-confirms with a system audit actor; corrections or
    unhealthy telemetry require commissioner review.

Retries create a new match attempt and nonce. Events from separate attempts can never be silently combined.

## Trust and safety

- Support exact game fingerprints, not broad guesses based only on game ID.
- Patch only a fresh or known output and verify original bytes.
- Reserve and document all game-memory regions used by every patch.
- Keep a collision manifest for Gecko codes, injected modules, and shared-memory blocks.
- Sign or hash trusted adapter releases.
- Reject server requests for raw memory writes or executable patches.
- Treat uploaded assets and runner logs as untrusted input.
- Keep runner credentials revocable and scoped to a station.
- Preserve a local event spool when the web is unavailable.
- Make imports, event ingestion, result derivation, and retries idempotent.

## Licensing constraints

- Starworks targets MIT.
- `decomp-toolkit`, `objdiff`, and Kamek have compatible permissive licensing, subject to their individual notices.
- `mss-decomp` is CC0.
- Sluggies DAT Tools and its upstream currently lack a declared license. Obtain permission from all relevant copyright holders or implement the required behavior independently.
- Do not relicense the existing GPL-derived Mii library merely by changing its license file. Obtain upstream permission or perform a clean implementation.
- Any future Dolphin fork remains GPLv2+ and must be distributed independently
  from the MIT Starworks applications with corresponding source and notices.

## Deliberate non-goals for the first release

- Public self-service league creation.
- Email-dependent signup or notifications.
- Arbitrary community code execution on runners.
- Hosting or distributing game images or reconstructed Nintendo assets.
- A custom Dolphin fork.
- Full matching decompilation.
- A native PC port.
- Large-scale multi-station unattended tournament orchestration. A single
  scheduled match must run unattended for playable alpha.
- A separate queue/worker service without measured need.

## Decision gates

### Custom Dolphin fork

This gate is not met. Dolphin Memory Engine 1.3.1 attached to a runner-managed,
DME-enabled copy of stock Dolphin 2606 on macOS arm64 and completed the real
bridge handshake without GDB. GDB remains reverse-engineering tooling for
breakpoints and registers, so its save-state lifecycle defect does not justify a
production fork. Reconsider a fork only if DME, the game bridge, Pipe input, and
native capture fail a measured product requirement.

### Separate web worker

Extract a worker only after a web-process job causes observable contention, reliability problems, or deployment coupling.

### Full decomp or native port

Treat this as a community research program. Product milestones may depend on named functions or structures, but not on an overall percentage-complete target.

### External content archive

Adopt it after a prototype proves that the game can reliably load replacement resources without embedding original assets and without destabilizing memory allocation.

## Delivery roadmap

The detailed sequence, acceptance criteria, and risk gates live in
[`docs/plans/2026-08-10-starworks-platform.md`](docs/plans/2026-08-10-starworks-platform.md).
The evidence ledger is
[`docs/plans/2026-08-10-starworks-completion-audit.md`](docs/plans/2026-08-10-starworks-completion-audit.md);
it may demonstrate a gate but cannot redefine the status in this file.
