# Configuration import boundaries

Starworks treats the existing community tools as migration sources, not as permanent
storage or execution APIs.

## Sluggers Stat Editor v4

The importer accepts the complete 507-line v4 save snapshot and losslessly maps
all typed sections into a draft `StatProfileRevision`: the 49 per-character
values, chemistry matrix, trajectory tables/names/activation, global speed
curves, team star-event data, star boosts/handicaps, and handicap parameters.
Import, edit, clone, compare, serialize, and re-import preserve every v4 value.
Stable symbolic RMBE01 character slot IDs are used when no verified canonical
mapping is supplied. v3 input is rejected with an explicit upgrade message
rather than guessed.

The local compiler covers all guarded static tables and six handicap instruction
immediates for the exact supported DOL. Every mapping is guarded by the expected
base hash and region bytes; out-of-range values and altered code fail closed.

## MSS-AutoTeam

The importer accepts the `teams.json` snapshot, validates each team as nine unique
batting and fielding slots, and emits only a declarative roster and effective lineup.
It does not copy keyboard macros, Gecko assembly, or raw Dolphin memory writes.

Mii indices are machine-local because their meaning depends on `RFL_DB.dat`; those
teams are refused until the user supplies an explicit Mii identity mapping.

Both adapters terminate at Starworks' current pre-release Zod contracts. There
is one evolving v0 representation and no compatibility matrix yet. The source
formats can therefore be removed after migration without affecting the web
application or runner.
