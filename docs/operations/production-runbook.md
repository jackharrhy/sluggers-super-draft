# Starworks production runbook

This runbook covers the single-host Compose topology in `deploy/prod`. It is a
production-capable starting point, not a claim of high availability. PostgreSQL
and Garage are private services, Traefik is the only public listener, and
Traefik reaches Docker through a read-only API proxy.

## Provision and deploy

1. Copy `deploy/prod/.env.example` to `deploy/prod/.env` and replace every
   placeholder. Generate independent random values for the session-cookie,
   Starworks metrics, Garage RPC, Garage admin, and Garage metrics secrets.
2. Copy `garage.toml.example` to `garage.toml`, replace its secrets and public
   names, and leave the admin API on the internal network only.
3. Provision the Garage layout, bucket, and least-privilege application key.
   The included one-node layout has no storage redundancy. Garage recommends a
   three-zone, three-replica layout when availability matters.
4. Validate and start the topology:

   ```shell
   docker compose --env-file deploy/prod/.env -f deploy/prod/compose.yml config --quiet
   docker compose --env-file deploy/prod/.env -f deploy/prod/compose.yml up -d --build
   ```

5. Confirm `https://$STARWORKS_HOST/healthz` returns `{"status":"ok"}` and
   `https://$STARWORKS_HOST/readyz` reports both PostgreSQL and Garage ready.
6. Bootstrap the first site administrator once:

   ```shell
   docker compose --env-file deploy/prod/.env -f deploy/prod/compose.yml exec web \
     npm run db:bootstrap-admin -- \
     --discord-user-id YOUR_DISCORD_ID \
     --discord-username YOUR_DISCORD_USERNAME
   ```

The Docker socket proxy permits read-only container, network, event, and
version requests. Its network is internal and shared only with Traefik. The
[Traefik Docker provider documentation](https://doc.traefik.io/traefik/reference/install-configuration/providers/docker/)
explains why unrestricted socket access is equivalent to privileged host
access; the selected proxy implements the filter model described by
[Tecnativa](https://github.com/Tecnativa/docker-socket-proxy).

## League requests

There is no public registration or self-service league creation.

1. A requester sends the site administrator the desired league name and slug,
   plus the Discord identity of the first league administrator.
2. The site administrator verifies the requester out of band and signs in with
   Discord.
3. In `/admin/leagues/new`, the site administrator creates the league. It is
   private by default.
4. Starworks displays one invitation URL once. Send it only to the verified
   Discord user through the agreed private Discord channel.
5. The recipient signs in with Discord and redeems the invitation. The league
   administrator can then configure publication settings, seasons, teams,
   rules, stats, and runner stations.
6. Record unusual approvals or identity corrections in the operator incident
   log; Starworks records the provisioning and redemption actions internally.

Email is not required for this flow.

## Backups

The backup set is a logical PostgreSQL custom-format dump plus an S3 API copy
of the application bucket. This avoids treating a live Garage metadata database
as a portable backup. Garage metadata snapshots remain useful for repairing a
node, as described in the
[Garage recovery guide](https://garagehq.deuxfleurs.fr/documentation/operations/recovering/).

Run a backup from the repository checkout on the production host:

```shell
STARWORKS_ENV_FILE="$PWD/deploy/prod/.env" \
STARWORKS_BACKUP_DIR=/srv/starworks-backups \
S3_BUCKET=starworks \
  deploy/prod/scripts/backup.sh
```

Each timestamped set contains:

- `postgres.dump`, validated with `pg_restore --list`;
- `garage-objects/`, copied through Garage's S3 API;
- `objects.sha256`, with one checksum per object;
- `manifest.env`, with format, time, bucket, database checksum, and object
  count.

Copy completed sets to encrypted storage on a different failure domain. A
reasonable starting policy is daily backups, seven daily, four weekly, and
twelve monthly sets, adjusted to the league's recovery-point requirement. The
script does not prune backups.

Garage documents AWS CLI as a supported client in its
[quick start](https://garagehq.deuxfleurs.fr/documentation/quick-start/). The
operational AWS CLI container is digest-pinned and enabled only by Compose's
`operations` profile.

### Restore drill

Run this at least monthly and before a release that changes persistence:

```shell
deploy/prod/scripts/restore-drill.sh \
  /srv/starworks-backups/20260810T120000Z
```

The drill checks every checksum, starts fresh project-scoped PostgreSQL and
Garage volumes, restores the database, uploads the objects, compares counts,
and removes the isolated project. It never connects to or modifies production.
Set `KEEP_RESTORE_DRILL=1` only when an operator needs to inspect the isolated
containers afterward.

The 2026-08-10 implementation drill restored 49 application tables and both an
empty bucket and a bucket containing a temporary object. This is development
evidence; every production environment still needs its own recurring drill.

## Health, metrics, and alerts

- `/healthz` is a shallow process check.
- `/readyz` checks PostgreSQL and the configured Garage bucket.
- `/internal/metrics` emits aggregate Prometheus metrics and requires
  `Authorization: Bearer $METRICS_BEARER_TOKEN`.
- Traefik excludes `/internal/` from the public router. A scraper must share the
  internal network and scrape `http://web:3000/internal/metrics`.
- Garage exposes separate Prometheus metrics on its internal admin endpoint;
  protect them with Garage's distinct metrics token. See Garage's
  [monitoring guide](https://garagehq.deuxfleurs.fr/documentation/cookbook/monitoring/).

Recommended first alerts:

| Condition | Metric |
| --- | --- |
| Any job or game failure | increase in `starworks_match_attempts_total{status="failed"}` |
| Local build failure | increase with `failure_kind="build-failure"` |
| Bridge mismatch or transport failure | increase with `failure_kind="bridge-failure"` |
| Missing/overflowed telemetry | increase in `starworks_telemetry_derivations_total{status="review"}` |
| Runner disappeared | `starworks_runner_stations_stale > 0` |
| Recording or RTMP unhealthy | `starworks_runner_components{component=~"recording|publishing",state=~"degraded|failed"} > 0` |
| Garage unavailable | `cluster_available == 0` from Garage's metrics |

Request logs are structured JSON and include correlation, actor, league,
attempt, and runner identifiers when those identities are trusted by the
request path. Ship stdout/stderr to the deployment's log system and alert on
`http.request.failed` without indexing credentials or request bodies.

## Discord notifications

Email is not required. Set `DISCORD_BOT_TOKEN` only when notification delivery
is wanted, invite that bot to the Discord server with permission to view and
send messages in the target channel, then let a league administrator save the
numeric channel ID from the league operations page. Starworks disables Discord
mentions in every outbound message.

Draft picks, trade proposals and applications, queued match attempts, and
confirmed results write to a tenant-scoped outbox before delivery. A Discord
failure never rolls back the league action. Administrators can inspect sent,
pending, and failed counts and retry up to 25 queued messages at a time from
the same page. Removing the channel disables future outbox writes without
deleting its audit or delivery history.

## Audit review and credential revocation

League administrators can review the latest 100 append-only audit events in
the existing league operations workspace. For a longer incident window, query
`audit_records` read-only from PostgreSQL and order by `occurred_at` and `id`;
do not edit or delete the records as part of review.

Run a runner-revocation drill quarterly in a test league:

1. Issue a disposable runner credential and register a disposable station.
2. Let it claim a disposable queued match attempt.
3. Use **Revoke station** in the league operations workspace.
4. Confirm the station's next heartbeat and claim are rejected.
5. Confirm its credential and active lease are revoked, the interrupted
   attempt is marked failed, the match returns to a schedulable state, and a
   `runner_station.revoked` audit event appears.

The PostgreSQL integration suite executes this full state transition on every
CI run. The operational drill verifies the deployed network and operator path
as well.

## Release checklist

- CI is green: contracts, Remix tests, PostgreSQL integrations, runner tests,
  Ruff, type checking, Compose validation, and both image definitions.
- `npm audit --omit=dev --audit-level=high` passes. The currently accepted low
  esbuild advisory is confined to Remix's Windows development-server tooling;
  revisit it whenever Remix updates.
- A fresh runner wheel installs and validates its bundled contracts.
- A production backup completes and its isolated restore drill passes.
- `/readyz`, Starworks metrics, Garage metrics, and log ingestion work.
- A runner credential revocation drill has passed in the target environment.
- Session, Discord, S3, Garage, metrics, and RTMP secrets are distinct and are
  not present in image history or logs.
- No game image, extracted retail file, materialized build, credential, or RTMP
  URL is stored in the repository or Starworks server.
- The target platform row in the runner support matrix has passed its required
  hardware gates. Experimental rows are not advertised as supported.
- Release notes state contract, adapter, Dolphin, and database compatibility.

## Rollback and incident priorities

Database migrations are forward-only release artifacts. Prefer a corrected
roll-forward. If data restoration is required, stop writes, preserve current
volumes for forensics, select a verified backup set, and restore into an
isolated environment before directing traffic to it. Never point the restore
drill at production volumes.

For a suspected runner compromise, revoke the station first, rotate any RTMP
secret held by that host, preserve the local runner state database and logs,
and review attempt lifecycle plus audit records by correlation ID. Game dumps
and builds remain runner-local and should not be uploaded with a support bundle.
