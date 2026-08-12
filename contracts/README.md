# Starworks contracts

Zod schemas in `src/` are the source of truth for data exchanged between the
Starworks web application and runner. Generated Draft 2020-12 JSON Schema files
in `generated/` are checked in so non-TypeScript consumers validate the exact
same contract.

These are pre-release contracts. They reject unknown fields and use a narrow
`kind` discriminator, but do not pretend that the current shape is a published
v1. Until Starworks has external consumers, incompatible changes replace the
generated schema in place. Introduce explicit contract versions only when a
real compatibility boundary exists.

Artifact versions still belong in payloads when they identify something that
must match exactly, such as a Dolphin build, adapter build, game image, stat
profile revision, or binary bridge layout.

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
