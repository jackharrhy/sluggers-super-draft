# Starworks compatibility policy

Starworks has several independent version boundaries. A release note must name
all of them; “the app is version X” is not enough to decide whether a runner,
game build, or stored message is compatible.

## JSON contracts

Every network and artifact contract contains `schemaVersion` and `kind`.

- Additive optional fields may be added within schema version 1 only when old
  producers and consumers continue to validate the message.
- A required field removal, meaning change, type change, or discriminator
  change requires a new schema version.
- A new major schema is introduced alongside the old one for at least one
  release when a safe translation is possible.
- Unknown or invalid input is rejected at the boundary. Neither the web nor the
  runner guesses a legacy file format from shape.
- TypeScript Zod schemas are the source; checked-in JSON Schema is generated and
  validated by both TypeScript and Python in CI.

The public broadcast overlay, runner control, run envelope, telemetry upload,
rules, stats, lineup, content, and game-build contracts currently use schema
version 1.

## Web and runner

Starworks follows semantic versions once a 1.0 release is declared. During the
0.x preview, a minor release may make a breaking operational change and must
call it out in release notes.

- A runner declares its runner version, operating system, architecture,
  adapter IDs, Dolphin version, and features at registration.
- The server sends declarative configuration only. It does not send arbitrary
  memory writes, Gecko code, or executables.
- The server rejects a control or telemetry message that fails its exact schema
  or does not belong to the authenticated runner, league, lease, attempt, and
  nonce.
- Operators update idle runners first, validate contracts, then update the web.
  Do not change a runner during an active attempt.

Before 1.0, the supported combination is the web image and runner wheel from
the same Git tag. Cross-minor support is best-effort unless the release notes
explicitly list it.

## Sluggers adapter and game builds

The first adapter ID is `sluggers-rmbe01`.

- The initial game target is the North American `RMBE01` Rev 0 release.
- Support is based on reviewed hashes for the disc identity, `main.dol`,
  `dt_na.dat`, and `fst.bin`, never game ID alone.
- Static operations verify expected original bytes and collision ranges before
  writing a fresh build tree.
- The build cache key includes base fingerprints, adapter version, and content
  hash. Changing any one creates a different build.
- Bridge protocol version, adapter build ID, game-build hash, and attempt nonce
  must all agree before control or telemetry is accepted.
- Dolphin is pinned to 2606 for the current preview. A Dolphin update requires
  a boot, bridge, telemetry, capture, and recovery acceptance run before the
  compatibility table changes.

Adapter releases are immutable. A fixed adapter gets a new version and build
ID; an old cached build is never silently rewritten in place.

## Database and storage

Database migrations are ordered, checksummed, and applied by the one-shot
`migrate` service before the new web container becomes ready. Production
migrations are forward-only. A rollback requiring old data shape is a restore
event and must follow the production runbook.

Garage stores user-created content assets. PostgreSQL stores their hashes and
object keys. Materialized game builds and retail game content remain local to
the runner and are outside server backup scope.

## Release record

Each GitHub release should include:

- web image tag and digest;
- runner wheel SHA-256;
- JSON schema versions;
- supported runner platforms and remaining hardware gates;
- adapter ID, adapter version/build ID, supported-base registry revision, and
  bridge protocol version;
- required Dolphin version;
- database migration range;
- known security exceptions and upgrade or recovery steps.

Git tags produce the runner wheel and checksum file and publish the web image.
CI installs the wheel into a clean tool environment, validates bundled
contracts, tests database migrations and integrations, and validates both
container definitions before release.
