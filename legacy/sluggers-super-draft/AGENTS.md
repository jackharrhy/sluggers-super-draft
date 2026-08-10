# Sluggers Super Draft — Agent Guide

## What is this?

A fantasy baseball league app ("Lil Slug Crew") where users draft teams of Mario Sluggers characters, set lineups, trade players, and compete in match days. Built with React Router v7 (SSR), Express, PostgreSQL via Drizzle ORM, and Tailwind CSS 4.

## Project structure

```
app/
├── components/    # Shared UI (StandingsTable, ConferencePin, Lineup, etc.)
├── routes/        # React Router v7 file routes (loaders + components)
├── utils/         # Server utilities (standings, matches, teams, etc.)
├── discord/       # Discord bot integration
├── parsing/       # Data import parsers
├── auth.server.ts # Discord OAuth2 auth
├── root.tsx       # Root layout
└── app.css        # Global styles + Tailwind theme
database/
├── db.ts          # Drizzle ORM instance (postgres-js)
└── schema.ts      # Full database schema
drizzle/           # SQL migrations
server/            # Express app
scripts/           # Data seeding scripts
```

## Key conventions

- **Framework:** React Router v7 with SSR (`ssr: true`). Routes export `loader` functions for data fetching and default components for rendering.
- **Database:** Drizzle ORM with relational queries (`db.query.X.findMany({ with: { ... } })`). Schema in `database/schema.ts`.
- **Styling:** Tailwind CSS 4 with custom theme colors (notably `cell-gray`). Custom fonts: Aurea, NewCezanne (default sans), NewRodin (`font-rodin`), PopHappiness, ITC Bolt.
- **No tests:** There is no test infrastructure. No vitest, jest, or playwright.
- **Build:** `npm run build` to check for TypeScript/build errors.

## Ticket tracking with `tk`

Use the `tk` CLI tool for task management. Tickets are stored as markdown in `.tickets/`.

```bash
# Create a ticket
tk create "Title" -t feature -d "Description" --acceptance "Criteria" --tags ui,backend

# List open tickets
tk ls

# Show ticket details
tk show <id>

# Start / close / reopen
tk start <id>
tk close <id>
tk reopen <id>

# Dependencies and links
tk dep <id> <depends-on-id>   # id depends on depends-on-id
tk link <id> <id>             # symmetric link
tk ready                      # tickets with all deps resolved
tk blocked                    # tickets with unresolved deps

# Notes
tk add-note <id> "text"

# Partial ID matching works (e.g., tk show 5c4)
```

Plans for tickets go in `docs/plans/YYYY-MM-DD-<topic>.md`.
