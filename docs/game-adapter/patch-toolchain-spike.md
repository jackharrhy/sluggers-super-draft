# Sluggers patch-toolchain spike

## Decision

Starworks compiles its clean-room PowerPC bridge with pinned LLVM/Clang/LLD
22.1.8 and ships only a reviewed, hash-pinned artifact plus a strict patch
plan. League operators do not need a compiler, CodeWarrior, Kamek, or a
PowerPC SDK.

Kamek remains valuable prior art and a possible future module system, but its
documented C/C++ flow depends on the proprietary NXP CodeWarrior compiler. The
minimal Starworks bridge does not need that dependency.

## Reviewed release

The `RMBE01` Rev 0 release uses:

- clean `main.dol` SHA-256
  `3018e262480ccbf0daa04fc96f1c3dfb340dc4007a13f007f9423751c1346151`;
- a DOL section at `0x80001900..0x80003000`, after the observed low-memory
  `STUBHAXX` marker and before the OS exception/runtime tables;
- main-loop call site `0x8039A688` (`main.dol+0x33A388`), guarded by original
  instruction `48170c5d`;
- bridge entry `0x80002700`, preserving the original call to `0x8050B2E4`;
- artifact SHA-256
  `a2689ed5259e1037754996a36a0d221f9ffd42c573291f0b00b6d15fb7443c23`;
- patched `main.dol` SHA-256
  `84f1355c13489109c2cb7f3491a435ddf2a68304f74786c1e0b35a61908339e8`.

The release builder verifies the expected entry points and region bounds, the
complete retail input hash, and every original byte before producing the
artifact and plan. The artifact manifest records the exact compiler, C source,
linker script, and output hashes. The artifact contains
only Starworks code, zero-initialized bridge storage, and DOL metadata; it does
not contain retail game bytes.

## Runtime evidence

On macOS arm64, Dolphin 2606 loaded the managed patched DOL and used its built-in
GDB remote stub for bounded memory access. Python initialized the control block,
continued the paused CPU, negotiated attempt epoch 1, consumed synthetic event
sequence 1, and observed heartbeat 121. The game continued through its opening
sequence after the probe.

Dolphin Memory Engine 1.3.1 is the first-class match-runtime transport. Its
macOS arm64 wheel attached to a runner-managed, DME-enabled copy of stock
Dolphin 2606, read `RMBE01`, initialized this real bridge, negotiated and
acknowledged a nonce, consumed synthetic event 1, and observed an advancing
heartbeat. It avoids the GDB stub's save-state lifecycle and one-shot connection
limitations and follows the same process-memory approach proven by MSS AutoTeam.

The official GDB stub remains an optional reverse-engineering transport for CPU
interrupts, registers, and breakpoints. On macOS, DME requires the Dolphin target
to carry `com.apple.security.get-task-allow`; Starworks creates and signs a local
managed copy rather than modifying the user's installed Dolphin application.

## Guarded application

Patch-plan schema v2 can append one reviewed artifact slice at the exact input
EOF in addition to exact-byte-guarded in-place writes. It rejects unknown input
hashes, changed hook bytes, artifact hash/size mismatches, overlapping artifact
or target ranges, non-EOF appends, out-of-range writes, and unexpected final
hashes. The source dump and source extraction are never modified.

Rebuild the artifact only in a trusted maintainer environment with a lawful
reviewed DOL:

```shell
uv run --project runner python runner/scripts/build_sluggers_bridge.py \
  --base-dol /private/path/to/clean/main.dol \
  --output runner/src/starworks_runner/games/sluggers/artifacts/bridge-v1-rmbe01.bin \
  --patch-plan runner/src/starworks_runner/games/sluggers/patches/bridge-v1-rmbe01.json
```
