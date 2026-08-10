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
});

function readFixture(name: string): unknown {
  return JSON.parse(readFileSync(path.join(fixtures, `${name}.json`), "utf8"));
}
