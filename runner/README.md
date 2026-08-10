# Starworks runner

The runner is the local, Python 3.12 side of Starworks. It owns game-image
verification, deterministic build construction, Dolphin control, the Sluggers
adapter, telemetry spooling, and capture. Its tested headless core is shared by
the PySide6 native application and the diagnostic CLI.

Install the native UI extra and open a runner station:

```shell
uv sync --project runner --extra gui --group test
STARWORKS_RUNNER_CREDENTIAL='paste-the-issued-credential' \
  uv run --project runner --extra gui starworks-runner desktop \
  --url http://127.0.0.1:3000 \
  --station-name 'Tournament desk one'
```

The credential is held in process and is never written into the runner's local
SQLite database. Registration metadata, an active match envelope, and pending
lifecycle acknowledgements are journaled there so restarting the runner cannot
silently claim or execute a second attempt. The same server-side lease remains
authoritative; local recovery does not extend an expired lease by itself.

When an attempt names a published content pack, the station receives its
manifest with the leased match configuration and fetches only the declared
user-authored assets. Assets are addressed and verified by SHA-256, stored in
the runner-local cache, and rechecked before reuse. Game images, retail files,
materialized builds, and raw memory instructions never cross the Starworks API.

Tagged releases include a wheel with bundled contract schemas and checksums.
See the [runner installation, update, support, and recovery policy](../docs/runner-support.md)
before installing a station outside a source checkout.

Registration compares the installed runner version with the server's minimum
and recommended versions. The native status card reports whether the station
is current, has an update available, or must update before it can be supported.

Validate the shared contract fixtures directly:

```shell
uv run --project runner --group test starworks-runner validate-contracts
```

Install the pinned, hash-verified `decomp-toolkit` release into a runner-owned
tool directory:

```shell
uv run --project runner starworks-runner install-dtk --tool-directory .starworks/tools
```

Then create a bridge-enabled managed build from a user-selected, clean image:

```shell
uv run --project runner starworks-runner build-sluggers \
  --image /path/to/RMBE01.rvz \
  --cache .starworks/cache \
  --dtk .starworks/tools/dtk/1.8.3/dtk-macos-arm64
```

The one-time production fingerprint review requires an image for which the
pinned `decomp-toolkit` reports an exact Redump match. A full ISO or lossless
RVZ dump can satisfy that gate. A commonly scrubbed WBFS may still boot and its
data partition may validate, but missing unused disc sectors mean it cannot
independently prove the exact retail base. Converting that WBFS to another
format does not restore the discarded evidence; make a new lossless dump from
the owned disc instead.

The checked-in retail fingerprint registry contains the reviewed North American
Rev 0 hashes. The build command fails closed when any required file differs
from that exact base. Starworks never writes to the selected image and never
uploads it.

The review candidate is produced locally without retaining the extraction:

```shell
uv run --project runner starworks-runner fingerprint-sluggers \
  --image /path/to/RMBE01.rvz \
  --dtk .starworks/tools/dtk/1.8.3/dtk-macos-arm64
```

Managed extracted builds are launched by pointing Dolphin at their
`game/sys/main.dol`; Dolphin recognizes the adjacent `sys/`, `files/`, and
`disc/` directories as an extracted Wii filesystem:

```shell
uv run --project runner starworks-runner launch-sluggers \
  --build-directory .starworks/cache/builds/BUILD_KEY \
  --dolphin /path/to/Dolphin \
  --profile .starworks/profiles/station-1 \
  --gdb-socket /tmp/starworks-station-1.sock
```

Bridge protocol v1 is documented in
`docs/game-adapter/bridge-protocol-v1.md`. Its polling path can be measured with
no game data or Dolphin process:

```shell
uv run --project runner starworks-runner benchmark-bridge --iterations 10000
```

With a bridge-enabled build starting paused, `probe-bridge` connects to
Dolphin 2606's built-in GDB remote stub, initializes the bounded bridge control
block, continues the CPU, validates the adapter and game build IDs, negotiates
a one-attempt nonce, and consumes only events attributed to that attempt:

```shell
uv run --project runner starworks-runner probe-bridge \
  --gdb-socket /tmp/starworks-station-1.sock \
  --adapter-build-sha256 ARTIFACT_SHA256 \
  --game-build-sha256 GAME_BUILD_SHA256 \
  --attempt-nonce URL_SAFE_NONCE_OF_AT_LEAST_32_CHARACTERS
```

Unix-domain sockets are used on macOS/Linux. On Windows, launch and probe with
the same `--gdb-port`; the probe defaults to `127.0.0.1`. The optional
`legacy-dme` extra retains Dolphin Memory Engine for supported Windows/Linux
setups, but it is not the primary path and is not used on macOS.

The patch-toolchain spike can be reproduced locally:

```shell
uv run --project runner starworks-runner evaluate-patch-toolchains \
  --size-mib 8 --iterations 5
```

It benchmarks the hash- and byte-guarded precompiled-artifact path. The selected
release builder uses pinned LLVM/Clang/LLD 22.1.8; compilers remain maintainer
dependencies and are never runner or operator dependencies. See
`docs/game-adapter/patch-toolchain-spike.md` for the evidence and release gates.

## Capture and RTMP

The native runner uses independent FFmpeg workers for recording and RTMP. A
publishing failure therefore reports degraded capture health without stopping
the game or its durable telemetry spool. Stream URLs and keys are supplied only
through a runner-local environment variable and are omitted from status output.

This synthetic source verifies the recording path without Dolphin or game data:

```shell
uv run --project runner starworks-runner capture \
  --video-backend lavfi \
  --video-input 'testsrc=size=1280x720:rate=30' \
  --record /tmp/starworks-capture-test.mkv \
  --duration-seconds 3
```

For a real station, select the platform input (`avfoundation` on macOS,
`gdigrab` on Windows, or `x11grab` on Linux), add its audio backend, and publish
with `--rtmp-url-environment STARWORKS_RTMP_URL`. The environment value is
necessarily handed to FFmpeg at process launch, but Starworks never persists or
prints it. Headless OBS remains a later option for scenes that cannot be
expressed as a browser-source overlay plus FFmpeg capture.

## Redacted support bundles

Support archives are never uploaded automatically. An operator must choose the
destination and pass explicit consent; an existing file is never overwritten:

```shell
uv run --project runner starworks-runner support-bundle \
  --state "$HOME/Library/Application Support/Starworks/runner.sqlite3" \
  --output ./starworks-support.zip \
  --consent
```

The archive contains platform/prerequisite status and a minimal local-state
summary. It excludes configured file paths, the game image and build, match
configuration and attempt nonce, runner credential, and RTMP destination.
