# Sluggers Super Draft

This is the canonical original single-tenant Lil Slug Crew application: React
Router v7 with SSR, Express, PostgreSQL/Drizzle, and Tailwind CSS 4. Its source,
assets, migrations, chemistry editor, and tickets are retained here.

```shell
cd apps/sluggers-super-draft # from the repository root
npm ci
cp .env.example .env
# Configure the app's database and Discord credentials in .env.
npm run dev
```

Run `npm run typecheck` and `npm run build` to verify changes. There is no test
suite for this application. Database commands such as `npm run db:migrate`
apply only to this app's database; the Starworks experiment uses a different
schema and migration history.

The separate Remix 3 experiment lives in `../../experiments/starworks-platform/`.
It is not a replacement dependency of this application. See `AGENTS.md` for
the original app's conventions.
