# Sluggers workspace

A Mario Super Sluggers league website for drafting teams, setting lineups,
trading players, and tracking matches.

The [original application](apps/sluggers-super-draft/README.md) uses React Router
v7, Express, and PostgreSQL. Root `dev`, `start`, and `build` commands run it.

[Starworks](experiments/starworks-platform/README.md) is a preserved multi-league
experiment with a Remix 3 web app and Dolphin runner. Work on it only when asked.
Root `test` and `contracts:check` run its suites; `typecheck` checks both projects.

Use `test/<thing>/` for small standalone investigations. Keep game images,
credentials, and emulator state out of Git.

See [PRIOR_ART.md](PRIOR_ART.md) for community sources and licensing notes.
