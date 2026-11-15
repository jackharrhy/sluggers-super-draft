#!/usr/bin/env bash

set -euo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repository_root"

if pgrep -f "[s]tarworks-runner station" >/dev/null; then
  echo "Stop the local Starworks runner before cleaning its operational data." >&2
  exit 1
fi

npm --prefix web run demo:clean

runner_journal="$repository_root/.starworks/demo-runner/normal-speed.sqlite3"
if [[ -f "$runner_journal" ]]; then
  sqlite3 "$runner_journal" <<'SQL'
BEGIN;
DELETE FROM active_run;
DELETE FROM pending_updates;
DELETE FROM telemetry_spool;
DELETE FROM run_history;
COMMIT;
SQL
fi

echo "Local demo operations are clean. League configuration and station registration were preserved."
