#!/bin/sh
set -eu

: "${STARWORKS_BACKUP_DIR:?Set STARWORKS_BACKUP_DIR to an operator-controlled backup directory}"

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
prod_dir=$(CDPATH= cd -- "$script_dir/.." && pwd)
compose_file=${STARWORKS_COMPOSE_FILE:-"$prod_dir/compose.yml"}
project_directory=${STARWORKS_PROJECT_DIRECTORY:-"$prod_dir"}
backup_root=$STARWORKS_BACKUP_DIR

mkdir -p -- "$backup_root"
backup_root=$(CDPATH= cd -- "$backup_root" && pwd)
case "$backup_root" in
  /|/etc|/usr|/var) echo "Refusing unsafe STARWORKS_BACKUP_DIR: $backup_root" >&2; exit 2 ;;
esac

compose() {
  if [ -n "${STARWORKS_ENV_FILE:-}" ]; then
    docker compose --project-directory "$project_directory" --env-file "$STARWORKS_ENV_FILE" -f "$compose_file" "$@"
  else
    docker compose --project-directory "$project_directory" -f "$compose_file" "$@"
  fi
}

sha256_file() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  else
    shasum -a 256 "$1" | awk '{print $1}'
  fi
}

bucket=${S3_BUCKET:-starworks}
case "$bucket" in
  *[!A-Za-z0-9._-]*|'') echo "S3_BUCKET contains unsupported characters" >&2; exit 2 ;;
esac

stamp=$(date -u +%Y%m%dT%H%M%SZ)
backup_set="$backup_root/$stamp"
if [ -e "$backup_set" ]; then
  echo "Backup set already exists: $backup_set" >&2
  exit 2
fi
umask 077
mkdir -p -- "$backup_set/garage-objects"

echo "Exporting PostgreSQL to $backup_set/postgres.dump"
compose exec -T db sh -c 'pg_dump --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --format=custom' > "$backup_set/postgres.dump"
compose exec -T db pg_restore --list < "$backup_set/postgres.dump" >/dev/null

echo "Copying Garage bucket $bucket through the S3 API"
export STARWORKS_BACKUP_DIR="$backup_set"
compose --profile operations run --rm --no-deps s3-tools \
  s3 sync "s3://$bucket" /backup/garage-objects --only-show-errors

(
  cd "$backup_set/garage-objects"
  find . -type f -print | LC_ALL=C sort | while IFS= read -r object; do
    printf '%s  %s\n' "$(sha256_file "$object")" "$object"
  done
) > "$backup_set/objects.sha256"

postgres_sha256=$(sha256_file "$backup_set/postgres.dump")
object_count=$(wc -l < "$backup_set/objects.sha256" | tr -d ' ')
created_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)
printf '%s\n' \
  'format_version=1' \
  "created_at=$created_at" \
  "s3_bucket=$bucket" \
  "postgres_sha256=$postgres_sha256" \
  "object_count=$object_count" > "$backup_set/manifest.env"

echo "Backup complete: $backup_set ($object_count Garage objects)"
