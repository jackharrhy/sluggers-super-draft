# Starworks

Preserved experiment for multi-league Sluggers management, CPU-vs-CPU matches,
telemetry, and broadcasts. It combines a Remix 3 website with a Python/Dolphin
runner. Only work on it when explicitly requested.

Run commands from `experiments/starworks-platform/`:

```shell
npm run setup
uv sync --project runner --group test
cp .env.example .env
# Configure the database, session secret, and Discord credentials.
docker compose up -d db garage
npm --prefix web run db:migrate
npm run dev
```

The website runs at <http://localhost:3000>. Configuration and generated state
use this directory's `.env` and `.starworks/`; root copies are not loaded.
The original application's database and migrations are separate.

## Playable demo

On macOS, provide Dolphin 2606, an owned RMBE01 Rev 0 game image, and an unlocked
seed profile. Override the default inputs with `STARWORKS_DOLPHIN_APP`,
`STARWORKS_SLUGGERS_IMAGE`, and `STARWORKS_SLUGGERS_SEED_SOURCE`.

```shell
npm run demo:setup
# Open http://127.0.0.1:3000/auth/local-demo
npm run demo:play
```

Edit [`demo/sluggers-match.json`](demo/sluggers-match.json) to change the teams.
`demo:queue` queues a match; `demo:runner` runs the station until interrupted.
Miis are unsupported. Re-provision identity-bound checkpoints instead of moving
old profiles blindly. `demo:clean` deletes the demo league's operational records.

Checks: `npm run contracts:check`, `npm run typecheck`, and `npm test`.
See the [runner guide](runner/README.md), [operating guides](docs/README.md),
[game acceptance evidence](docs/game-adapter/request-acceptance.md), and
[community sources](PRIOR_ART.md).
