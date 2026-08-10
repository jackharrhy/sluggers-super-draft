# Sluggers patch-toolchain spike

## Decision

Starworks will keep maintainable bridge source and use a reviewed Kamek release
pipeline, but runners will consume only hash-pinned precompiled artifacts and
strict patch plans. No league operator needs a compiler, CodeWarrior, .NET, or
a PowerPC SDK.

## Evidence

The current upstream Kamek revision reviewed for this spike is
`c6d21f458f6c0d7c4106f7d2228f80d8321b9174`. Kamek is MIT and its linker now
targets .NET 10 across Windows and non-Windows systems. Its documented C/C++
flow still requires NXP CodeWarrior Special Edition for MPC55xx/MPC56xx 2.10,
including `license.dat`; `kamek.h` intentionally rejects other compilers.
Neither .NET nor CodeWarrior is installed in the current development
environment, and proprietary compiler material cannot be placed in this OSS
repository or assumed on an end-user machine.

The Python approach is deliberately less ambitious: it does not compile code.
It verifies a reviewed artifact hash, verifies the complete input file hash,
checks the exact original bytes at every write, rejects overlapping or
out-of-range writes, computes the expected final hash, writes a new file, and
promotes it atomically. Synthetic tests exercise success, modified hooks,
modified artifacts, overlaps, in-place writes, and final-hash mismatches.

This combination preserves Kamek's maintainable source and symbol workflow
without turning its proprietary build dependency into a runner dependency.

On the current Darwin 25.5 arm64 development host, five guarded applications
to an 8 MiB synthetic DOL averaged 13.6 ms and took at most 16.7 ms. The probe
found neither `dotnet` nor `mwcceppc`, while the precompiled path required
neither. These numbers are evidence for the spike, not a platform performance
guarantee; `evaluate-patch-toolchains` reproduces the measurement.

## Clean-room boundary

`bridge_v1.c` is written solely from the Starworks protocol. The guarded branch
encoder implements the public PowerPC relative-branch format. No hook body,
expected byte sequence, or address is copied from an unlicensed Sluggers tool.

The repository does not yet contain a retail hook plan or compiled bridge
artifact. Picking those values without a lawful clean dump would produce false
confidence. The adapter manifest therefore records explicit release gates for
the clean-room hook, compiled artifact, symbol review, cache barriers, and live
Dolphin boot.
