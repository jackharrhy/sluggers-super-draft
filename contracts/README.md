# Starworks contracts

Zod schemas in `src/` are the source of truth for data exchanged between the
Starworks web application and runner. Generated Draft 2020-12 JSON Schema files
in `generated/` are checked in so non-TypeScript consumers validate the exact
same contract.

Every top-level contract has a `schemaVersion` and rejects unknown fields. A
new incompatible shape requires a new version; existing published versions are
never edited in place.

Generate artifacts after changing a Zod schema:

```shell
npm run contracts:generate
```

Validate generation plus the shared TypeScript/Python fixtures:

```shell
npm run contracts:check
```

The contracts deliberately contain declarative IDs, hashes, and assignments.
They never carry game images, original game buffers, absolute memory writes, or
executable patch payloads.
