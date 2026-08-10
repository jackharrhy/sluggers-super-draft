# Starworks runner

The runner is the local, Python 3.12 side of Starworks. It will own game-image
verification, deterministic build construction, Dolphin control, the Sluggers
adapter, telemetry spooling, and capture. This package starts headless so those
boundaries can be tested before a PySide6 interface is added.

Validate the shared contract fixtures directly:

```shell
uv run --project runner --group test starworks-runner validate-contracts
```

Install the pinned, hash-verified `decomp-toolkit` release into a runner-owned
tool directory:

```shell
uv run --project runner starworks-runner install-dtk --tool-directory .starworks/tools
```

Then create a no-op managed build from a user-selected, clean image:

```shell
uv run --project runner starworks-runner build-sluggers \
  --image /path/to/RMBE01.rvz \
  --cache .starworks/cache \
  --dtk .starworks/tools/dtk/1.8.3/dtk-macos-arm64
```

The checked-in retail fingerprint registry is intentionally empty until a
maintainer reviews hashes produced from a lawfully dumped, exact Redump match.
The command fails closed until that one-time provisioning step is complete.
Starworks never writes to the selected image and never uploads it.

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
  --profile .starworks/profiles/station-1
```

Bridge protocol v1 is documented in
`docs/game-adapter/bridge-protocol-v1.md`. Its polling path can be measured with
no game data or Dolphin process:

```shell
uv run --project runner starworks-runner benchmark-bridge --iterations 10000
```

With a bridge-enabled build running, `probe-bridge` uses the pinned Python
Dolphin Memory Engine 1.3.1 transport to attach, validate the adapter and game
build IDs, negotiate a one-attempt nonce, and consume only events attributed to
that attempt. Version 1.3.1 provides wheels for Windows x86-64, Linux x86-64,
macOS Intel, and macOS Apple Silicon. Each supported platform still requires a
real Dolphin integration test before release.

The patch-toolchain spike can be reproduced locally:

```shell
uv run --project runner starworks-runner evaluate-patch-toolchains \
  --size-mib 8 --iterations 5
```

It benchmarks the hash- and byte-guarded precompiled-artifact path and reports
whether the Kamek development prerequisites are present. The selected approach
keeps Kamek and CodeWarrior in a trusted release environment; they are never
runner or operator dependencies. See
`docs/game-adapter/patch-toolchain-spike.md` for the evidence and release gates.
