# Starworks delivery evidence audit

**Last updated:** 2026-08-12
**Branch:** `codex/starworks-platform`  
**Source plan:** [`2026-08-10-starworks-platform.md`](2026-08-10-starworks-platform.md)

This is an evidence ledger for the delivery plan. It does not declare Starworks
complete: [`PLAN.md`](../../PLAN.md) owns product status and the current
critical path. This ledger separates repository implementation, exact-game
live proof, and complete product workflows from external or owner-operated
gates.

Status meanings:

- **Implemented** — code and automated tests exist in this repository.
- **Live proven** — exercised against the exact supported game and Dolphin
  build on the named platform.
- **Product complete** — connected through the real user workflow with recovery
  and acceptance coverage.
- **Partial** — useful implementation or evidence exists but the stated
  criterion is not satisfied.
- **Owner action** — Codex cannot perform the action without the project owner
  or an external maintainer.
- **Decision-gated** — deliberately excluded from the first release until the
  plan's measured trigger is met.

## Verification baseline

The final audit must rerun these commands from a clean worktree:

```shell
npm --prefix contracts run check
npm --prefix web run typecheck
npm --prefix web test
STARWORKS_TEST_DATABASE_URL=postgres://starworks:starworks@127.0.0.1:5432/starworks_test \
  npm --prefix web run test:db
uvx ruff==0.16.2 check runner
uvx ruff==0.16.2 format --check runner
uv run --project runner --group test pytest runner/tests
docker compose config --quiet
```

The latest 2026-08-12 baseline passed 35 contract tests, 79 Remix tests
(including three Chromium workflows), 16 PostgreSQL integration tests, and 154
Python runner tests. Web type checking, Ruff formatting/lint, Compose
validation, and `git diff --check` also passed. The system `mise` Node installer
still has a local GPG keybox problem, so verification used the workspace's
bundled Node runtime; that environment issue is not a repository test failure.
Production image, wheel, Compose, backup/restore, metrics, FFmpeg, and Linux
runner checks are also represented in CI or the production runbook.

## Milestone acceptance

### Milestone 0 — Repository and contract foundation

| Criterion | Status | Evidence |
| --- | --- | --- |
| Root Compose starts the web dependencies. | **Verified** | [`compose.yml`](../../compose.yml) defines Remix, PostgreSQL, Garage, migrations, and optional Mailpit. Compose validation and `/readyz` were exercised against running containers. |
| One command validates representative contracts in TypeScript and Python. | **Verified** | `npm run contracts:check`; Zod sources and generated schemas live in [`contracts/`](../../contracts), and the runner wheel bundles the same schemas. |
| Community implementation reuse is authorized and attributable. | **Verified for repository contents** | [`PRIOR_ART.md`](../../PRIOR_ART.md) records provenance and licensing constraints. Stat Editor, Stat Tracker, and AutoTeam are trusted direct sources through active contributor/maintainer collaboration; unrelated sources still require their own permission boundary. |
| Product vocabulary and boundaries are documented once. | **Verified** | [`PLAN.md`](../../PLAN.md) is the architectural source of truth and is linked from [`README.md`](../../README.md). |

The new Remix application lives in `web/`; the original site is preserved in
`legacy/sluggers-super-draft/` and is not an active package.

### Milestone 1 — Prove the game boundary early

| Criterion | Status | Evidence |
| --- | --- | --- |
| A supported dump becomes a separate managed build that boots in Dolphin. | **Live proven on macOS arm64** | A maintainer-owned lossless `RMBE01` Rev 0 ISO produced an exact Redump match. The current reviewed bridge artifact (`b5a9a75c…9161`) deterministically produces patched `main.dol` SHA-256 `c7af12d0…bcc6` and game-build identity `1016a240…3d00`; that exact build restored the managed pre-roster checkpoint in Dolphin 2606 and entered CPU gameplay. |
| Rebuilding the same inputs produces the same manifest and hashes. | **Verified with generated fixtures and exact base** | Builder tests cover deterministic manifests, cache hits, interrupted staging, source immutability, and tamper rejection. The current patch plan pins the exact input and output DOL hashes and every guarded hook write; the builder records source immutability. |
| Python completes a nonce-bound handshake with the game. | **Live proven on macOS arm64** | Python DME 1.3.1 attached to the runner-managed Dolphin 2606 copy, verified the exact adapter and game-build digests, negotiated the attempt nonce, and observed an advancing heartbeat. GDB is no longer part of the supported match path. |
| A synthetic event survives pause/recovery and cannot cross attempts. | **Verified** | Bridge, execution binding, event-spool, lease-recovery, and synthetic executor tests cover attribution, duplicates, overflow, and interrupted uploads. |
| Unsupported dumps and modified hooks fail closed. | **Verified** | The provisioned exact fingerprint registry, expected-byte patch guards, target hash checks, and launch-time whole-tree verification reject unknown inputs. The real supported base completed the positive path. |
| Bridge build approach is selected from evidence. | **Verified** | [`patch-toolchain-spike.md`](../game-adapter/patch-toolchain-spike.md) records the pinned LLVM 22.1.8 build, reviewed symbols, low-memory reservation, exact-byte/EOF guards, artifact hashes, and live acceptance; end users need no compiler. |

The adapter evidence is machine-readable. The configuration handshake, both
roster hook calls, and adapter-owned CPU-control receipt are live proven.
Independent reads of the initialized game structures then disproved the stronger
claim that batting order and fielding positions survived the remaining menus;
the runner now fails closed on that mismatch. An unattended seven-inning
adapter-owned CPU game then completed 4–11 in 1,153.9 seconds and emitted 96
ordered DME events, including one terminal `game-ended`. Because its scheduled
formation failed the new read-back gate, it is full-game execution evidence
rather than a valid scheduled-match result. Representative profile mutation
and a complete valid adapter-owned game remain separate gates.

### Milestone 2 — Multi-tenant web foundation

| Criterion | Status | Evidence |
| --- | --- | --- |
| A site admin creates two private leagues and invites their admins. | **Verified** | Site-admin-only provisioning and one-time Discord invitations are covered by service, integration, and Chromium tests. No public registration route exists. |
| One Discord identity belongs to both leagues. | **Verified** | PostgreSQL integration covers redemption and membership in two leagues. |
| Unpublished cross-league data cannot be read or mutated. | **Verified** | Composite tenant foreign keys, scoped services/actions, publication settings, and isolation fixtures cover the boundary. |
| Re-importing a source does not duplicate records. | **Verified** | The dry-run-first legacy importer stores source references and passes its idempotency integration test. |

Roles now distinguish `league_admin`, `commissioner`, `manager`,
`scorekeeper`, `runner_operator`, and `member`; legacy owner/administrator
values remain only for migrated compatibility.

### Milestone 3 — Immutable rules, stats, and teams

| Criterion | Status | Evidence |
| --- | --- | --- |
| An administrator publishes stat-profile and ruleset revisions. | **Verified** | Remix configuration workspace plus PostgreSQL services cover draft, edit, preview, comparison/history, clone, validate, and publish. |
| Published revisions cannot be edited in place. | **Verified** | Database triggers and integration tests enforce immutability. |
| A team publishes a legal lineup. | **Verified** | Web editor supports captain, pitcher, batting order, bench, and fielding; shared fixtures cover publication and locking. |
| Web and runner agree on validation. | **Verified** | Zod-generated JSON Schema and mirrored domain validators consume the same fixtures in TypeScript and Python. |
| The runner translates a profile and lineup into declarative adapter operations. | **Verified** | TypeScript and Python compilers generate and validate the same bounded operation vocabulary; no raw addresses or executable code enter the API. |

### Milestone 4 — Draft and league operations

| Criterion | Status | Evidence |
| --- | --- | --- |
| Multiple managers cannot create conflicting picks. | **Verified** | The authoritative draft locks and versions state in PostgreSQL; concurrency/reversal/automatic-pick behavior is integration tested. |
| Reconnection reconstructs authoritative draft state. | **Verified** | Draft room loaders render persisted slots, queue, clock, picks, and version rather than browser-local state. |
| Commissioner recovery is auditable. | **Verified** | Pause, resume, automatic pick, reversal, and pick events are append-only records. |
| Closing the draft creates valid runner rosters. | **Verified** | Draft completion publishes immutable roster revisions; lineup and run-contract validation consumes those revisions. |

Schedules, deadlines, trades, approvals, roster receipts, and historical
revision references are implemented. Draft picks, trades, queued attempts, and
confirmed results can produce durable tenant-scoped Discord notices; email is
not required.

### Milestone 5 — Runner application and automated setup

| Criterion | Status | Evidence |
| --- | --- | --- |
| An authorized station claims and executes a scheduled match. | **Live proven on macOS arm64; healthy acceptance pending** | Scheduled attempt `d65b7083…f5baf` completed unattended in stock Dolphin 2606 at 1.0× speed after exact teams and active defense passed read-back. Its inconsistent provisional telemetry correctly entered review, so healthy result acceptance remains open. |
| A second station cannot claim the active lease. | **Verified** | PostgreSQL integration exercises two stations, recovery claims, expiry, replacement attempts, and revocation. |
| Correct build, teams, lineup, and nonce reach the game. | **Live proven on macOS arm64** | Run/configuration binding rejects every mismatch. Attempt `d65b7083…f5baf` validated adapter/build/nonce, applied runtime rules, stadium, captains, both roster sets, batting order, fielding, and adapter-owned CPU control, passed independent game-owned read-back, and completed. |
| Web disconnection does not lose captured events. | **Verified with synthetic execution** | SQLite persists active work, configuration, lifecycle updates, and telemetry; retry acknowledgements are idempotent. Real full-game disconnect is an external matrix gate. |
| Cancellation and retry are separate auditable attempts. | **Verified** | Attempt numbers/nonces are immutable and lifecycle/audit records distinguish cancel, fail, expire, replace, and revoke. |

Published content packs are pinned on attempts. Their manifests travel in the
validated match configuration, while only declared user-authored assets can be
downloaded by the station holding that attempt's active lease. Garage bytes and
runner cache entries are independently re-hashed. Retail game files and
materialized builds never use this API.

### Milestone 6 — Real telemetry and stat tracking

| Criterion | Status | Evidence |
| --- | --- | --- |
| A representative full game produces ordered, duplicate-free events. | **Partial with a complete scheduled DME trace** | Attempt `d65b7083…f5baf` uploaded 36 contiguous events, sequence 1–36, with game start/end, both half innings, batter/pitcher changes, and resolved appearances. Three scoring plays lacked safe scorer attribution, producing explicit warnings and a derived 0–2 score that disagreed with the terminal 3–2 score. |
| Disconnect/retry does not double count. | **Verified** | Attempt/sequence uniqueness, duplicate acknowledgement, SQLite spooling, and retry tests cover it. |
| Box scores regenerate from raw events. | **Verified** | Accepted raw events are immutable; the current derivation, box scores, standings, and player totals rebuild deterministically. |
| Missing/overflowing telemetry blocks automatic finalization. | **Verified** | Sequence gaps, overflow, non-hook observations, missing lifecycle/inning/plate-appearance events, score conflicts, corrections, quits, and forfeits enter review. The final transaction rejects a stream that changes during confirmation. |
| Corrections preserve actor, reason, before, and after. | **Verified** | Correction receipts are separate audited rows and the Chromium workflow exercises the scorer UI. |

### Milestone 7 — Local content-pack compiler

| Criterion | Status | Evidence |
| --- | --- | --- |
| A published stat profile creates a deterministic local build. | **Implemented; live acceptance pending** | The complete 507-line Stat Editor v4 profile is typed and losslessly round-trippable. Its 16,406 scalar cells compile through 24 guarded mappings against the exact supported `main.dol`; deterministic builder/cache, overlap checks, and generated fixtures pass. A representative live mutation still needs acceptance in Dolphin. |
| The server stores only manifest and allowed source assets. | **Verified** | PostgreSQL stores immutable manifests/hashes; Garage accepts bounded PNG/WebP user inputs. No game-build upload exists. |
| Conflicting/unsupported patches fail before launch. | **Verified** | Static target selection, base hashes, expected bytes, overlapping write detection, patch-set preflight, and launch revalidation fail closed. |
| Removing a pack returns to the clean cache without unpatching. | **Verified** | Builds are fresh, immutable, and content-addressed; runtime-only/stock attempts select no pack. |

Icon/model/texture mappings, `.sluggie` interoperability, and the external
override archive remain subject to licensing/research gates. No unlicensed DAT
tool code was copied.

### Milestone 8 — Broadcast and unattended profile

| Criterion | Status | Evidence |
| --- | --- | --- |
| A native runner publishes a complete test match to RTMP. | **Partial and post-alpha** | The runner recorded six seconds of the live Dolphin 2606 Sluggers window to a valid H.264 Matroska file. The production attempt executor now owns one non-overwriting recording for the full attempt lifecycle and reports independent component health. Audio, a complete-match recording, and disposable external RTMP acceptance remain. |
| Overlay data follows accepted events. | **Verified** | Public read-only overlay contract, JSON endpoint, and browser-source page derive from accepted/derived match data. |
| Capture failure cannot corrupt telemetry. | **Verified** | Capture is an independent controller and component health channel; failure tests leave execution/spooling untouched. |
| Linux container boots a supported build and completes the bridge handshake. | **Partial and post-alpha** | The pinned `linux/amd64` image, virtual display/audio/capture stack, health command, and synthetic H.264 smoke pass. GPU/input/audio and real bridge validation remain hardware gates. |

Headless OBS and a Dolphin fork remain decision-gated. FFmpeg plus Dolphin's
native frame path is the implemented first capture path, while DME supplies the
stock-emulator runtime memory boundary.

### Milestone 9 — Production hardening and release engineering

| Criterion | Status | Evidence |
| --- | --- | --- |
| Running Compose `/readyz` proves PostgreSQL and Garage. | **Verified** | The built web image was run against root Compose and reported ready only after both dependencies passed. |
| Metrics auth leaks no configuration or tenant data and covers required categories. | **Verified** | Constant-time bearer comparison and aggregate-only match/build/bridge/telemetry/runner/stream metrics are unit tested; Traefik does not route the endpoint publicly. |
| Empty/non-empty Garage and PostgreSQL pass isolated restore. | **Verified locally; deployment drill still required** | Production backup scripts checksum the logical dump and S3 tree; isolated Compose restore drills passed both object-count cases. Each target deployment must repeat the drill. |
| CI covers contracts, web, database, runner, lint, audit, Compose, wheel, and images. | **Verified as workflow definition** | [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml) includes Chromium and Linux/macOS/Windows runner jobs. A hosted run requires pushing the branch. |
| A clean wheel validates bundled contracts. | **Verified** | Wheel build/install smoke passed; tagged releases publish the wheel and `SHA256SUMS`. |
| Production is gated on restore/revocation and supported runner hardware. | **Verified as policy; deployment acceptance pending** | [`production-runbook.md`](../operations/production-runbook.md), [`runner-support.md`](../runner-support.md), and release workflow encode the gates. |

## Open acceptance gates

These require exact-game research, live acceptance, owner infrastructure, or
external permission and must not be replaced with guessed hashes, offsets,
binaries, or claims:

1. **Real game vertical slice:** finish safe scorer/RBI attribution through the
   exact-build DME reducer, add a bridge hook only for a named observation gap,
   auto-confirm a score-consistent scheduled game, live-accept a visible
   published stat mutation, prove ordered telemetry across disconnect/restart,
   and live-validate offline sampling, exact orphan teardown, and the one-retry
   policy. Automated recovery coverage exists, but a web restart exposed that
   these paths were not yet product-complete.
2. **Platform hardware matrix:** repeat boot, bridge, telemetry, capture, RTMP,
   recovery, and revocation gates on every platform advertised as supported.
3. **Deployment acceptance:** push the branch, observe hosted CI, deploy to the
   target environment, and repeat restore plus credential-revocation drills.
4. **External licensing outreach:** the project owner must contact the
   Sluggies/MSS DAT Tools and relevant Mii maintainers before importing their
   code or adopting `.sluggie` as a supported local boundary.

Until gates 1–2 pass, release material must say **software preview**. Starworks
can now autonomously execute a complete scheduled Mario Super Sluggers game,
but it cannot yet claim an automatically accepted score: the first such run was
correctly held for review. The minimal bridge itself is reviewed; its reserved
event ring does not make hook telemetry a mandatory architecture.

## Decision-gated work, not release blockers

- A Dolphin fork is considered only after a measured DME/stock-Dolphin product
  limitation.
- A separate web worker is considered only after measured contention or
  reliability problems.
- A full decomp/native port remains a community research program.
- The external content archive must first prove allocation, cache, latency,
  and hardware safety.
- Headless OBS is added only when FFmpeg plus the web overlay cannot express a
  required scene.
