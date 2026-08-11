# Starworks — Agent Guide

Starworks is a multi-league Mario Super Sluggers platform. The repository is a
workspace, not a continuation of the original single-tenant web application.

## Repository boundaries

- `web/` is the new Remix 3 application. Follow `web/AGENTS.md` and its
  generated Remix skill before editing it.
- `runner/` is the Python 3.12 native/headless runner and Sluggers adapter.
- `contracts/` owns Zod contracts and generated JSON Schema.
- `legacy/` contains prior implementations for migration and behavioral
  reference. Do not add new product features there.
- `compose.yml` owns local infrastructure; production topology lives in
  `deploy/prod/`.

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
```

Runner tests use `uv run --project runner --group test pytest runner/tests`.
