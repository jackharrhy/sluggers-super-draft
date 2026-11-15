# Starworks platform experiment

Starworks combines a Remix 3 league website, Python 3.12/Dolphin runner, and
Zod/JSON Schema contracts. It is preserved experimental work.

Only inspect, run, modify, or reuse it when explicitly requested. Do not extend
it or make other projects depend on it as part of unrelated work.

When asked to work here, run commands from this directory. Follow `web/AGENTS.md`
and its Remix skill for web changes. Keep build/hash checks and source attribution;
changing hashed adapter sources requires rebuilding their manifests and artifacts.

Use the relevant checks: `npm run contracts:check`, `npm run typecheck`, `npm test`,
and Ruff for Python changes. Configuration and generated state belong in local
`.env` and `.starworks/`; do not blindly relocate identity-bound checkpoints.
