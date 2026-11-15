# Starworks platform experiment

Starworks is a preserved multi-league platform experiment for managing Mario Super Sluggers leagues, drafts, teams, game runners, stat tracking, and broadcasts.

Run all commands on this page from `experiments/starworks-platform/`.
The experiment's web application lives in `web/` and uses Remix 3. The canonical
original application lives separately at `../../apps/sluggers-super-draft/`.
This experiment is not the default architecture for new work.

Local configuration and generated state belong in this directory's `.env` and
`.starworks/`. Pre-reorganization root `.env` and `.starworks/` were left untouched
and are not loaded automatically. The demo's default unlocked seed source still
points to the repository's ignored root `research/dolphin-profiles/` directory;
override it with `STARWORKS_SLUGGERS_SEED_SOURCE` when needed. Re-provision the demo
rather than blindly moving checkpoints that are tied to exact builds and profiles.

## Local platform

Start the PostgreSQL, Garage, migration, and Remix services from the repository root:

```shell
docker compose up --build web
```

The site is available at <http://127.0.0.1:3000>. Mailpit remains optional through the `email`
profile. Local Discord sign-in requires `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, and
`DISCORD_REDIRECT_URI`; the rest of the application remains usable without email.
`DISCORD_BOT_TOKEN` is optional: when present, each league administrator can configure a Discord
channel from the operations page for draft, trade, runner-queue, and confirmed-result notices.
When the token is absent or Discord is temporarily unavailable, core league actions still succeed
and configured notices remain in the tenant-scoped outbox for an administrator to retry.

Bootstrap the first site administrator after migrations have run:

```shell
DATABASE_URL=postgres://starworks:starworks@127.0.0.1:5432/starworks \
  npm --prefix web run db:bootstrap-admin -- \
  --discord-user-id YOUR_DISCORD_ID --discord-username YOUR_DISCORD_USERNAME
```

League creation is deliberately site-admin-only. A new league starts private and produces a
one-time Discord invitation for its first administrator. There is no public registration route.

### Local interactive demo

Provision or rebuild the complete local demo from the owned Sluggers image,
Dolphin 2606, and the local unlocked seed profile:

```shell
npm run demo:setup
```

The command is safe to rerun. It installs the checksum-pinned extraction tool,
creates a private DME-enabled copy of `/Applications/Dolphin.app`, verifies and
builds the exact image from `~/Downloads/Mario Super Sluggers (USA)
(En,Fr,Es).iso`, recreates the guarded pre-roster checkpoint when missing,
seeds the website, and starts Remix. Override those local inputs with
`STARWORKS_SLUGGERS_IMAGE`, `STARWORKS_DOLPHIN_APP`, or
`STARWORKS_SLUGGERS_SEED_SOURCE`.

Open <http://127.0.0.1:3000/auth/local-demo>. The local login endpoint exists
only when the ignored, mode-`0600` `.starworks/demo.env` explicitly enables it,
and it refuses non-loopback hostnames. Production remains Discord-only.

The seeded **Mushroom League** contains Mario Fireballs and Wario Muscles,
published lineups, a ruleset, a stat profile, Mario Stadium, and a queued match
attempt. Its human-readable match definition is
[`demo/sluggers-match.json`](demo/sluggers-match.json). Edit that file, then
publish the exact teams and queue a fresh server-backed attempt with:

```shell
npm run demo:queue
```

For runner and telemetry iteration, queue the same real workflow as a
one-inning game instead of waiting for the seven-inning demo:

```shell
npm run demo:queue:smoke
```

This uses the same lineup publication, scheduling, lease, and configuration
path as the web product; it is not a separate hard-coded Dolphin demo. The
Operations page can also schedule matches, issue station credentials, and
queue attempts. The private environment file contains
`STARWORKS_RUNNER_CREDENTIAL` for launching the native Python runner.

With the demo services running and a queued attempt available, launch the
local CPU-vs-CPU station with:

```shell
npm run demo:runner
```

For a fresh one-inning attempt followed immediately by the station, use:

```shell
npm run demo:play
```

The command loads the ignored demo credential itself, uses the reviewed local
checkpoint and seed profile, and keeps polling until interrupted with Ctrl+C.
Run it without `--max-ticks` for a playable demo: one tick may only launch the
game and then deliberately detach it for recovery testing. The continuous
command remains attached until the game completes and the station reports
`no-work`.
The runner uses the game's Random Fill action only to allocate its formation
buffers. It replaces those buffers with the scheduled captains, batting orders,
and fielding positions before Begin, then independently reads them back from
live gameplay memory. A mismatch fails the attempt instead of silently playing
a random team.

Miis are not supported by this demo yet. Unlike the 77 built-in characters,
their identities come from the runner profile's local `RFL_DB.dat`; Starworks
will need an explicit station-local Mii mapping before they can safely appear
in a portable league lineup.

The preserved application's data enters through a dry-run-first, idempotent adapter documented in
the [migration guide](../../docs/archive/starworks-platform/migration/legacy-super-draft.md). Its old database and
files are source material, not Starworks contracts.

Starworks is released under the [MIT License](../../LICENSE). Dependencies and prior
art keep their own licenses; absence from the codebase does not mean absence
from the community map.

See the archived [architecture and product plan](../../docs/archive/starworks-platform/PLAN.md), the [phased delivery plan](../../docs/archive/starworks-platform/plans/2026-08-10-starworks-platform.md), and the [prior-art/community map](../../PRIOR_ART.md).
The [completion audit](../../docs/archive/starworks-platform/plans/2026-08-10-starworks-completion-audit.md)
records every milestone criterion and the remaining game, hardware, deployment,
and licensing gates without treating them as completed software tests.
Production operation is covered by the [production runbook](../../docs/archive/starworks-platform/operations/production-runbook.md),
with separate [runner support](../../docs/archive/starworks-platform/runner-support.md) and [compatibility](../../docs/archive/starworks-platform/compatibility-policy.md)
policies.

## Workspace

- `web/` — clean Remix 3 application generated with `remix@next`.
- `runner/` — Python runner and Sluggers adapter.
- `contracts/` — Zod contracts and generated JSON Schema.
- `../../apps/sluggers-super-draft/` — separate original application.
- `compose.yml` — local shared infrastructure.

## Setting up

Install the JavaScript packages:

```shell
npm run setup
```

Create the Python runner environment:

```shell
uv sync --project runner --group test
```

Start local infrastructure:

```shell
docker compose up -d db garage
```

Garage's S3 API is available on `127.0.0.1:3900`. Email is not required; start
the optional Mailpit UI on `127.0.0.1:8025` only when working on future email
features:

```shell
docker compose --profile email up -d mailpit
```

Copy `.env.example` to `.env`, then start Remix:

```shell
npm run dev
```

Visit `http://localhost:3000`.

Process health is available at `/healthz`; `/readyz` checks PostgreSQL and
Garage. Local aggregate metrics use `/internal/metrics` with the bearer token
from `METRICS_BEARER_TOKEN`.
