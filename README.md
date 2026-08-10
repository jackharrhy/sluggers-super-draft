# Starworks

Starworks is a multi-league platform for managing Mario Super Sluggers leagues, drafts, teams, game runners, stat tracking, and broadcasts.

See the [architecture and product plan](PLAN.md), the [phased delivery plan](docs/plans/2026-08-10-starworks-platform.md), and the [prior-art/community map](PRIOR_ART.md).

## setting up

start the database:

```shell
docker compose up db
```

install packages:

```shell
npm install
```

copy `.env.example` to `.env` and provide a `DATABASE_URL` with your connection string.

run db migrations:

```shell
npm run db:migrate
```

> TODO: ingest seed data

start the web server:

```shell
npm run dev
```

visit `http://localhost:3000`
