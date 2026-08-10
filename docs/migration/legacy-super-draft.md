# Legacy Sluggers Super Draft import

The importer is a one-time boundary around the preserved application in
`legacy/sluggers-super-draft`. It does not make that application's PostgreSQL
schema, CSV files, or generated assets part of the Starworks contract.

## Scope

The v1 extractor reads the legacy organization model:

- its single season;
- Discord-backed users;
- conference groupings;
- match locations; and
- teams and their managers.

It converts those records to a Zod-validated
`starworks.legacy-super-draft-snapshot.v1` value. The importer maps that value
to league-scoped Starworks people, memberships, roles, seasons, conferences,
venues, and teams. Character stats, rosters, lineups, drafts, matches, trades,
and results enter through their versioned domain models in later milestones;
the legacy database is not their new API.

## Safe workflow

Provision the target league and bootstrap its site administrator first. Then
run a dry run, which is the default:

```shell
DATABASE_URL=postgres://starworks:starworks@127.0.0.1:5432/starworks \
  npm --prefix web run import:legacy -- \
  --league-id TARGET_LEAGUE_UUID \
  --actor-person-id SITE_ADMIN_PERSON_UUID \
  --source-database-url "$LEGACY_DATABASE_URL"
```

Review the JSON action list, then add `--apply` to commit it. An operator may
instead pass `--snapshot /path/to/snapshot.json`; the same Zod schema validates
both sources.

Every imported source entity receives an `import_references` record containing
its source identity, target UUID, and canonical SHA-256 content hash. A rerun
with identical data skips the entity. A changed source hash fails closed and
requires an explicit reconciliation rather than silently overwriting active
Starworks data. Existing Discord identities are reused, allowing one person to
join multiple imported leagues without duplicate accounts.
