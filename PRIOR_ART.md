# Starworks Prior Art and Community Map

**Last reviewed:** 2026-08-10

Starworks exists because the Mario baseball, Sluggers, Dolphin, reverse-engineering, and league communities have already built a remarkable collection of tools and knowledge. This document records that lineage before implementation begins.

The list is intentionally broader than a dependency manifest:

- A project with a compatible license may become a dependency, contribute code with attribution, or provide a protocol implementation.
- A project with an incompatible license may still interoperate across a process or data boundary where the licenses permit it.
- A project with no declared license remains important prior art and a potential collaboration source. It is not silently copied; we preserve the link, discuss provenance with its maintainers, and seek an explicit license or contribution grant when code should move into Starworks.
- Game data, screenshots, models, audio, and other Nintendo-originated material require separate consideration from the license on the surrounding tool.

License labels below describe repository metadata and visible license files at the review date. They are an engineering inventory, not a legal conclusion.

## The projects being brought together

| Project | Relevance to Starworks | License/status observed |
| --- | --- | --- |
| [Sluggers Super Draft](https://github.com/jackharrhy/sluggers-super-draft) | Current league website, draft, teams, lineups, trades, matches, standings, Discord integration, and the starting repository for Starworks. | No repository license currently declared; Starworks plans to become MIT. |
| [Sluggers Stat Tracker](https://github.com/isThatC2/Sluggers-Stat-Tracker) | Python/Dolphin stat observation, game-state knowledge, event detection, and operator workflow. A local fork also exists at [jackharrhy/Sluggers-Stat-Tracker](https://github.com/jackharrhy/Sluggers-Stat-Tracker). | No license declared. Treat as a central collaboration/reference candidate and retain provenance. |
| [Sluggers Stat Editor](https://github.com/Philenarion/Sluggers-Stat-Editor) | Character stat layout, validation ranges, chemistry, Gecko generation, and established Python UI behavior. | No license declared. Treat as a central collaboration/reference candidate and retain provenance. |
| [MSS AutoTeam](https://github.com/STGtheOG/MSS-AutoTeam) | Dolphin process control, team/lineup loading, Mii handling, and match setup automation. | No license declared. Treat as a central collaboration/reference candidate and retain provenance. |
| [mii-lib](https://github.com/jackharrhy/mii-lib) | Python parsing and discovery for Wii/Dolphin Mii databases. | GPL-3.0; originally based on GPL-3.0 [PyMii](https://github.com/PuccamiteTech/PyMii). Keep the license boundary or obtain permission/perform a clean implementation before inclusion in an MIT package. |

The Starworks architecture does not preserve these projects' current file formats or application boundaries automatically. It preserves their behavior, discoveries, provenance, and contributor knowledge.

## Project Rio

Project Rio is the closest community-scale architectural precedent: a central open-source project combining an emulator fork, game-side ASM, stats, online services, and supporting tools for Mario Superstar Baseball on GameCube.

| Project | Relevance to Starworks | License/status observed |
| --- | --- | --- |
| [Project Rio organization](https://github.com/ProjectRio) | Overall community structure and repository family. | Mixed by repository. |
| [ProjectRio](https://github.com/ProjectRio/ProjectRio) | Dolphin fork with game-specific integration, quick-match flow, memory access, and runtime behavior. | Dolphin/GPL-2.0-or-later lineage; verify repository notices before reuse. |
| [ProjectRio-ASM](https://github.com/ProjectRio/ProjectRio-ASM) | Game-side hooks, stat capture, claimed memory, patches, and generated symbol/header workflow. | No license declared; reference/collaboration candidate. |
| [ProjectRio-frontend](https://github.com/ProjectRio/ProjectRio-frontend) | Existing public/service frontend patterns. | No license declared; reference/collaboration candidate. |
| [ProjectRio-web](https://github.com/ProjectRio/ProjectRio-web) | REST API and online service patterns. | MIT. |
| [Rio-scripts](https://github.com/ProjectRio/Rio-scripts) | Build, data, and operational scripts. | MIT. |
| [Project Rio Dolphin Memory Engine](https://github.com/ProjectRio/Dolphin-memory-engine) | Process discovery and Dolphin emulated-memory access. | MIT. |
| [Project Rio PR #91](https://github.com/ProjectRio/ProjectRio/pull/91) | Toadstool Tour stat-tracking work and a concrete example of extending Rio's game-specific model. | Governed by the ProjectRio repository. |

Starworks adopts Rio's strongest patterns—game-side instrumentation, explicit memory ownership, raw event preservation, generated symbols, and community coordination—while initially keeping product/network concerns outside Dolphin.

## Sluggers data, assets, and binary formats

| Project/resource | Relevance to Starworks | License/status observed |
| --- | --- | --- |
| [Sluggies DAT Tools](https://github.com/Jaws-git/Sluggies-dat-tools) | Active Python tooling for `.sluggie`/Blender workflows, model and icon editing, guarded `main.dol` hooks, `dt_na.dat` materialization, FST updates, and experimental hammerspace. | No license declared; high-priority collaboration/reference candidate. Forked from MSS DAT Tools, so upstream rights also matter for code movement. |
| [MSS DAT Tools](https://github.com/LlamaTrauma/MSS-dat-tools) | Original parsers/writers and research for Sluggers model data, collisions, textures, skeletons, skinning, and animation. | No license declared; high-priority collaboration/reference candidate. |
| [Mario Sluggers model format documentation](https://thatsrightigame.com/sluggers/format_docs/) | Published descriptions of mesh, ACT/bone, texture, SKN/skinning, display-list, and quantization formats. | Documentation site does not state a license; cite as research and confirm terms before reproducing documentation text. |
| [Wiimm's SZS Tools](https://szs.wiimm.de/) | `wimgt` TPL/PNG conversion used by DAT tooling and broader Nintendo archive tooling. | Project-specific license; review before distribution. |
| [Blender](https://www.blender.org/) | Model editing and add-on host for local content-authoring workflows. | GPL-2.0-or-later. |
| [Super Mario Sluggers Mine](https://github.com/Packjackisback/Super_Mario_Sluggers_Mine) | Community data-mining output, filenames, music, and assorted game discoveries. | No license declared; reference/collaboration candidate. Nintendo-originated contents require separate treatment. |
| [sluggerspics](https://github.com/joeythegoon/sluggerspics) | Character and team image rips used by existing community sites/tools. | No license declared; reference only unless provenance and distribution rights are resolved. |
| [Sluggers General Resources Drive](https://drive.google.com/drive/folders/1hbn4NhvIf9Av2qw6TP-v-2ea9iTidfJe) | Community research, game data, spreadsheets, and media. | Per-item/unknown; inventory provenance before importing anything. |
| [Community Stat Table](https://docs.google.com/spreadsheets/d/13uVzRaigr4i-QRZAhp4DcbDuhxhJvwxZigWds_Y8CR4/edit?gid=66049872#gid=66049872) | Shared stat values and game knowledge. | No explicit license noted; reference/collaboration candidate. |

`.sluggie` is valuable local interchange prior art, but its absolute offsets and embedded original buffers make it unsuitable as Starworks' canonical cloud content format.

## Sluggers decompilation and game-side modification

| Project | Relevance to Starworks | License/status observed |
| --- | --- | --- |
| [mss-decomp](https://github.com/Whodeyy1234/mss-decomp) | Real `RMBE01` decomp-toolkit configuration, generated symbols, SDK-version research, build hash, and associated Ghidra analysis. Preferred upstream for targeted Sluggers decomp collaboration. | CC0-1.0. |
| [Hoitemmie Sluggers-Decomp](https://github.com/Hoitemmie-wii/Sluggers-Decomp) | A second public Sluggers decomp/modding starting point; currently close to an unconfigured template. | CC0-1.0. Coordinate before duplicating future work. |
| [Sluggers Stat Upgrades](https://github.com/JohnKircher/SluggersStatUpgrades) | Browser stat editor, character data, constraints, and generated ASM/Gecko-oriented output. | Apache-2.0. |
| [Super Sluggers Online](https://github.com/RealClayton/supersluggers-online) | Experimental physical-Wiimote/netplay, proxy, Dolphin-extension, launch, relay, and desync-detection ideas. | No license declared despite README claims observed during research; reference/collaboration candidate pending an actual license file/grant. |
| [Gecko Archive RMBE01 codes](https://github.com/SpaceXCheeseWheel/GeckoArchive/blob/master/codes/RMBE01.txt) | Historical public Gecko codes and known `RMBE01` addresses. | Repository-specific/unclear; use as address provenance and validate every code against supported builds. |

## GameCube/Wii decompilation toolchain and examples

| Project | Relevance to Starworks | License/status observed |
| --- | --- | --- |
| [decomp-toolkit](https://github.com/encounter/decomp-toolkit) | Disc verification/extraction, DOL/REL analysis, relocations, binary splitting, linker generation, and exact-build verification. Suitable as a pinned runner/developer CLI. | Dual Apache-2.0/MIT. |
| [dtk-template](https://github.com/encounter/dtk-template) | Source-free GameCube/Wii matching-decomp structure, multi-version configuration, CI, symbols, splits, and progress integration. | CC0-1.0. |
| [objdiff](https://github.com/encounter/objdiff) | Local PowerPC object comparison, automatic rebuilds, and progress data. | Dual Apache-2.0/MIT. |
| [decomp.me](https://decomp.me/) | Collaborative function matching and scratch environments. | Hosted service; individual source/tool terms apply. |
| [decomp.dev](https://decomp.dev/) | Decompilation progress, APIs, and hosted Ghidra collaboration used by `mss-decomp`. | Hosted service; individual project licenses apply. |
| [wibo](https://github.com/decompals/wibo) | Minimal Win32 wrapper commonly used to run CodeWarrior tools on Linux/macOS. | MIT. |
| [sjiswrap](https://github.com/encounter/sjiswrap) | UTF-8 to Shift-JIS wrapper used in matching GameCube/Wii builds. | MIT. |
| [Wii Sports decomp](https://github.com/doldecomp/ogws) | Active/reference matching Wii decomp with source-free clean-room guidance. | CC0-1.0. |
| [New Super Mario Bros. Wii decomp](https://github.com/NSMBW-Community/NSMBW-Decomp) | Substantial active Wii decomp reference. | No license declared in repository metadata; reference/collaboration example. |
| [Mario Kart Wii decomp](https://github.com/snailspeed3/mkw) | Mature Wii decomp structure and shared Revolution SDK implementations relevant to Sluggers. | CC0-1.0. |
| [Kamek](https://github.com/Treeki/Kamek) | Maintained generic GameCube/Wii code-injection engine with C++ hooks and static patches. Candidate bridge build tool. | MIT. |
| [Newer Super Mario Bros. Wii](https://github.com/Newer-Team/NewerSMBW) | Large real-world Kamek mod, loader, hooks, and multi-region patching example. | MIT. |
| [Kuribo](https://github.com/DotKuribo/Kuribo) | Experimental embedded Wii mod loader, `.kxe` modules, game hooks, and Gecko JIT. | No license declared; reference/collaboration candidate. |
| [Ghidra](https://github.com/NationalSecurityAgency/ghidra) | Static analysis and shared reverse-engineering workspace. | Apache-2.0. |

The matching decomp is an upstream research program. Starworks consumes reviewed symbols, structures, and bridge artifacts; it does not require a full decomp or native port to ship.

## Dolphin and runtime integration

| Project/resource | Relevance to Starworks | License/status observed |
| --- | --- | --- |
| [Dolphin Emulator](https://github.com/dolphin-emu/dolphin) | Wii emulation, extracted-filesystem boot, profiles, controller configuration, capture surface, and the possible future fork base. | GPL-2.0-or-later. |
| [Dolphin Memory Engine](https://github.com/aldelaro5/Dolphin-memory-engine) | Cross-platform Dolphin process/memory access lineage used by several community tools. | MIT. |
| [Dolphin Emulator website](https://dolphin-emu.org/) | Releases, documentation, and supported emulator behavior. | Project documentation/release terms. |

A pinned stock Dolphin is the initial runtime. A future fork stays a separately governed GPL component and requires a measured decision gate.

## League sites, bots, editors, and analytics

| Project/resource | Relevance to Starworks | License/status observed |
| --- | --- | --- |
| [Sluggers Official Site](https://github.com/JohnKircher/SluggersOfficialSite) | League presentation, game-inspired visuals, listings, and stats. | Apache-2.0. |
| [Fireball Fantasy League](https://github.com/Aayush-Bhagat/Fireball-Fantasy-League) | Multi-page fantasy league product, authentication, matches, teams, and polished UX reference. | No license declared; reference/collaboration candidate. |
| [SluggersStats](https://github.com/lukesantos34/SluggersStats) | Recent TypeScript stat-tracking application and workflow reference. | No license confirmed during initial review; reference/collaboration candidate. |
| [sluggerbot](https://github.com/bwees/sluggerbot) | Discord-first league management and command workflow. | No license declared; reference/collaboration candidate. |
| [SuperSluggersRandomizer](https://github.com/EliFreedman/SuperSluggersRandomizer) | Random team generation and community roster knowledge. | No license confirmed; reference/collaboration candidate. |
| [Updated Sluggers Random Team Generator](https://github.com/zty1ooo/Mario-Super-Sluggers-Random-Team-Generator) | More recent continuation of random-team tooling. | No license confirmed; reference/collaboration candidate. |
| [Sluggers AI](https://github.com/MarioDS15/SluggersAI) | CPU-vs-CPU match prediction and possible analytics experimentation. | No license declared; reference/collaboration candidate. |
| [pupperpowell/supersluggers](https://github.com/pupperpowell/supersluggers) | Simulation of evolving Sluggers draft strategies. | No license declared; reference/collaboration candidate. |
| [Mario Sluggers Fan Club](https://www.youtube.com/@MarioSluggersFanclub) | Community gameplay, mechanics, and league-media reference. | Platform/content-owner terms. |

## Mii references

| Project/resource | Relevance to Starworks | License/status observed |
| --- | --- | --- |
| [PyMii](https://github.com/PuccamiteTech/PyMii) | Original parser lineage for `mii-lib`. | GPL-3.0. |
| [WiiBrew RFL_DB.dat documentation](https://wiibrew.org/wiki//shared2/menu/FaceLib/RFL_DB.dat) | Community documentation of the Wii Mii database. | Wiki/content terms apply. |
| [mii-unsecure](https://mii-unsecure.ariankordi.net/) | Browser/API reference for rendering `.mii` data to images. | Service terms/source license to be verified before integration. |

## Broadcast, web, and deployment foundations

These are platform choices rather than Sluggers-specific prior art, but they establish the intended open-source deployment model.

| Project | Relevance to Starworks | License/status observed |
| --- | --- | --- |
| [Remix](https://remix.run/) | Starworks web framework and server-rendered application model. | MIT. |
| [PostgreSQL](https://www.postgresql.org/) | Primary relational database. | PostgreSQL License. |
| [Drizzle ORM](https://orm.drizzle.team/) | TypeScript schema, migrations, and queries. | Apache-2.0. |
| [Zod](https://zod.dev/) | Canonical TypeScript contracts and JSON Schema generation. | MIT. |
| [Garage](https://garagehq.deuxfleurs.fr/) | Self-hosted S3-compatible storage for permitted content-pack assets. | AGPL-3.0; network service boundary. |
| [Traefik](https://traefik.io/traefik/) | Production ingress and TLS routing. | MIT. |
| [Mailpit](https://mailpit.axllent.org/) | Optional local email capture for future mail work. | MIT. |
| [OBS Studio](https://obsproject.com/) | Optional scene composition and streaming integration. | GPL-2.0-or-later. |
| [FFmpeg](https://ffmpeg.org/) | Video/audio capture, encoding, and RTMP publishing where sufficient. | LGPL/GPL depending build options. |
| [Docker Compose](https://docs.docker.com/compose/) | Root local-development topology and later optional Linux runner packaging. | Docker/component-specific licensing. |

## Additional community learning resources

- [Making and Using Custom Textures for Dolphin Emulator](https://www.youtube.com/watch?v=2Pyj4iUPOLo)
- [Blender Sluggies guide](https://github.com/Jaws-git/Sluggies-dat-tools/blob/main/BlenderGuide.md)
- [GC/Wii decompilation community](https://discord.gg/hKx3FJJgrV)

## Provenance policy for Starworks

Every imported implementation must carry enough history to answer:

1. Which project, author, commit, document, or experiment taught us this?
2. Was code copied, adapted, independently implemented, or only behaviorally observed?
3. What license or explicit permission applies?
4. Does the material include or derive from copyrighted game assets?
5. Which game revision and binary fingerprint was used to validate the discovery?

For unlicensed community projects, the default path is collaboration:

- Keep the project and maintainer visible in this map.
- Open a licensing/contribution conversation before moving code.
- Prefer upstream fixes and shared symbol/format documentation.
- If an independent implementation is required, document the clean inputs, behavior tests, and provenance.
- Preserve credit even when facts or independently rediscovered behavior are not copyrightable.

The objective is a welcoming central OSS home, not erasure of the smaller projects that made Starworks possible.
