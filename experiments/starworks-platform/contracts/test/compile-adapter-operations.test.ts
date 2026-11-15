import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  RulesetRevisionSchema,
  StatProfileRevisionSchema,
  TeamLineupRevisionSchema,
  compileAdapterOperations,
} from "../src/index.ts";

const fixtures = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../fixtures/valid",
);

describe("adapter operation compiler", () => {
  it("deterministically translates published configuration without raw writes", () => {
    let profile = StatProfileRevisionSchema.parse(readFixture("stat-profile-revision"));
    let ruleset = RulesetRevisionSchema.parse(readFixture("ruleset-revision"));
    let lineup = TeamLineupRevisionSchema.parse(readFixture("team-lineup-revision"));
    let input = {
      adapterVersion: "0.1.0",
      generatedAt: "2026-08-10T14:00:00Z",
      lineup,
      profile,
      ruleset,
    };

    let first = compileAdapterOperations(input);
    let second = compileAdapterOperations(input);
    expect(second).toEqual(first);
    expect(first.operations).toHaveLength(32);
    expect(first.operations[0]).toMatchObject({
      operation: "set-character-stat",
      characterId: "mario",
      statKey: "batting.slap-power",
      resource: "dt-na-dat",
    });
    expect(JSON.stringify(first)).not.toContain("address");
    expect(JSON.stringify(first)).not.toContain("draft.timer-seconds");
  });

  it("refuses draft revisions", () => {
    let profile = StatProfileRevisionSchema.parse({
      ...(readFixture("stat-profile-revision") as Record<string, unknown>),
      status: "draft",
      publishedAt: null,
    });
    let ruleset = RulesetRevisionSchema.parse(readFixture("ruleset-revision"));
    let lineup = TeamLineupRevisionSchema.parse(readFixture("team-lineup-revision"));
    expect(() =>
      compileAdapterOperations({
        adapterVersion: "0.1.0",
        generatedAt: "2026-08-10T14:00:00Z",
        lineup,
        profile,
        ruleset,
      }),
    ).toThrow(/must be published/);
  });

  it("keeps a complete Stat Editor profile as one guarded build operation", () => {
    let base = readFixture("stat-profile-revision") as Record<string, any>;
    let characterIds = Array.from({ length: 101 }, (_, index) => `rmbe01-character-${String(index).padStart(3, "0")}`);
    let profile = StatProfileRevisionSchema.parse({
      ...base,
      characterValues: characterIds.map((characterId) => ({
        characterId,
        values: { "batting.slap-power": 96, "batting.trajectory": "medium" },
      })),
      sluggersTuning: tuning(characterIds),
    });
    let bundle = compileAdapterOperations({
      adapterVersion: "0.3.3",
      generatedAt: "2026-08-10T14:00:00Z",
      lineup: TeamLineupRevisionSchema.parse(readFixture("team-lineup-revision")),
      profile,
      ruleset: RulesetRevisionSchema.parse(readFixture("ruleset-revision")),
    });

    expect(bundle.operations[0]).toMatchObject({
      operation: "apply-sluggers-stat-profile",
      loadPhase: "build-time",
      resource: "main-dol",
    });
    expect(bundle.operations.filter((operation) => operation.operation === "set-character-stat")).toHaveLength(0);
    expect((bundle.operations[0] as any).characterValues).toHaveLength(101);
  });
});

function tuning(characterIds: string[]): Record<string, unknown> {
  let matrix = (rows: number, columns: number) =>
    Array.from({ length: rows }, () => Array.from({ length: columns }, () => 0));
  return {
    characterIdsByIndex: characterIds,
    chemistry: matrix(101, 101),
    trajectoryTables: matrix(24, 25),
    trajectoryNames: ["Medium", "High", "Low", "Group 3", "Group 4", "Group 5"],
    trajectoryActivation: [1, 1, 1, 1, 1, 1],
    globalSpeedCurves: matrix(43, 2),
    teamStarEvents: matrix(12, 41),
    starBoosts: matrix(16, 4),
    starHandicaps: matrix(4, 2),
    handicapParameters: [[2, 8, 1], [2, 24, 3]],
    importSource: { format: "stat-editor-v4", sha256: "a".repeat(64) },
  };
}

function readFixture(name: string): unknown {
  return JSON.parse(readFileSync(path.join(fixtures, `${name}.json`), "utf8"));
}
