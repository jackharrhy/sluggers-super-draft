import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { contractSchemas, type ContractName } from "../src/index";

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
});
