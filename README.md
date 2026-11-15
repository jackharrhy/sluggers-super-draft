# Sluggers workspace

This repository keeps the original Sluggers Super Draft application alongside
preserved experiments. The Starworks platform is an experiment, not the required
foundation for new work.

```text
apps/sluggers-super-draft/       Original React Router v7 / Express league app
experiments/starworks-platform/ Remix 3 platform, Python runner, contracts, deployment
test/                          Small standalone test harnesses (none added yet)
docs/game-adapter/              Game/adapter discoveries and acceptance evidence
docs/research/                  Durable research notes
docs/plans/                     Original application plans
docs/archive/starworks-platform/ Historical platform plans and operating guides
```

## Original application

```shell
npm ci --prefix apps/sluggers-super-draft
cp apps/sluggers-super-draft/.env.example apps/sluggers-super-draft/.env
# Configure that app's database and Discord credentials before running it.
npm run dev
```

Root `dev`, `start`, and `build` commands target the original application. Its
database and migrations are separate from Starworks; do not point either app's
migration commands at the other's database. See the
[application README](apps/sluggers-super-draft/README.md).

## Preserved platform experiment

```shell
cd experiments/starworks-platform
npm run setup
uv sync --project runner --group test
npm test
```

Its [README](experiments/starworks-platform/README.md) covers local infrastructure,
demo setup, and runner commands. Run those commands from the experiment directory,
not the repository root. Nothing is automatically deployed merely by running tests.

Root `npm run typecheck` checks both projects; `npm test` runs the experiment's
existing suites (the original app has no test suite). Each project retains its
own dependencies, lockfiles, migrations, and tests; there is no shared install or
new monorepo framework. `npm run setup` installs both projects' JavaScript dependencies.

## New work and local files

Use `test/<thing>/` for small independently runnable harnesses and `experiments/`
for larger prototypes. Promote code into maintained applications deliberately;
the experimental contracts and services are not repository-wide APIs.

Existing ignored root `.env`, `.starworks/`, `research/`, and scratch files are
left untouched by the reorganization. They are not moved, imported, or loaded
automatically by either application. The experiment uses its own `.env` and
`.starworks/`; regenerate its demo or explicitly provision local inputs rather
than moving identity-bound checkpoints blindly. Keep owned game images, save
states, credentials, and downloaded research out of Git.

See [PRIOR_ART.md](PRIOR_ART.md) for source provenance and licensing boundaries.
