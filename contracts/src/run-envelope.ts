import { z } from "zod";
import {
  AttemptNonceSchema,
  JsonScalarSchema,
  Sha256Schema,
  TimestampSchema,
  UuidSchema,
} from "./common.ts";

const TeamSelectionSchema = z.strictObject({
  teamId: UuidSchema,
  rosterRevisionId: UuidSchema,
  lineupRevisionId: UuidSchema,
});

const HomeTeamSelectionSchema = TeamSelectionSchema.extend({
  side: z.literal("home"),
});

const AwayTeamSelectionSchema = TeamSelectionSchema.extend({
  side: z.literal("away"),
});

export const RunEnvelopeSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    kind: z.literal("run-envelope"),
    correlationId: UuidSchema,
    createdByActorId: UuidSchema,
    leagueId: UuidSchema,
    seasonId: UuidSchema,
    matchId: UuidSchema,
    attemptId: UuidSchema,
    attemptNonce: AttemptNonceSchema,
    contentPackRevisionId: UuidSchema.nullable(),
    requiredGameBuildSha256: Sha256Schema,
    statProfileRevisionId: UuidSchema,
    rulesetRevisionId: UuidSchema,
    teams: z.union([
      z.tuple([HomeTeamSelectionSchema, AwayTeamSelectionSchema]),
      z.tuple([AwayTeamSelectionSchema, HomeTeamSelectionSchema]),
    ]),
    dynamicRuleOverrides: z.record(z.string().min(1), JsonScalarSchema),
    lease: z.strictObject({
      leaseId: UuidSchema,
      runnerId: UuidSchema,
      expiresAt: TimestampSchema,
    }),
    issuedAt: TimestampSchema,
  })
  .meta({
    title: "RunEnvelope v1",
    description: "An immutable, leased instruction to execute one match attempt.",
  });

export type RunEnvelope = z.infer<typeof RunEnvelopeSchema>;
