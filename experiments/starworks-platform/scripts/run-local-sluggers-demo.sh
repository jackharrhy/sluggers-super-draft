#!/usr/bin/env bash

set -euo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repository_root"

demo_environment=".starworks/demo.env"
if [[ ! -f "$demo_environment" ]]; then
  echo "Missing $demo_environment. Run 'npm run demo:setup' first." >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "$demo_environment"
set +a

if [[ -z "${STARWORKS_RUNNER_CREDENTIAL:-}" ]]; then
  echo "STARWORKS_RUNNER_CREDENTIAL is missing. Run 'npm run demo:setup' again." >&2
  exit 1
fi

exec uv run --project runner starworks-runner run-sluggers-station \
  --url "${STARWORKS_URL:-http://127.0.0.1:3000}" \
  --station-name "Local demo station" \
  --state .starworks/demo-runner/normal-speed.sqlite3 \
  --cache .starworks/cache \
  --dolphin .starworks/tools/Dolphin-DME.app/Contents/MacOS/Dolphin \
  --profile .starworks/profiles/demo-runs \
  --seed-profile .starworks/profiles/rmbe01-managed-pre-roster-seed \
  --checkpoint-manifest .starworks/checkpoints/rmbe01-managed-pre-roster/checkpoint.json \
  "$@"
