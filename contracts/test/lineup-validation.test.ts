import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  TeamLineupRevisionSchema,
  validateTeamLineupRevision,
  type LineupIssueCode,
} from "../src/team-lineup-revision";

interface FixtureCase {
  name: string;
  rosterCharacterIds: string[];
  lineup: unknown;
  expectedIssues: LineupIssueCode[];
}

const fixturePath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../fixtures/lineup-validation/cases.json",
);
const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as {
  cases: FixtureCase[];
};

describe("shared lineup validation", () => {
  for (const fixtureCase of fixture.cases) {
    it(fixtureCase.name, () => {
      let revision = TeamLineupRevisionSchema.parse({
        schemaVersion: 1,
        kind: "team-lineup-revision",
        leagueId: "11111111-1111-4111-8111-111111111111",
        teamId: "22222222-2222-4222-8222-222222222222",
        rosterRevisionId: "33333333-3333-4333-8333-333333333333",
        rosterRevisionNumber: 1,
        lineupRevisionId: "44444444-4444-4444-8444-444444444444",
        lineupRevisionNumber: 1,
        status: "draft",
        rosterCharacterIds: fixtureCase.rosterCharacterIds,
        lineup: fixtureCase.lineup,
        basedOnLineupRevisionId: null,
        createdAt: "2026-08-10T12:00:00Z",
        publishedAt: null,
      });
      expect(validateTeamLineupRevision(revision)).toEqual(
        fixtureCase.expectedIssues,
      );
    });
  }
});
