# Starworks production topology

This directory is a reviewed topology template, not a one-command production
deployment. It keeps Traefik and the web app on an edge network while
PostgreSQL and Garage remain on a private internal network. Traefik is the only
service publishing host ports.

## Before deployment

1. Copy `.env.example` to an operator-owned `.env` and replace every placeholder.
2. Copy `garage.toml.example` to an operator-owned `garage.toml`, generate the
   RPC/admin/metrics secrets, and point `GARAGE_CONFIG_FILE` at it.
3. Decide the Garage durability topology. Garage recommends at least three
   nodes for a real deployment; this single-host Compose topology has no object
   redundancy and must not be represented as highly available.
4. Provision the Garage layout, application key, and bucket before starting the
   web application.
5. Configure encrypted PostgreSQL/Garage backups and restore drills outside the
   Compose file.
6. Keep the Docker socket risk in mind. A socket proxy or another discovery
   mechanism is preferable when the hosting environment supports it.
7. Bootstrap the first site administrator after the migration service succeeds:

   ```shell
   docker compose --env-file .env exec web npm run db:bootstrap-admin -- \
     --discord-user-id YOUR_DISCORD_ID --discord-username YOUR_DISCORD_USERNAME
   ```

Validate interpolation without deploying:

```shell
docker compose \
  --env-file deploy/prod/.env.example \
  -f deploy/prod/compose.yml \
  config --quiet
```

The dashboard is intentionally not routed publicly. App-level email remains
optional and is not part of this production topology.
