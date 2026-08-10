# Starworks

Starworks is a multi-league platform for managing Mario Super Sluggers leagues, drafts, teams, game runners, stat tracking, and broadcasts.

The active web application lives in `web/` and is a clean Remix 3 application. The original
single-tenant Sluggers Super Draft code is preserved for migration reference under
`legacy/sluggers-super-draft/`; it is not the active web architecture.

## Local platform

Start the PostgreSQL, Garage, migration, and Remix services from the repository root:

```shell
docker compose up --build web
```

The site is available at <http://127.0.0.1:3000>. Mailpit remains optional through the `email`
profile. Local Discord sign-in requires `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, and
`DISCORD_REDIRECT_URI`; the rest of the application remains usable without email.

Bootstrap the first site administrator after migrations have run:

```shell
DATABASE_URL=postgres://starworks:starworks@127.0.0.1:5432/starworks \
  npm --prefix web run db:bootstrap-admin -- \
  --discord-user-id YOUR_DISCORD_ID --discord-username YOUR_DISCORD_USERNAME
```

League creation is deliberately site-admin-only. A new league starts private and produces a
one-time Discord invitation for its first administrator. There is no public registration route.

Starworks is released under the [MIT License](LICENSE). Dependencies and prior
art keep their own licenses; absence from the codebase does not mean absence
from the community map.

See the [architecture and product plan](PLAN.md), the [phased delivery plan](docs/plans/2026-08-10-starworks-platform.md), and the [prior-art/community map](PRIOR_ART.md).

## Workspace

- `web/` — clean Remix 3 application generated with `remix@next`.
- `runner/` — Python runner and Sluggers adapter.
- `contracts/` — Zod contracts and generated JSON Schema.
- `legacy/` — preserved prior applications for migration and reference.
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
docker compose up -d
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
