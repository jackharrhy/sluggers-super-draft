# Stat Editor v4 mapping evidence

Last verified: 2026-08-11

The current pre-release catalog maps the complete 507-line Stat Editor v4
profile onto the exact `RMBE01` Rev 0 `main.dol` with SHA-256
`3018e262480ccbf0daa04fc96f1c3dfb340dc4007a13f007f9423751c1346151`.
The verification command reports 16 guarded regions, 24 patterns, and 16,406
scalar cells. Every guard checks the full region hash; every pattern checks its
virtual-to-file mapping, bounds, overlap, codec, and byte round trip.

The same verifier can parse the maintainer-authorized Sluggers Stat Editor v4.1
source as inert Python syntax and compare its ten literal stock-data matrices
with the exact DOL. It does not import or execute the legacy Tk application.
All 16,406 mapped cells match the editor defaults byte-for-byte.

```shell
uv run --project runner python runner/tools/verify_sluggers_profile_targets.py \
  --dol /path/to/exact/RMBE01/main.dol \
  --stat-editor-source /path/to/Sluggers-Stat-Editor/editorV3.py \
  --exercise-compiler
```

The compiler exercise changes one value in each of the 24 patterns, compiles
the full profile, applies all 16,406 guarded writes to a temporary DOL copy,
and reports the resulting hash. It never modifies the supplied DOL.

On 2026-08-11 the same 24 representative mutations were composed after the
reviewed Starworks bridge, launched in the runner-managed Dolphin 2606, and
read back through Dolphin Memory Engine. All 24 live addresses matched their
compiled bytes, including the six handicap instruction immediates. The managed
build SHA-256 was
`8ed08246ccba97b1f36f9df8eccf530c0d6ffc5051b0b3a4fe6f325ca6f0c525`;
its `main.dol` SHA-256 was
`95fa2cfa474f8c5492c928c320ac877f80f9bce0d2f09ab3b278c7c837762740`.

The editor's Gecko generator is a research lead, not an unquestioned output
oracle. In v4.1 it serializes the star-boost operation selector through its
floating-point helper even though the stock DOL stores `1` or `2` as an
unsigned 32-bit integer. Starworks follows the exact game bytes (`u32-be`) and
the editor's intended Add/Multiply domain model.

## Handicap instruction parameters

The legacy editor's generated Gecko output supplied six research leads. They
were independently resolved through the DOL section table and inspected in the
maintainer-owned exact image. Each target is the low byte of an immediate in a
PowerPC instruction, so the profile contract and compiler restrict it to an
unsigned byte.

| Profile cell | Virtual address | File offset | Exact containing instruction |
| --- | ---: | ---: | --- |
| row 0, operation | `0x801808EF` | `0x1205EF` | `38 80 00 02` |
| row 0, threshold | `0x801808FB` | `0x1205FB` | `38 84 00 08` |
| row 0, award | `0x80180903` | `0x120603` | `38 C0 00 01` |
| row 1, operation | `0x80180977` | `0x120677` | `38 80 00 02` |
| row 1, threshold | `0x80180983` | `0x120683` | `38 84 00 18` |
| row 1, award | `0x8018098B` | `0x12068B` | `38 C0 00 03` |

The containing region is `main.dol+0x1205EC..0x120690`, virtual
`0x801808EC..0x80180990`, with SHA-256
`4908351852db6baa42757db0a0c8581d138966ea49ace4e0ebe46c3eb301b0aa`.
An altered instruction sequence, unknown DOL, non-integer, or value outside
`0..255` fails before the managed build is mutated.

Trajectory names remain authoring metadata; trajectory table values and their
activation mask are compiled. Product completion still requires a
server-published profile to travel through the normal scheduled-match path;
the exact mapping and live-memory mutation gate itself is complete.
