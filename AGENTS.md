# Sluggers workspace — Agent Guide

The original league application and the preserved Starworks experiment are
independent projects. Do not assume experimental architecture is the default
for new work.

## Repository boundaries

- `apps/sluggers-super-draft/` is the canonical original React Router v7 /
  Express application. Follow its `AGENTS.md`; it is not Remix 3.
- `experiments/starworks-platform/` preserves the complete multi-league platform.
  Follow its `AGENTS.md` and the web-local Remix skill when working there.
- `test/<thing>/` is for standalone test harnesses, not relocated application
  unit tests. Each harness should document its inputs and run command.
- `docs/game-adapter/` and `docs/research/` keep durable findings and provenance.
- `docs/archive/starworks-platform/` contains historical plans and operating
  guides, not a mandate to rebuild the platform.

Keep each project's dependencies, migrations, tests, configuration, and deployment
with that project. Do not extract shared packages without a concrete need.

Existing file formats and single-tenant assumptions are not Starworks public
contracts. Sluggers Stat Tracker, Sluggers Stat Editor, and MSS AutoTeam are
trusted direct implementation references maintained with project contributors;
reuse useful implementation knowledge with explicit provenance. Review other
unlicensed or incompatible projects under `PRIOR_ART.md` before adapting code.

## Verification

Run the narrowest test while developing, then the root checks before a commit:

```shell
npm run contracts:check
npm run typecheck
npm test
npm run build
```

The root development/build commands target the original app. Root tests target
the experiment because the original app has no test suite. Runner-only tests:

```shell
cd experiments/starworks-platform
uv run --project runner --group test pytest runner/tests
```
