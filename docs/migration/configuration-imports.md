# Configuration import boundaries

Starworks treats the existing community tools as migration sources, not as permanent
storage or execution APIs.

## Sluggers Stat Editor v4

The importer accepts the 507-line v4 save snapshot and validates every section. It
translates the 30 per-character stat columns, 14 size/catch-range columns, and five
pitching columns into a draft `StatProfileRevision`. Stable symbolic RMBe01 character
slot IDs are used when no verified canonical mapping is supplied.

Chemistry, trajectory lookup tables, global speed curves, team star-event matrices,
star boosts, and handicap settings are deliberately reported as unimported. Those
values have different domain shapes and must not be flattened into character stats.
v3 input is rejected with an explicit upgrade message rather than guessed.

## MSS-AutoTeam

The importer accepts the `teams.json` snapshot, validates each team as nine unique
batting and fielding slots, and emits only a declarative roster and effective lineup.
It does not copy keyboard macros, Gecko assembly, or raw Dolphin memory writes.

Mii indices are machine-local because their meaning depends on `RFL_DB.dat`; those
teams are refused until the user supplies an explicit Mii identity mapping.

Both adapters terminate at Starworks' versioned Zod contracts. The source formats can
therefore be removed after migration without affecting the web application or runner.
