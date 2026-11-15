#!/usr/bin/env bash

set -euo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repository_root"

image="${STARWORKS_SLUGGERS_IMAGE:-$HOME/Downloads/Mario Super Sluggers (USA) (En,Fr,Es).iso}"
dolphin_source="${STARWORKS_DOLPHIN_APP:-/Applications/Dolphin.app}"
seed_source="${STARWORKS_SLUGGERS_SEED_SOURCE:-$repository_root/../../research/dolphin-profiles/rmbe01-seed-dolphin-2606}"
managed_dolphin="$repository_root/.starworks/tools/Dolphin-DME.app"
managed_executable="$managed_dolphin/Contents/MacOS/Dolphin"
seed_profile="$repository_root/.starworks/profiles/rmbe01-managed-pre-roster-seed"
checkpoint_directory="$repository_root/.starworks/checkpoints/rmbe01-managed-pre-roster"

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "The playable-alpha demo bootstrap currently supports macOS only." >&2
  exit 1
fi
if [[ ! -f "$image" ]]; then
  echo "Mario Super Sluggers image not found: $image" >&2
  echo "Set STARWORKS_SLUGGERS_IMAGE to your exact RMBE01 Rev 0 ISO or RVZ." >&2
  exit 1
fi
if [[ ! -x "$dolphin_source/Contents/MacOS/Dolphin" ]]; then
  echo "Dolphin application not found: $dolphin_source" >&2
  echo "Set STARWORKS_DOLPHIN_APP to a Dolphin 2606 application bundle." >&2
  exit 1
fi
source_dolphin_version="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$dolphin_source/Contents/Info.plist" 2>/dev/null || true)"
if [[ "$source_dolphin_version" != "2606" ]]; then
  echo "Starworks currently requires Dolphin 2606: $dolphin_source" >&2
  exit 1
fi
if [[ ! -d "$seed_source" ]]; then
  echo "Unlocked Dolphin seed profile not found: $seed_source" >&2
  echo "Set STARWORKS_SLUGGERS_SEED_SOURCE to a profile containing the 100% save." >&2
  exit 1
fi

echo "[1/6] Installing the pinned game-image tool"
uv sync --project runner --group test
uv run --project runner starworks-runner install-dtk \
  --tool-directory .starworks/cache/tools

echo "[2/6] Preparing the private DME-enabled Dolphin 2606 copy"
mkdir -p .starworks/tools
managed_dolphin_version="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$managed_dolphin/Contents/Info.plist" 2>/dev/null || true)"
managed_entitlements="$(codesign -d --entitlements :- "$managed_dolphin" 2>/dev/null || true)"
if [[ ! -x "$managed_executable" ]] || \
  [[ "$managed_dolphin_version" != "2606" ]] || \
  [[ "$managed_entitlements" != *"com.apple.security.get-task-allow"* ]]; then
  temporary_directory="$(mktemp -d "$repository_root/.starworks/tools/.dolphin-bootstrap.XXXXXX")"
  trap 'rm -rf "$temporary_directory"' EXIT
  ditto "$dolphin_source" "$temporary_directory/Dolphin-DME.app"
  codesign --force --deep --sign - \
    --entitlements runner/assets/dolphin-dme-entitlements.plist \
    "$temporary_directory/Dolphin-DME.app"
  rm -rf "$managed_dolphin"
  mv "$temporary_directory/Dolphin-DME.app" "$managed_dolphin"
  rmdir "$temporary_directory"
  trap - EXIT
fi

echo "[3/6] Verifying the owned ISO and rebuilding the managed game"
build_result="$(uv run --project runner starworks-runner build-sluggers \
  --image "$image" \
  --cache .starworks/cache)"
echo "$build_result"
build_directory="$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).buildDirectory)' "$build_result")"
build_sha256="$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).buildSha256)' "$build_result")"

echo "[4/6] Recreating the unlocked seed profile and guarded checkpoint"
uv run --project runner starworks-runner prepare-sluggers-checkpoint \
  --build-directory "$build_directory" \
  --dolphin "$managed_executable" \
  --source-profile "$seed_source" \
  --seed-profile "$seed_profile" \
  --checkpoint-directory "$checkpoint_directory"

echo "[5/6] Seeding the local website and runner credential"
docker compose up -d db garage
STARWORKS_DEFAULT_GAME_BUILD_SHA256="$build_sha256" npm --prefix web run demo:seed

echo "[6/6] Starting the Remix application"
docker compose --env-file .starworks/demo.env up -d --build web

echo
echo "Starworks local demo is ready."
echo "Open http://127.0.0.1:3000/auth/local-demo"
echo "Run 'npm run demo:runner' to execute the queued match."
