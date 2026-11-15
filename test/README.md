# Standalone test harnesses

Put small, independently runnable investigations in `test/<thing>/`, for example
`test/dolphin-connection/` or `test/menu-observation/`. No harnesses have been
extracted yet; this directory establishes the boundary without duplicating code.

Each harness should include a README with its purpose, prerequisites, exact run
command, expected observations, and the location of any ignored output. Keep its
dependencies and configuration local. Real-game harnesses must explain how to
provide an owned game image without committing game data or credentials.

Application unit/integration tests stay with their application. Larger prototypes
belong in `experiments/`. Do not make every harness boot the Starworks platform or
import its contracts just to share a small amount of code.
