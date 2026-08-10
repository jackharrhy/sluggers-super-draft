# Starworks runner

The runner is the local, Python 3.12 side of Starworks. It will own game-image
verification, deterministic build construction, Dolphin control, the Sluggers
adapter, telemetry spooling, and capture. This package starts headless so those
boundaries can be tested before a PySide6 interface is added.

Validate the shared contract fixtures directly:

```shell
uv run --project runner --group test starworks-runner validate-contracts
```
