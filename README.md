# Starworks

Starworks is a multi-league platform for managing Mario Super Sluggers leagues, drafts, teams, game runners, stat tracking, and broadcasts.

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

Copy `.env.example` to `.env`, then start Remix:

```shell
npm run dev
```

Visit `http://localhost:3000`.
