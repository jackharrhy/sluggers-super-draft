#!/bin/sh
set -eu

if [ "$#" -ne 1 ]; then
  echo "Usage: $0 /absolute/path/to/backup-set" >&2
  exit 2
fi

backup_set=$1
case "$backup_set" in
  /*) ;;
  *) echo "Backup set path must be absolute" >&2; exit 2 ;;
esac
for required in manifest.env postgres.dump objects.sha256 garage-objects; do
  if [ ! -e "$backup_set/$required" ]; then
    echo "Backup set is missing $required" >&2
    exit 2
  fi
done

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
prod_dir=$(CDPATH= cd -- "$script_dir/.." && pwd)
compose_file="$prod_dir/restore-drill.compose.yml"
project="starworks-restore-drill-$$"

compose() {
  docker compose \
    --project-name "$project" \
    --project-directory "$prod_dir" \
    -f "$compose_file" \
    "$@"
}

sha256_file() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  else
    shasum -a 256 "$1" | awk '{print $1}'
  fi
}

manifest_value() {
  sed -n "s/^$1=//p" "$backup_set/manifest.env"
}

expected_postgres_sha256=$(manifest_value postgres_sha256)
actual_postgres_sha256=$(sha256_file "$backup_set/postgres.dump")
if [ -z "$expected_postgres_sha256" ] || [ "$actual_postgres_sha256" != "$expected_postgres_sha256" ]; then
  echo "PostgreSQL dump checksum does not match the backup manifest" >&2
  exit 1
fi

while IFS='  ' read -r expected object; do
  [ -n "$expected" ] || continue
  actual=$(sha256_file "$backup_set/garage-objects/${object#./}")
  if [ "$actual" != "$expected" ]; then
    echo "Object checksum mismatch: $object" >&2
    exit 1
  fi
done < "$backup_set/objects.sha256"

cleanup() {
  if [ "${KEEP_RESTORE_DRILL:-0}" = "1" ]; then
    echo "Keeping isolated restore project $project"
  else
    compose down --volumes --remove-orphans >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT HUP INT TERM

export STARWORKS_RESTORE_DIR="$backup_set"
echo "Starting isolated restore project $project"
compose up -d --wait --wait-timeout 90 db garage

compose exec -T db pg_restore \
  --username starworks_restore \
  --dbname starworks_restore \
  --exit-on-error \
  --no-owner \
  --no-privileges < "$backup_set/postgres.dump"

compose run --rm --no-deps s3-tools \
  s3 sync /restore/garage-objects s3://starworks-restore --only-show-errors

table_count=$(compose exec -T db psql --username starworks_restore --dbname starworks_restore --tuples-only --no-align \
  --command "select count(*) from information_schema.tables where table_schema not in ('pg_catalog', 'information_schema');")
remote_object_count=$(compose run --rm --no-deps s3-tools \
  s3 ls s3://starworks-restore --recursive | wc -l | tr -d ' ')
expected_object_count=$(manifest_value object_count)

case "$table_count" in
  ''|0|*[!0-9]*) echo "Restored database contains no application tables" >&2; exit 1 ;;
esac
if [ "$remote_object_count" != "$expected_object_count" ]; then
  echo "Restored object count $remote_object_count does not match expected $expected_object_count" >&2
  exit 1
fi

echo "Restore drill passed: $table_count tables and $remote_object_count Garage objects"
