import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { contractSchemas, type ContractName } from "../src/index.ts";

const fixtureDirectory = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "fixtures",
  "valid",
);

function readFixture(name: ContractName): unknown {
  return JSON.parse(
    readFileSync(path.join(fixtureDirectory, `${name}.json`), "utf8"),
  );
}

describe("Starworks v1 contracts", () => {
  for (const [name, schema] of Object.entries(contractSchemas)) {
    it(`accepts the shared ${name} fixture`, () => {
      expect(schema.safeParse(readFixture(name as ContractName)).success).toBe(
        true,
      );
    });

    it(`rejects unknown fields in ${name}`, () => {
      const fixture = readFixture(name as ContractName);
      expect(
        schema.safeParse({
          ...(fixture as Record<string, unknown>),
          arbitraryMemoryWrite: "80000000:DEADBEEF",
        }).success,
      ).toBe(false);
    });
  }

  it("rejects an incompatible schema version", () => {
    const fixture = readFixture("run-envelope");
    expect(
      contractSchemas["run-envelope"].safeParse({
        ...(fixture as Record<string, unknown>),
        schemaVersion: 2,
      }).success,
    ).toBe(false);
  });

  it("rejects a run with two home teams", () => {
    const fixture = readFixture("run-envelope") as {
      teams: Array<Record<string, unknown>>;
    };
    expect(
      contractSchemas["run-envelope"].safeParse({
        ...fixture,
        teams: fixture.teams.map((team) => ({ ...team, side: "home" })),
      }).success,
    ).toBe(false);
  });

  it("requires unattended execution and bounded recovery on every run", () => {
    const fixture = readFixture("run-envelope") as Record<string, unknown>;
    expect(contractSchemas["run-envelope"].safeParse(fixture).success).toBe(true);
    expect(contractSchemas["run-envelope"].safeParse({
      ...fixture,
      execution: {
        mode: "operator-controlled",
        recovery: { allowLiveReattach: true, freshAttemptLimit: 2 },
        stadium: { gameStadiumId: "mario-stadium", venueId: null },
      },
    }).success).toBe(false);
  });

  it("validates telemetry payloads against their semantic event type", () => {
    const fixture = readFixture("telemetry-envelope") as Record<string, unknown>;
    expect(contractSchemas["telemetry-envelope"].safeParse({
      ...fixture,
      eventType: "game-ended",
      observationSource: "bridge-hook",
      payload: { awayRuns: 4, homeRuns: 7, reason: "completed" },
    }).success).toBe(true);
    expect(contractSchemas["telemetry-envelope"].safeParse({
      ...fixture,
      eventType: "game-ended",
      observationSource: "bridge-hook",
      payload: { value: 1 },
    }).success).toBe(false);
  });

  it("binds an optional content pack to the match adapter and revisions", () => {
    const configuration = readFixture("match-configuration-package") as Record<string, any>;
    const contentPack = readFixture("content-pack-manifest") as Record<string, any>;
    contentPack.adapterVersion = configuration.adapterVersion;
    contentPack.statProfileRevisionId = configuration.statProfile.revisionId;
    contentPack.rulesetRevisionId = configuration.ruleset.revisionId;

    expect(contractSchemas["match-configuration-package"].safeParse({
      ...configuration,
      contentPack,
    }).success).toBe(true);
    expect(contractSchemas["match-configuration-package"].safeParse({
      ...configuration,
      contentPack: { ...contentPack, rulesetRevisionId: "ffffffff-ffff-4fff-8fff-ffffffffffff" },
    }).success).toBe(false);
  });
});
