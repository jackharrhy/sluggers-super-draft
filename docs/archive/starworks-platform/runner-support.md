# Runner installation, updates, and support matrix

> Preserved Starworks experiment guide. Source-checkout commands are run from
> `experiments/starworks-platform/`; release instructions refer to that experiment.

Starworks uses one Python 3.12 runner core for the native PySide6 application,
diagnostic CLI, and experimental Linux container. The web server never receives
a game image or materialized game build.

## Install a release wheel

Each `v*` Git tag creates a GitHub release containing a platform-independent
runner wheel and `SHA256SUMS`. Download both from the
[Starworks releases page](https://github.com/jackharrhy/sluggers-super-draft/releases),
verify the checksum, and install the native UI with `uv`:

```shell
sha256sum --check SHA256SUMS
uv tool install --python 3.12 --with 'pyside6>=6.10,<7' \
  ./starworks_runner-0.1.0-py3-none-any.whl
starworks-runner validate-contracts
```

On macOS, use `shasum -a 256 -c SHA256SUMS` if `sha256sum` is unavailable.
Install a newer wheel with the same command plus `--force`; this preserves the
runner state database because it lives in the platform data directory, outside
the Python tool environment. Do not downgrade while an attempt is active.

For source checkouts, the equivalent development setup is:

```shell
uv sync --project runner --extra gui --group test
uv run --project runner --extra gui starworks-runner validate-contracts
```

The release wheel bundles the generated JSON Schemas and validation fixtures.
The packaging smoke test installs the wheel into a clean `uv tool` home and
validates them before a release is created.

On registration, the web service returns its configured minimum and recommended
runner versions. The native status card reports `current`, `update-available`,
or `update-required`; operators still install a checksum-verified tagged wheel
explicitly. Production sets `RUNNER_MINIMUM_VERSION` and
`RUNNER_RECOMMENDED_VERSION` rather than silently updating a station.

## Native prerequisites

- Python 3.12 and `uv` for installation.
- Dolphin 2606 selected explicitly in the runner.
- FFmpeg for recording or RTMP publishing.
- The runner-managed, pinned decomp-toolkit installed with
  `starworks-runner install-dtk`.
- A user-owned, clean North American `RMBE01` Rev 0 full ISO or lossless RVZ
  dump whose exact Redump match and reviewed fingerprint appear in the runner
  registry. A scrubbed WBFS without verification data is suitable only for
  non-production investigation; converting it cannot restore discarded disc
  sectors.
- A private runner credential issued from the league operations workspace.

The supported-base registry contains the maintainer-reviewed North American
Rev 0 fingerprints produced from a lawfully dumped exact match. Unknown or
modified bases remain a hard failure; update the registry only through the same
review process.

The production station loop records every claimed attempt locally while it
runs Dolphin. Recordings default to an `artifacts/` directory beside the runner
state database; an existing attempt recording is never overwritten. A custom
directory and native capture inputs can be selected explicitly:

```shell
starworks-runner run-sluggers-station \
  --cache /path/to/cache \
  --image /path/to/RMBE01.iso \
  --dolphin /path/to/runner-managed/Dolphin \
  --profile /path/to/seed-profile \
  --recordings /path/to/local-artifacts
```

The station uses Dolphin Memory Engine by default. The optional GDB flags are
for reverse-engineering diagnostics, not normal match execution. On macOS, the
selected runner-managed Dolphin copy must be signed with
`com.apple.security.get-task-allow`; Starworks does not alter the user's normal
Dolphin installation.

Use `--capture-audio-input` only after selecting and testing an OS-native audio
device. A recording failure is reported through station component health but
cannot interrupt telemetry or decide the game result.

## Support matrix

“Software verified” means contract, packaging, process, and synthetic tests
passed. “Hardware pending” means Starworks must not yet promise a complete
match on that target.

| Profile | Package/CLI | Real Dolphin + bridge | Capture/RTMP | Status |
| --- | --- | --- | --- | --- |
| macOS 14+ arm64 | verified | Stock Dolphin 2606 + DME 1.3.1 bridge handshake verified | real Dolphin screen recorded to H.264; per-attempt recording wired; audio/RTMP pending | preview |
| macOS 14+ x64 | package supported | hardware pending | hardware pending | preview |
| Windows 11 x64 | package supported; GDB TCP path implemented | hardware pending | `gdigrab`/`dshow` pending | preview |
| Linux x64 native | test suite verified | hardware pending | `x11grab`/Pulse pending | preview |
| Linux amd64 container | image build and synthetic H.264 capture verified | GPU/input/bridge pending | real RTMP pending | experimental |
| Windows ARM64 | package supported; hardware untested | not tested | not tested | unsupported |
| Linux ARM64 container | pinned upstream image unavailable | not tested | not tested | unsupported |

The currently implemented controller Pipe backend is available in stock
Dolphin only on Unix, so it covers macOS and Linux but not Windows. DME is
cross-platform, but Windows still needs a proven native controller backend
before menu automation can be claimed. Dolphin's built-in MemoryWatcher is
likewise a Unix-only, read-only observer.

On macOS, process-memory access requires `com.apple.security.get-task-allow` on
the Dolphin target. The runner uses a private managed copy with a local signature
and leaves the installed, notarized Dolphin application untouched. GDB remains
available for maintainer reverse engineering, not scheduled-match execution.

Runner attempts use a fresh isolated Dolphin user directory cloned from a
validated seed containing the normal in-game Wii save. A Dolphin savestate may
be used only as an optional startup cache pinned to the exact emulator, game,
adapter, and controller configuration; it is never the durable save or an
acceptance signal. The deterministic startup and validation procedure is
documented in
[`2026-08-10-resource-folder-and-dolphin-startup.md`](../../research/2026-08-10-resource-folder-and-dolphin-startup.md).

The native release-support gate for a row is:

1. Build and boot the reviewed dump without mutating it.
2. Complete the bridge version, adapter-build, and attempt-nonce handshake.
3. Load teams, lineups, stats, and rules for the claimed attempt.
4. Finish a representative game with ordered telemetry and no duplicate events
   across a forced web disconnect.
5. Record and publish to a disposable RTMP endpoint; force publishing to fail
   and confirm telemetry continues.
6. Restart during a lease and confirm recovery never executes a second attempt.
7. Revoke the station and confirm the running client loses authorization.

The experimental container has the additional GPU and input passthrough gates
listed in `deploy/runner/README.md`. It is `linux/amd64` only. Dolphin's source
and cross-platform build support are documented in the
[official repository](https://github.com/dolphin-emu/dolphin). Starworks pins
tag 2606 and commit `6094cfcf7b8fba733b3116fdf3414d51c1c0e4a4`. Match runtime
memory uses Dolphin Memory Engine 1.3.1; the GDB findings and the live DME proof
are recorded in the
[instrumentation decision](../../research/2026-08-10-dolphin-instrumentation.md).

## Recovery and diagnostics

Runner state is stored at:

- macOS: `~/Library/Application Support/Starworks/runner.sqlite3`
- Windows: `%LOCALAPPDATA%\Starworks\runner.sqlite3`
- Linux: `${XDG_DATA_HOME:-~/.local/share}/starworks/runner.sqlite3`

The credential is not stored there; the desktop holds it only for the current
process. The state database journals registration, the active envelope, and
pending lifecycle acknowledgements.

When recovering:

1. Do not delete the state database or cached build while an attempt may still
   have a server lease.
2. Check the league operations workspace for station heartbeat, component
   health, attempt state, and audit history.
3. Relaunch with the same state path and credential. Local recovery does not
   extend an expired lease and cannot override the server's attempt nonce.
4. Use `validate-contracts`, `fingerprint-sluggers`, `benchmark-bridge`, and a
   short synthetic `capture` as non-destructive diagnostics.
5. Revoke the station if its credential or host may be compromised.
6. Share only redacted logs and diagnostic output. Never include the game dump,
   extracted files, materialized build, runner credential, or RTMP URL.

Create a reviewable local archive only after the operator explicitly consents:

```shell
starworks-runner support-bundle \
  --state /path/to/runner.sqlite3 \
  --output ./starworks-support.zip \
  --consent
```

The command refuses to overwrite a file. The generated ZIP has a privacy
manifest, normalized prerequisite status, and a minimal state summary; it
contains no configured paths, game/configuration bytes, attempt nonce,
credential, or RTMP secret. Starworks has no automatic support-bundle upload.

Bridge mismatches, unsupported bases, changed hook bytes, and manifest hash
mismatches fail closed. Do not “repair” them by weakening checks; update the
reviewed fingerprint or adapter release through the normal release process.
