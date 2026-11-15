# Starworks platform experiment

This directory preserves the multi-league playable-alpha platform. It is an
experiment, not the repository's canonical web application or a dependency of
future harnesses by default.

- `web/` owns the Remix 3 UI, services, database schema, and migrations. Follow
  `web/AGENTS.md` and `web/.agents/skills/remix/SKILL.md` before editing it.
- `runner/` owns the Python 3.12 runner and Sluggers adapter.
- `contracts/` owns experiment-local Zod contracts and generated JSON Schema.
- `demo/`, `scripts/`, `deploy/`, `compose.yml`, and `Dockerfile` belong to this
  experiment. Run their commands from this directory.
- The original app lives at `../../apps/sluggers-super-draft/` and has separate
  configuration and migrations.
- Platform plans and operating guides live at
  `../../docs/archive/starworks-platform/`; durable adapter research lives at
  `../../docs/game-adapter/` and `../../docs/research/`.

Keep existing schema/build integrity checks and source provenance. Do not edit
hashed adapter sources merely to update comment paths without rebuilding their
manifests and artifacts. See `../../PRIOR_ART.md` before adapting external code.

Verification from this directory:

```shell
npm run contracts:check
npm run typecheck
npm test
uvx ruff==0.16.2 check runner
uvx ruff==0.16.2 format --check runner
```

Ignored state is local to this experiment. Existing root `.starworks/` and
`research/` data was deliberately not moved; provisioning a fresh demo is safer
than relocating identity-bound checkpoints and private runtime state.
