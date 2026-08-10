# Starworks Platform Delivery Plan

**Date:** 2026-08-10

**Goal:** Evolve the existing Sluggers projects into one multi-league platform with a Remix web application and a Python runner that can build, launch, automate, track, and broadcast Mario Super Sluggers matches.

**Architectural source of truth:** [`PLAN.md`](../../PLAN.md)

## Implementation status

As of 2026-08-10, the public-checkout software is implemented through the
production/release slice and verified with contract, Remix/Chromium,
PostgreSQL, runner, Compose, image, wheel, capture, and recovery tests. The
criterion-by-criterion record is
[`2026-08-10-starworks-completion-audit.md`](2026-08-10-starworks-completion-audit.md).
It is authoritative about which criteria are fully verified and which still
require a lawfully dumped reviewed game image, compiled in-game bridge, actual
Dolphin/hardware run, external RTMP/deployment, or maintainer action.

No pending hardware or game-data gate should be interpreted as a reason to
weaken a fingerprint, expected-byte, nonce, tenancy, or credential check.

## Planning assumptions

- Existing repositories are references and migration sources, not fixed components.
- Existing CSV, pickle, spreadsheet, SQLite, Gecko text, and application-specific JSON formats are not public Starworks contracts.
- The first supported game is the North American `RMBE01` Rev 0 release.
- The site administrator provisions leagues and initial administrators.
- Discord is required for initial interactive login; email is optional and later.
- The web application is a modular monolith.
- The runner is a native Python/PySide6 application.
- Stock Dolphin is used until a custom-fork decision gate is met.
- Game images and materialized builds never pass through the Starworks server.
- Matching decompilation improves the adapter but does not gate product delivery.

## Workstreams

The plan has four cooperating workstreams:

1. **Platform:** tenancy, identity, league administration, drafts, teams, schedules, and public views.
2. **Runner:** station management, local game builds, Dolphin lifecycle, match automation, and capture.
3. **Game adapter:** static patches, runtime protocol, telemetry, and content compilation.
4. **Reverse engineering:** symbols, structures, targeted decompilation, and compiled bridge tooling.

The workstreams meet at explicit integration milestones. Reverse engineering can proceed continuously without placing a vague “finish the decomp” item on the critical path.

## Milestone 0 — Repository and contract foundation

### Outcomes

- Starworks has one documented architecture and vocabulary.
- Web and runner code can share versioned JSON contracts without sharing runtime implementation.
- Local and production infrastructure layouts are established.
- Licensing blockers are recorded before code is copied.

### Work

- Confirm the final repository layout around the existing application:

  ```text
  web/                       new Remix 3 application
  runner/                    Python/PySide6 runner
    starworks/games/sluggers Sluggers adapter and bridge
  contracts/                 Zod schemas and generated JSON Schema
  docs/
  deploy/prod/               Traefik and production deployment
  compose.yml                local web dependencies
  legacy/                    prior implementations and migration sources
  ```

- Scaffold `web/` with `npx remix@next new web`; do not evolve the original
  single-tenant application in place.
- Move Sluggers Super Draft under `legacy/` with its original branding intact,
  and treat it as a migration source rather than a Starworks package.
- Adopt Zod schemas with explicit `schemaVersion` discriminators.
- Generate JSON Schema artifacts and prove validation of the same fixture in TypeScript and Python.
- Add correlation IDs, actor IDs, league IDs, match-attempt IDs, and runner IDs to structured logs.
- Expand root `compose.yml` to include PostgreSQL and Garage, with Mailpit behind an optional profile.
- Add `deploy/prod` with a documented Traefik topology; do not attempt production deployment yet.
- Record licensing status for every source project:
  - Existing four local applications.
  - Sluggies DAT Tools and MSS DAT Tools.
  - Mii libraries.
  - Project Rio components.
  - Dolphin and any selected memory-engine library.
  - `decomp-toolkit`, objdiff, and Kamek.
- Contact the Sluggies/MSS DAT Tools maintainers about a permissive license before importing code. This is an external action and requires the project owner.

### Acceptance criteria

- A clean checkout can start the web dependencies with root `compose.yml`.
- One command validates representative contract fixtures in both TypeScript and Python.
- No Starworks package contains code copied from an unlicensed or incompatible source.
- Product terminology and architectural boundaries are documented once and linked from the README.

## Milestone 1 — Prove the game boundary early

This milestone deliberately precedes a large web rewrite. It retires the highest technical risks while the integration surface is still small.

### 1A. Deterministic game-build spike

- Add a headless Python CLI under the future runner package.
- Discover a user-selected game image without copying it into the repository.
- Invoke a pinned `decomp-toolkit` binary to identify, verify, and extract the supported data partition.
- Fingerprint at minimum:
  - Disc/game identity.
  - `main.dol`.
  - `dt_na.dat`.
  - `fst.bin`.
- Reject unsupported or modified bases with a useful diagnostic.
- Build into a temporary directory and atomically promote only after verification.
- Produce `GameBuildManifest` and `build-report.json` even for a no-op build.
- Launch the extracted build in a pinned Dolphin release.
- Cache by base fingerprint, adapter version, and content-pack hash.
- Never mutate the source dump or source extraction.

### 1B. Runtime bridge spike

- Define version 1 of the control block and event-ring binary layout.
- Reserve one documented, collision-checked memory region.
- Implement a minimal trusted patch that exposes:
  - Magic value.
  - Protocol version.
  - Adapter build ID.
  - Attempt nonce.
  - Heartbeat/frame counter.
  - One synthetic event.
- Have Python detect Dolphin, attach, negotiate the handshake, write a nonce, and consume the event safely.
- Confirm all emulator-memory interaction occurs behind the adapter API.
- Measure polling overhead and missed/duplicate event behavior.

### 1C. Patch-toolchain spike

- Reproduce one existing guarded Sluggers hook without copying unlicensed code.
- Compare two approaches:
  - Python applying a precompiled patch artifact.
  - Kamek compiling/linking a small C/C++ bridge during trusted development/CI.
- End users must not need CodeWarrior or a PowerPC build environment.
- Export bridge symbols and memory reservations into a machine-readable adapter manifest.

### Acceptance criteria

- A clean supported dump becomes a separately managed build that boots in Dolphin.
- Re-running the same build produces the same manifest and hashes.
- A Python test client completes a versioned nonce handshake with the game.
- A synthetic event survives pause/resume and is never attributed to the wrong attempt.
- Unsupported dumps and modified hook sites fail closed.
- The team can select the bridge build approach using measured evidence.

## Milestone 2 — Multi-tenant web foundation

### Identity and provisioning

- Add people, Discord identities, invites, sessions, and audit records.
- Disable open registration.
- Add a site-admin workflow to create a league and issue its initial invitation.
- Link a provisioned account to Discord on first successful OAuth login.
- Add revocable sessions and runner credentials.

### Tenant model

- Introduce league, membership, role, season, conference/division, venue, and publication settings.
- Add league scope to every migrated team, character assignment, draft, match, trade, and result.
- Enforce scope in loaders/actions and database constraints.
- Add explicit cross-league fixtures to test isolation.

### Migration

- Write import adapters for the current Sluggers Super Draft data.
- Import into new domain objects rather than preserving the old schema as the contract.
- Keep source identifiers in an import-reference table for audit and reruns.
- Make imports dry-runnable and idempotent.

### Acceptance criteria

- A site admin can create two leagues and invite their administrators.
- The same Discord identity can belong to both leagues.
- Users cannot read or mutate unpublished data from another league.
- Importing the same source twice does not duplicate domain records.

## Milestone 3 — Versioned rules, stats, and teams

### Stat definitions and profiles

- Model a stat definition independently from a character's value.
- Support data types, ranges, enum choices, display metadata, gameplay mapping, and validation rules.
- Create draft and published stat-profile revisions.
- Provide a web-based editor with comparison, validation, preview, and change history.
- Import existing Stat Editor knowledge through a one-time adapter.
- Generate declarative content-pack operations from a published revision.

### Rulesets

- Model game rules independently from stat profiles.
- Publish immutable ruleset revisions.
- Record which settings are web-only, build-time, and runtime-loadable.

### Teams and lineups

- Model roster and lineup revisions independently.
- Support captain, batting order, bench, field positions, pitcher, and per-match overrides.
- Import AutoTeam behavior as domain operations and runner actions, not by retaining its file format.
- Validate lineups both on the web and immediately before game loading.

### Acceptance criteria

- A league administrator can publish a stat profile and ruleset.
- Published revisions cannot be edited in place.
- A team can create and publish a legal lineup.
- The same fixtures yield the same validation results in web and runner.
- The runner can translate a published profile and lineup into adapter-level declarative operations.

## Milestone 4 — Draft and league operations

### Draft room

- Create a server-authoritative draft state machine.
- Support configurable order, rounds, timer, pauses, queues, and commissioner intervention.
- Use database transactions/locking to prevent duplicate picks.
- Record every pick and administrative action in an append-only history.
- Show chemistry and relevant stat-profile values without coupling the UI to the original database layout.
- Produce initial roster revisions when the draft closes.

### Ongoing operations

- Add schedules, matches, trade proposals, approvals, deadlines, and roster changes.
- Ensure every roster-changing operation creates a new revision.
- Preserve completed-match references to historical rosters and lineups.

### Acceptance criteria

- Multiple managers can complete a draft without conflicting picks.
- Reconnection reconstructs draft state from authoritative data.
- Commissioner recovery actions are auditable.
- A completed draft produces valid team rosters for the runner contract.

## Milestone 5 — Runner application and automated match setup

### Native application

- Create the PySide6 application shell around the proven Milestone 1 libraries.
- Add station enrollment, authentication, update status, and revocation.
- Display local prerequisites and supported game-build status.
- Keep a headless CLI for diagnostics and future container use.

### Job lifecycle

- Implement runner registration, capabilities, heartbeat, lease, renewal, release, and revocation.
- Claim a `RunEnvelope` with a short-lived attempt nonce.
- Download only manifests and user-created assets.
- Resolve or build the required local game-build hash.
- Launch Dolphin with an isolated profile and deterministic settings.
- Load teams, lineups, stats, and rules through the adapter.
- Guide or automate menu transitions according to proven capabilities.
- Prevent two runners or two attempts from submitting as the same execution.

### Recovery

- Persist the active job and telemetry spool locally.
- Recover after runner restart without silently creating a second attempt.
- Separate operator cancellation, game crash, runner crash, and web disconnection.
- Upload logs and support bundles only with explicit operator action or configured consent.

### Acceptance criteria

- An authorized station can claim and execute a scheduled match.
- Another station cannot claim the same active lease.
- The correct build, teams, lineup, and attempt nonce appear in the game bridge.
- Runner/web disconnection does not lose already captured events.
- Cancellation and retry produce separate auditable attempts.

## Milestone 6 — Real telemetry and stat tracking

### Event discovery

- Inventory the current Stat Tracker's observations and output fields.
- Map them to candidate game functions and structures in the shared symbol catalogue.
- Define semantic events rather than periodic whole-memory snapshots wherever possible.
- Prioritize:
  - Game start/end.
  - Inning and half-inning.
  - Batter and pitcher changes.
  - Plate appearance result.
  - Hits, outs, runs, RBIs, errors, walks, strikeouts, and bases.
  - Substitutions and fielding positions.

### Bridge implementation

- Emit events from stable game lifecycle points.
- Include sequence, frame, attempt nonce, event type, and compact payload.
- Detect overflow and mark the attempt as requiring review.
- Where hooks are not yet understood, allow clearly labelled provisional observations from read-only memory tracking.

### Ingestion and derivation

- Make event upload idempotent on attempt/sequence.
- Store raw accepted events before deriving box scores.
- Version derivation logic.
- Support auditable corrections that never rewrite the original event stream.
- Rebuild standings and player totals deterministically.

### Acceptance criteria

- A representative full game yields an ordered, duplicate-free event stream.
- Disconnect/retry does not double-count events.
- Box scores can be regenerated from stored events.
- Missing or overflowing telemetry is visible and blocks automatic finalization.
- Manual corrections record actor, reason, before, and after values.

## Milestone 7 — Local content-pack compiler

This milestone begins after the no-op builder and stat profile model are stable. It can advance incrementally as format coverage improves.

### Initial supported operations

- In-place character stat replacement.
- Trusted static DOL hooks.
- Icon replacement where the input and output constraints are understood.
- Model/texture replacement only after licensing or independent implementation is resolved.

### Build safety

- Every operation declares supported base hashes and expected bytes.
- Detect conflicting writes before changing files.
- Keep a memory/code-cave collision manifest.
- Apply changes to a fresh build tree.
- Generate patch receipts and final file hashes.
- Boot-test a representative build in Dolphin.

### Local interchange

- If legally available, support `.sluggie` import/export locally for Blender workflows.
- Extract only user-authored changes into Starworks content-pack inputs.
- Never upload original buffers embedded in an interchange file automatically.

### External override archive research

- Decompile the resource directory and file-loading path.
- Determine whether directory filename pointers can safely target an additional archive.
- Prototype a small `Starworks/content.dat` containing one replacement.
- Measure allocation behavior, loading latency, cache behavior, and hardware compatibility.
- Keep DAT hammerspace materialization until the override design proves superior.

### Acceptance criteria

- A published stat profile produces a deterministic local game build.
- The server stores only the manifest and allowed source assets.
- Conflicting or unsupported patches fail before launch.
- Removing a content pack returns to the clean cached base without an in-place unpatch procedure.

## Milestone 8 — Broadcast and unattended runner profile

### Broadcast

- Expose read-only overlay endpoints from the web for score, inning, teams, players, and recent events.
- Add a runner capture controller for Dolphin video/audio.
- Begin with FFmpeg where sufficient; evaluate headless OBS only for scene/compositing features that require it.
- Support RTMP destination configuration through runner-local secrets.
- Report capture and publishing health independently from game health.

### Containerized Linux profile

- Preserve the same runner core and headless CLI.
- Package Dolphin, virtual display/Wayland compositor, audio, capture, and runner in a reproducible image only after native execution is stable.
- Pass through GPU, input, and audio explicitly.
- Keep user game material in mounted local storage.
- Provide health checks for runner lease, Dolphin, bridge, capture, and RTMP.

### Acceptance criteria

- A native runner can publish a complete test match to an RTMP endpoint.
- Overlay data follows the accepted event stream.
- Capture failure does not corrupt match telemetry.
- The optional Linux container can boot a supported local build and complete the bridge handshake on documented hardware.

## Milestone 9 — Production hardening and release engineering

### Production topology

- Pin third-party runtime images by descriptive tag and OCI manifest digest.
- Keep PostgreSQL and Garage on a private network and expose only Traefik.
- Put a read-only Docker API proxy between Traefik and the host socket.
- Run the web and migration containers with read-only roots, dropped
  capabilities, no-new-privileges, and explicit temporary filesystems.
- Keep `/internal/metrics` off the public Traefik router.

### Recovery and observability

- Expose shallow health, dependency readiness, and token-protected aggregate
  Prometheus metrics.
- Report match/build/bridge failures, telemetry review states, stale runners,
  active leases, and independent capture/publishing health without tenant
  labels.
- Create a logical PostgreSQL plus Garage S3 backup set with checksums.
- Restore every backup into isolated, project-scoped PostgreSQL and Garage
  volumes and verify application tables plus object counts.
- Surface the latest tenant audit records in the existing league operations
  workspace.
- Document and continuously test runner-station revocation through credentials,
  leases, attempts, match recovery, lifecycle events, and audit records.

### Distribution

- Package the native Python runner as a wheel containing the generated contract
  schemas it needs outside a source checkout.
- Install and validate that wheel in a clean tool environment in CI.
- Publish the wheel and SHA-256 file from version tags and publish the matching
  web image.
- Document installation, update, recovery, supported-platform, compatibility,
  site-admin league-request, backup, monitoring, and incident workflows.

### Acceptance criteria

- `/readyz` proves PostgreSQL and the configured Garage bucket from the running
  Compose web image.
- Unauthorized metrics requests reveal no endpoint configuration or tenant
  data; an authorized scrape exposes every required operational category.
- An empty and non-empty Garage bucket plus the complete PostgreSQL schema pass
  the isolated restore drill.
- CI runs all contract, web, database, runner, lint, audit, Compose, wheel, and
  container-definition checks.
- A clean runner wheel validates its bundled contracts.
- Production release is blocked until the target deployment's restore and
  revocation drills pass and the intended runner platform satisfies the
  external acceptance matrix.

## Continuous reverse-engineering track

### Collaboration

- Coordinate with `Whodeyy1234/mss-decomp` and its Ghidra project before creating another decomp repository.
- Contribute names, signatures, structures, and matching functions upstream where appropriate.
- Keep Starworks-specific product code out of the matching decomp.
- Pin reviewed symbol/export revisions in the Sluggers adapter.

### Priorities

1. Functions already hooked or polled by Stat Editor, Stat Tracker, AutoTeam, Sluggies DAT Tools, and known Gecko codes.
2. Match lifecycle and telemetry-producing functions.
3. Team/lineup/stat loading.
4. Resource loading needed for external overrides.
5. RNG and synchronization knowledge useful for reproducible automation.
6. General matching work that reduces uncertainty in adjacent code.

### Deliverables

- Named symbol map with provenance and confidence.
- Typed structures with size/offset assertions.
- Generated Python and C/C++ bindings where appropriate.
- Function-level notes and reproducible Ghidra/decomp-toolkit setup.
- Matching or behaviorally equivalent implementations for selected vertical slices.
- Reviewed bridge releases with protocol compatibility metadata.

Progress is measured by product-relevant unknowns retired as well as matching percentage.

## Cross-cutting verification

### Web

- Unit tests for domain rules and authorization.
- Database tests for tenancy, revision immutability, and idempotency.
- Browser tests for provisioning, drafting, lineup publication, runner assignment, and result correction.

### Runner

- Unit tests using process and Dolphin fakes.
- Golden fixtures for manifests and patch plans without copyrighted data.
- Integration tests for interrupted builds, leases, event spooling, and recovery.
- Platform tests on supported Windows, macOS, and Linux versions.

### Game adapter

- Exact input fingerprints.
- Expected-byte checks for every patch.
- Generated overlap/collision reports.
- Protocol compatibility tests.
- Dolphin smoke tests for clean and modified builds.
- Recorded synthetic telemetry fixtures for web ingestion.

### Operations

- PostgreSQL and Garage backup/restore exercises.
- Runner credential revocation drills.
- Audit-log review paths.
- Metrics for job failures, build failures, bridge mismatches, telemetry gaps, and stream health.

## Release slices

### Internal alpha

- Site-admin league provisioning.
- One imported league.
- Versioned stats, rules, teams, and lineups.
- Web draft.
- One registered native runner.
- Verified local build and manual match launch.
- Initial telemetry with operator-confirmed results.

### League beta

- Multiple isolated leagues.
- Automated team/lineup loading.
- Reliable core stat events and deterministic box scores.
- Content-pack stat compilation.
- Discord notifications and commissioner workflows.
- Optional RTMP publishing.

### Public release

- Documented runner installer/update path.
- Supported-platform matrix.
- Recovery and diagnostic tooling.
- Stable adapter and contract compatibility policy.
- Production backup/restore and observability.
- Explicit workflow for requesting a new league from the site administrator.

Custom models, external content archives, a custom Dolphin fork, and unattended container runners may graduate independently when their decision gates are met.

## Immediate next planning tickets

The first implementation tickets should be created in this order:

1. Define Starworks repository layout and contract generation.
2. Add Garage and optional Mailpit to root Compose.
3. Create the Python runner package and headless CLI.
4. Spike `decomp-toolkit` identification/extraction for `RMBE01`.
5. Define `GameBuildManifest` and produce a deterministic no-op build.
6. Define the bridge control block and event ring protocol.
7. Prove the synthetic Dolphin handshake and event.
8. Audit licenses and request DAT-tool/Mii-library permission.
9. Design the multi-tenant identity and league schema.
10. Build site-admin league provisioning and Discord invitation activation.

The game-boundary tickets and platform-foundation tickets can proceed together. Draft UI expansion waits until the tenancy and revision model is established.

## Research references

- Sluggies DAT Tools: https://github.com/Jaws-git/Sluggies-dat-tools
- MSS DAT Tools: https://github.com/LlamaTrauma/MSS-dat-tools
- Sluggers format documentation: https://thatsrightigame.com/sluggers/format_docs/
- Sluggers matching decomp: https://github.com/Whodeyy1234/mss-decomp
- decomp-toolkit: https://github.com/encounter/decomp-toolkit
- dtk-template: https://github.com/encounter/dtk-template
- objdiff: https://github.com/encounter/objdiff
- Kamek: https://github.com/Treeki/Kamek
- Project Rio organization: https://github.com/ProjectRio
- Project Rio ASM: https://github.com/ProjectRio/ProjectRio-ASM
- Dolphin: https://github.com/dolphin-emu/dolphin
