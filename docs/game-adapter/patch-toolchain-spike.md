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
- bridge entry `0x80002A00`, preserving the original call to `0x8050B2E4`;
- artifact SHA-256
  `86f373bc4ec8741bd966b8232702f839206195988a782da93c0f323022cef09d`;
- patched `main.dol` SHA-256
  `077211c054c8bf977d4f387ad4945a7baeb0aadf2a95d2a132dd4d6e78b472e2`.

The release builder verifies LLVM 22.1.8, the exact exported symbol addresses
and sizes, the compiled `.text` hash, the complete retail input hash, and every
original byte before producing the artifact and plan. The artifact contains
only Starworks code, zero-initialized bridge storage, and DOL metadata; it does
not contain retail game bytes.

## Runtime evidence

On macOS arm64, Dolphin 2606 loaded the managed patched DOL and used its built-in
GDB remote stub for bounded memory access. Python initialized the control block,
continued the paused CPU, negotiated attempt epoch 1, consumed synthetic event
sequence 1, and observed heartbeat 121. The game continued through its opening
sequence after the probe.

The official GDB stub is the first-class transport because it works without
re-signing Dolphin or attaching to another process. Unix-domain sockets are
used on macOS/Linux and the built-in TCP port is available on Windows. Dolphin
Memory Engine remains an optional legacy backend on platforms where its process
attachment model is supported.

## Guarded application

Patch-plan schema v2 can append one reviewed artifact slice at the exact input
EOF in addition to exact-byte-guarded in-place writes. It rejects unknown input
hashes, changed hook bytes, artifact hash/size mismatches, overlapping artifact
or target ranges, non-EOF appends, out-of-range writes, and unexpected final
hashes. The source dump and source extraction are never modified.

Rebuild the artifact only in a trusted maintainer environment with a lawful
reviewed DOL:

```shell
uv run --project runner python runner/tools/build_sluggers_bridge.py \
  --base-dol /private/path/to/clean/main.dol \
  --output-root runner/src/starworks_runner/games/sluggers
```
