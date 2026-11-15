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

export const MatchExecutionSchema = z.strictObject({
  mode: z.literal("cpu-vs-cpu"),
  stadium: z.strictObject({
    gameStadiumId: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/),
    venueId: UuidSchema.nullable(),
  }),
  recovery: z.strictObject({
    allowLiveReattach: z.literal(true),
    freshAttemptLimit: z.literal(1),
  }),
});

export const RunEnvelopeSchema = z
  .strictObject({
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
    execution: MatchExecutionSchema,
    lease: z.strictObject({
      leaseId: UuidSchema,
      runnerId: UuidSchema,
      expiresAt: TimestampSchema,
    }),
    issuedAt: TimestampSchema,
  })
  .meta({
    title: "RunEnvelope",
    description: "An immutable, leased instruction to execute one match attempt.",
  });

export type RunEnvelope = z.infer<typeof RunEnvelopeSchema>;
