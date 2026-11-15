# Sluggers

This repo contains a Mario Super Sluggers league website and preserved experiments.
The original React Router v7 / Express app is in `apps/sluggers-super-draft/`.

Starworks, in `experiments/starworks-platform/`, is an experimental multi-league
platform with a Remix 3 web app, Python/Dolphin runner, and shared schemas.
Only inspect, run, modify, or reuse Starworks when the user explicitly asks.
Do not use it as the default architecture, include it in unrelated cleanup, or
run its checks as part of unrelated work. Its supporting archived docs are also
reference-only unless requested.

For requested work, follow the project's local `AGENTS.md` and run only relevant
checks. Root `dev`, `start`, and `build` target the original app; root `test`,
`contracts:check`, and part of `typecheck` run Starworks.

Keep small standalone investigations in `test/<thing>/`, with their run command.
Leave project tests with their code. Keep credentials, owned game images, and
emulator state out of Git. Read `PRIOR_ART.md` before adapting external code;
retain attribution when reusing trusted community implementations.
