# Starworks pre-release compatibility policy

Starworks is v0. The web, runner, contracts, and Sluggers adapter evolve as one
current system until the first real release boundary. We do not maintain old
protocol variants or promise cross-build compatibility yet.

## JSON contracts

Every network and artifact contract is a strict object with a narrow `kind`
discriminator. During v0, a change updates the one checked-in contract, its
fixtures, generated JSON Schema, web producer/consumer, and Python
producer/consumer together. There is no `schemaVersion` field or versioned API
path until Starworks has a real compatibility boundary to maintain.

- Do not introduce parallel v1/v2 models during v0.
- Breaking changes replace the current pre-release shape and require all
  Starworks components to update together.
- Unknown or invalid input is rejected at the boundary. Neither the web nor the
  runner guesses a legacy file format from shape.
- TypeScript Zod schemas are the source; checked-in JSON Schema is generated and
  validated by both TypeScript and Python in CI.

## Web and runner

Starworks will define upgrade and compatibility guarantees when a real release
boundary exists. Before then, the supported combination is the web and runner
from the same source revision.

- A runner declares its runner version, operating system, architecture,
  adapter IDs, Dolphin version, and features at registration.
- The server sends declarative configuration only. It does not send arbitrary
  memory writes, Gecko code, or executables.
- The server rejects a control or telemetry message that fails its exact schema
  or does not belong to the authenticated runner, league, lease, attempt, and
  nonce.
- Operators update idle runners first, validate contracts, then update the web.
  Do not change a runner during an active attempt.

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

Published build artifacts are content-addressed and never silently rewritten.
The adapter implementation itself remains the one current v0 implementation.

## Database and storage

Database migrations are ordered, checksummed, and applied by the one-shot
`migrate` service before the new web container becomes ready. Production
migrations are forward-only. A rollback requiring old data shape is a restore
event and must follow the production runbook.

Garage stores user-created content assets. PostgreSQL stores their hashes and
object keys. Materialized game builds and retail game content remain local to
the runner and are outside server backup scope.

## Future release record

Once Starworks starts producing supported releases, each release should include:

- web image tag and digest;
- runner wheel SHA-256;
- JSON Schema digest and any versions introduced at the release boundary;
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
