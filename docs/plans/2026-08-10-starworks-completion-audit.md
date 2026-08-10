# Starworks delivery completion audit

**Date:** 2026-08-10  
**Branch:** `codex/starworks-platform`  
**Source plan:** [`2026-08-10-starworks-platform.md`](2026-08-10-starworks-platform.md)

This is the acceptance record for the delivery plan. It separates work that
can be completed from a public source checkout from work that requires private
game material, physical runner hardware, an external service, or a project
owner's legal/operational action.

Status meanings:

- **Verified** — implemented and exercised in this repository.
- **Software verified; external acceptance pending** — the safe implementation,
  contracts, and synthetic tests exist, but the criterion itself requires a
  lawful game dump, actual Dolphin/game process, hardware, or RTMP endpoint.
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

The branch currently passes 32 contract tests, 42 Remix tests (including three
Chromium workflows), 14 PostgreSQL integration tests, and 85 runner tests.
Production image, wheel, Compose, backup/restore, metrics, FFmpeg, and Linux
runner checks are also represented in CI or the production runbook.

## Milestone acceptance

### Milestone 0 — Repository and contract foundation

| Criterion | Status | Evidence |
| --- | --- | --- |
| Root Compose starts the web dependencies. | **Verified** | [`compose.yml`](../../compose.yml) defines Remix, PostgreSQL, Garage, migrations, and optional Mailpit. Compose validation and `/readyz` were exercised against running containers. |
| One command validates representative contracts in TypeScript and Python. | **Verified** | `npm run contracts:check`; Zod sources and generated schemas live in [`contracts/`](../../contracts), and the runner wheel bundles the same schemas. |
| No unlicensed/incompatible source was copied into Starworks packages. | **Verified for repository contents** | [`PRIOR_ART.md`](../../PRIOR_ART.md) records provenance and licensing constraints. New adapter and platform implementations are clean-room MIT code. |
| Product vocabulary and boundaries are documented once. | **Verified** | [`PLAN.md`](../../PLAN.md) is the architectural source of truth and is linked from [`README.md`](../../README.md). |

The new Remix application lives in `web/`; the original site is preserved in
`legacy/sluggers-super-draft/` and is not an active package.

### Milestone 1 — Prove the game boundary early

| Criterion | Status | Evidence |
| --- | --- | --- |
| A supported dump becomes a separate managed build that boots in Dolphin. | **Verified on macOS arm64** | A maintainer-owned lossless `RMBE01` Rev 0 ISO produced an exact Redump match, provisioned the reviewed fingerprint registry, and completed a private no-op managed build. The integrity-checking runner launched that extracted build in Dolphin 2606; the emulator identified `RMBE01` and visibly rendered the opening sequence before a clean exit. |
| Rebuilding the same inputs produces the same manifest and hashes. | **Verified with generated fixtures and real base** | Builder tests cover deterministic manifests, cache hits, interrupted staging, source immutability, and tamper rejection. Repeating the real-base build returned the same `ef58a889…6edc` cache key and `1a865ac4…d28d` build hash with `cacheHit: true`; the report records `sourceMutated: false`. |
| Python completes a versioned nonce handshake with the game. | **Software verified; external acceptance pending** | Protocol v1, bounded memory access, nonce hashing, synthetic game bridge, and Dolphin Memory Engine transport are implemented. Actual in-game bridge injection is gated below. |
| A synthetic event survives pause/recovery and cannot cross attempts. | **Verified** | Bridge, execution binding, event-spool, lease-recovery, and synthetic executor tests cover attribution, duplicates, overflow, and interrupted uploads. |
| Unsupported dumps and modified hooks fail closed. | **Verified** | The provisioned exact fingerprint registry, expected-byte patch guards, target hash checks, and launch-time whole-tree verification reject unknown inputs. The real supported base completed the positive path. |
| Bridge build approach is selected from evidence. | **Verified** | [`patch-toolchain-spike.md`](../game-adapter/patch-toolchain-spike.md) selects trusted Kamek build plus hash-pinned precompiled runner artifact; end users need no compiler. |

Remaining external release gates are explicit in
`runner/src/starworks_runner/games/sluggers/adapter_manifest.v1.json`: select a
lawful clean-room hook and expected bytes, compile/review the bridge artifact,
and boot/handshake it in Dolphin.

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

### Milestone 3 — Versioned rules, stats, and teams

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
| An authorized station claims and executes a scheduled match. | **Software verified; real execution pending** | Registration, scoped credentials, claim, lease, match configuration, `RunnerStation.run_once`, and a synthetic Sluggers executor are tested. The native PySide shell exposes enrollment/prerequisites/status; real execution remains disabled until the reviewed bridge/game hooks exist. |
| A second station cannot claim the active lease. | **Verified** | PostgreSQL integration exercises two stations, recovery claims, expiry, replacement attempts, and revocation. |
| Correct build, teams, lineup, and nonce reach the bridge. | **Software verified; external acceptance pending** | Run/configuration binding rejects every mismatch; bridge handshake validates adapter/build/nonce. Actual game-side team loading needs the reviewed bridge artifact and hooks. |
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
| A representative full game produces ordered, duplicate-free events. | **Software verified; external acceptance pending** | Semantic contracts, monotonic sequence checks, nonce/build binding, synthetic streams, and the discovery inventory exist. Real event hooks/full-game capture require the reviewed game bridge. |
| Disconnect/retry does not double count. | **Verified** | Attempt/sequence uniqueness, duplicate acknowledgement, SQLite spooling, and retry tests cover it. |
| Box scores regenerate from raw events. | **Verified** | Accepted raw events are immutable; derivation version 1, box scores, standings, and player totals rebuild deterministically. |
| Missing/overflowing telemetry blocks automatic finalization. | **Verified** | Health issues put attempts into review and confirmation refuses incomplete streams. |
| Corrections preserve actor, reason, before, and after. | **Verified** | Correction receipts are separate audited rows and the Chromium workflow exercises the scorer UI. |

### Milestone 7 — Local content-pack compiler

| Criterion | Status | Evidence |
| --- | --- | --- |
| A published stat profile creates a deterministic local build. | **Software verified; real targets pending** | Manifest delivery, operation compilation, guarded writes, asset hashes, deterministic builder/cache, and generated fixtures are complete. Real `main.dol`/DAT target mappings require a lawful base. |
| The server stores only manifest and allowed source assets. | **Verified** | PostgreSQL stores immutable manifests/hashes; Garage accepts bounded PNG/WebP user inputs. No game-build upload exists. |
| Conflicting/unsupported patches fail before launch. | **Verified** | Static target selection, base hashes, expected bytes, overlapping write detection, patch-set preflight, and launch revalidation fail closed. |
| Removing a pack returns to the clean cache without unpatching. | **Verified** | Builds are fresh, immutable, and content-addressed; runtime-only/stock attempts select no pack. |

Icon/model/texture mappings, `.sluggie` interoperability, and the external
override archive remain subject to licensing/research gates. No unlicensed DAT
tool code was copied.

### Milestone 8 — Broadcast and unattended profile

| Criterion | Status | Evidence |
| --- | --- | --- |
| A native runner publishes a complete test match to RTMP. | **Software verified; external acceptance pending** | FFmpeg recording/publishing workers, local-only secrets, independent health, and synthetic capture tests exist. A disposable real RTMP run is still required. |
| Overlay data follows accepted events. | **Verified** | Public read-only overlay contract, JSON endpoint, and browser-source page derive from accepted/derived match data. |
| Capture failure cannot corrupt telemetry. | **Verified** | Capture is an independent controller and component health channel; failure tests leave execution/spooling untouched. |
| Linux container boots a supported build and completes the bridge handshake. | **Software image verified; hardware pending** | The pinned `linux/amd64` image, virtual display/audio/capture stack, health command, and synthetic H.264 smoke pass. GPU/input/audio and real bridge validation remain hardware gates. |

Headless OBS and a custom Dolphin fork remain decision-gated; FFmpeg plus stock
Dolphin is the implemented first path.

### Milestone 9 — Production hardening and release engineering

| Criterion | Status | Evidence |
| --- | --- | --- |
| Running Compose `/readyz` proves PostgreSQL and Garage. | **Verified** | The built web image was run against root Compose and reported ready only after both dependencies passed. |
| Metrics auth leaks no configuration or tenant data and covers required categories. | **Verified** | Constant-time bearer comparison and aggregate-only match/build/bridge/telemetry/runner/stream metrics are unit tested; Traefik does not route the endpoint publicly. |
| Empty/non-empty Garage and PostgreSQL pass isolated restore. | **Verified locally; deployment drill still required** | Production backup scripts checksum the logical dump and S3 tree; isolated Compose restore drills passed both object-count cases. Each target deployment must repeat the drill. |
| CI covers contracts, web, database, runner, lint, audit, Compose, wheel, and images. | **Verified as workflow definition** | [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml) includes Chromium and Linux/macOS/Windows runner jobs. A hosted run requires pushing the branch. |
| A clean wheel validates bundled contracts. | **Verified** | Wheel build/install smoke passed; tagged releases publish the wheel and `SHA256SUMS`. |
| Production is gated on restore/revocation and supported runner hardware. | **Verified as policy; deployment acceptance pending** | [`production-runbook.md`](../operations/production-runbook.md), [`runner-support.md`](../runner-support.md), and release workflow encode the gates. |

## Irreducible open gates

These are not missing ordinary repository code and must not be replaced with
guessed hashes, offsets, binaries, or claims:

1. **Reviewed bridge release:** independently identify a clean hook, record its
   original bytes and collision range, compile the clean-room bridge, review
   symbols/cache barriers, and add hash-pinned artifacts/patch plans.
2. **Real game vertical slice:** load teams/stats/rules, capture a complete
   representative game, prove ordered telemetry across disconnect/restart, and
   validate cancellation/retry with physical or equivalent input.
3. **Platform hardware matrix:** repeat boot, bridge, telemetry, capture, RTMP,
   recovery, and revocation gates on every platform advertised as supported.
4. **Deployment acceptance:** push the branch, observe hosted CI, deploy to the
   target environment, and repeat restore plus credential-revocation drills.
5. **External licensing outreach:** the project owner must contact the
   Sluggies/MSS DAT Tools and relevant Mii maintainers before importing their
   code or adopting `.sluggie` as a supported local boundary.

Until gates 1–3 pass, release material must say **software preview** and must
not claim that Starworks can run a real Mario Super Sluggers match. The empty
target, artifact, and patch-plan arrays are intentional safety controls, not
placeholders to fill from unverified internet values.

## Decision-gated work, not release blockers

- A custom Dolphin fork is considered only after a measured stock-Dolphin
  limitation.
- A separate web worker is considered only after measured contention or
  reliability problems.
- A full decomp/native port remains a community research program.
- The external content archive must first prove allocation, cache, latency,
  and hardware safety.
- Headless OBS is added only when FFmpeg plus the web overlay cannot express a
  required scene.
