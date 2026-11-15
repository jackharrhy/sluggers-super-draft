# Starworks Sluggers bridge protocol v1

All emulated-memory access stays inside the Sluggers adapter package. The
game-side bridge owns bounded runtime writes; the Python tracker performs
read-only DME observations. Web payloads remain declarative and never contain
addresses or executable code.

All multibyte values are unsigned and big-endian, matching the Wii's
PowerPC CPU. The v1 reservation is `0x1700` bytes at virtual address
`0x80001900`. The machine-readable source of truth is
`runner/src/starworks_runner/games/sluggers/memory_map.json`.

The exact DOL map disproved the earlier `0x807A5000` candidate because it falls
inside the static stack. The supported low-memory reservation instead begins
after Dolphin's observed `STUBHAXX` marker and ends before the exception and
runtime tables at `0x80003000`. A reversible live probe verified the guarded
main-loop hook at `0x8039A688`, then restored its original bytes before the game
continued normally. This reservation replaces legacy Gecko/AutoTeam use of the
same cave; those systems must not run alongside the Starworks adapter.

## Control block

The 256-byte control block starts at offset `0x000`.

| Offset | Size | Field |
| ---: | ---: | --- |
| `0x00` | 4 | Magic `SWB1` |
| `0x04` | 2 | Protocol version (`1`) |
| `0x06` | 2 | Control-block size (`0x100`) |
| `0x08` | 4 | Total reservation size (`0x1700`) |
| `0x0C` | 4 | Capability flags |
| `0x10` | 32 | Adapter build SHA-256, raw bytes |
| `0x30` | 32 | Game build SHA-256, raw bytes |
| `0x50` | 32 | SHA-256 of the active attempt nonce |
| `0x70` | 8 | Heartbeat/game frame |
| `0x78` | 8 | Last committed producer sequence |
| `0x80` | 8 | Last consumed sequence |
| `0x88` | 4 | Count of overwritten events |
| `0x8C` | 2 | Event capacity (`32`) |
| `0x8E` | 2 | Event size (`80`) |
| `0x90` | 4 | Lifecycle state |
| `0x94` | 4 | Fatal error code |
| `0x98` | 8 | Runner request epoch |
| `0xA0` | 8 | Game acknowledgement epoch |
| `0xA8` | 88 | Reserved, zero in v1 |

The runner writes the nonce digest before advancing the request epoch. The
game resets the ring for the new attempt, copies the request epoch to the
acknowledgement field, and transitions to `ACTIVE`. A runner accepts events
only after the epoch, nonce, adapter build, and game build all match.

## Event ring

The 32-entry ring begins at offset `0x100`. Every entry is 80 bytes:

| Offset | Size | Field |
| ---: | ---: | --- |
| `0x00` | 8 | Monotonic event sequence |
| `0x08` | 8 | Game frame |
| `0x10` | 32 | Active attempt-nonce digest |
| `0x30` | 2 | Event type |
| `0x32` | 2 | Payload size (`0` through `24`) |
| `0x34` | 4 | Event flags |
| `0x38` | 24 | Typed event payload |

The reserved record layout can represent game-started, inning-started,
batter-changed, pitcher-changed, plate-appearance-ended, substitution,
game-ended, and bridge-warning records. Those semantic game hooks are not
installed in the current adapter. The supported v0 match path rejects any such
unexpected ring record and derives its current lifecycle stream from read-only
DME snapshots; only the synthetic handshake record is emitted by the bridge.

The game writes an event body before publishing its sequence and then advances
the producer sequence. The runner reads the slot and sequence twice, rejects a
torn or overwritten entry, validates the nonce, and only then advances the
consumer sequence. Overflow is fatal to automatic match finalization.

Pause does not create an event or advance the heartbeat. Events already in the
ring survive pause/resume, and the consumer sequence prevents their duplicate
delivery.
