import { z } from "zod";
import { TimestampSchema, UuidSchema } from "./common.ts";

export const FieldingPositionSchema = z.enum([
  "P",
  "C",
  "1B",
  "2B",
  "3B",
  "SS",
  "LF",
  "CF",
  "RF",
]);

export const EffectiveLineupSchema = z.strictObject({
  captainCharacterId: z.string().min(1).max(127),
  pitcherCharacterId: z.string().min(1).max(127),
  battingOrder: z.array(z.string().min(1).max(127)).max(18),
  bench: z.array(z.string().min(1).max(127)).max(18),
  fielding: z
    .array(
      z.strictObject({
        characterId: z.string().min(1).max(127),
        position: FieldingPositionSchema,
      }),
    )
    .max(18),
});

export const TeamLineupRevisionSchema = z
  .strictObject({
    kind: z.literal("team-lineup-revision"),
    leagueId: UuidSchema,
    teamId: UuidSchema,
    rosterRevisionId: UuidSchema,
    rosterRevisionNumber: z.number().int().positive(),
    lineupRevisionId: UuidSchema,
    lineupRevisionNumber: z.number().int().positive(),
    status: z.enum(["draft", "published"]),
    rosterCharacterIds: z.array(z.string().min(1).max(127)).min(1).max(18),
    lineup: EffectiveLineupSchema,
    basedOnLineupRevisionId: UuidSchema.nullable(),
    createdAt: TimestampSchema,
    publishedAt: TimestampSchema.nullable(),
  })
  .meta({
    title: "TeamLineupRevision v1",
    description: "A roster revision and independently versioned legal lineup.",
  });

export const MatchLineupOverrideSchema = z.strictObject({
  kind: z.literal("match-lineup-override"),
  overrideId: UuidSchema,
  leagueId: UuidSchema,
  matchId: UuidSchema,
  teamId: UuidSchema,
  baseLineupRevisionId: UuidSchema,
  effectiveLineup: EffectiveLineupSchema,
  createdAt: TimestampSchema,
});

export type MatchLineupOverride = z.infer<typeof MatchLineupOverrideSchema>;

export type TeamLineupRevision = z.infer<typeof TeamLineupRevisionSchema>;

export const lineupIssueCodes = [
  "duplicate-roster-character",
  "batting-order-must-have-nine",
  "duplicate-batting-character",
  "active-character-not-on-roster",
  "duplicate-bench-character",
  "bench-character-not-on-roster",
  "active-bench-overlap",
  "roster-partition-incomplete",
  "captain-not-active",
  "pitcher-not-active",
  "fielding-positions-incomplete",
  "duplicate-fielding-character",
  "fielding-character-not-active",
  "pitcher-position-mismatch",
] as const;

export type LineupIssueCode = (typeof lineupIssueCodes)[number];

export function validateTeamLineupRevision(
  revision: TeamLineupRevision,
): LineupIssueCode[] {
  let issues: LineupIssueCode[] = [];
  let roster = revision.rosterCharacterIds;
  let active = revision.lineup.battingOrder;
  let bench = revision.lineup.bench;
  let fielding = revision.lineup.fielding;
  let rosterSet = new Set(roster);
  let activeSet = new Set(active);
  let benchSet = new Set(bench);

  addIf(issues, new Set(roster).size !== roster.length, "duplicate-roster-character");
  addIf(issues, active.length !== 9, "batting-order-must-have-nine");
  addIf(issues, activeSet.size !== active.length, "duplicate-batting-character");
  addIf(issues, active.some((character) => !rosterSet.has(character)), "active-character-not-on-roster");
  addIf(issues, benchSet.size !== bench.length, "duplicate-bench-character");
  addIf(issues, bench.some((character) => !rosterSet.has(character)), "bench-character-not-on-roster");
  addIf(issues, active.some((character) => benchSet.has(character)), "active-bench-overlap");
  addIf(
    issues,
    new Set([...active, ...bench]).size !== rosterSet.size ||
      roster.some((character) => !activeSet.has(character) && !benchSet.has(character)),
    "roster-partition-incomplete",
  );
  addIf(issues, !activeSet.has(revision.lineup.captainCharacterId), "captain-not-active");
  addIf(issues, !activeSet.has(revision.lineup.pitcherCharacterId), "pitcher-not-active");

  let expectedPositions = new Set(FieldingPositionSchema.options);
  let actualPositions = new Set(fielding.map((assignment) => assignment.position));
  addIf(
    issues,
    fielding.length !== expectedPositions.size ||
      actualPositions.size !== expectedPositions.size ||
      [...expectedPositions].some((position) => !actualPositions.has(position)),
    "fielding-positions-incomplete",
  );
  let fieldingCharacters = fielding.map((assignment) => assignment.characterId);
  addIf(
    issues,
    new Set(fieldingCharacters).size !== fieldingCharacters.length,
    "duplicate-fielding-character",
  );
  addIf(
    issues,
    fieldingCharacters.some((character) => !activeSet.has(character)),
    "fielding-character-not-active",
  );
  addIf(
    issues,
    fielding.find((assignment) => assignment.position === "P")?.characterId !==
      revision.lineup.pitcherCharacterId,
    "pitcher-position-mismatch",
  );
  return issues;
}

function addIf(
  issues: LineupIssueCode[],
  condition: boolean,
  code: LineupIssueCode,
): void {
  if (condition) issues.push(code);
}
