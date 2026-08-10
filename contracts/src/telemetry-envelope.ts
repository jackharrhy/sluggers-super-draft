import { z } from "zod";
import {
  AttemptNonceSchema,
  Sha256Schema,
  UuidSchema,
  VersionSchema,
} from "./common.ts";

export const TelemetryEventTypeSchema = z.enum([
  "synthetic",
  "game-started",
  "inning-started",
  "batter-changed",
  "pitcher-changed",
  "plate-appearance-ended",
  "substitution",
  "game-ended",
  "bridge-warning",
]);

export const TelemetryObservationSourceSchema = z.enum([
  "bridge-hook",
  "memory-observation",
  "synthetic",
]);

export const PlateAppearanceResultSchema = z.enum([
  "single",
  "double",
  "triple",
  "home-run",
  "walk",
  "strikeout",
  "out",
  "error",
  "hit-by-pitch",
  "sacrifice",
]);

const TeamSideSchema = z.enum(["home", "away"]);
const CharacterIdSchema = z.string().min(1).max(100);

export const TelemetryEventPayloadSchemas = {
  synthetic: z.strictObject({ value: z.number().int() }),
  "game-started": z.strictObject({
    awayTeamId: UuidSchema,
    homeTeamId: UuidSchema,
  }),
  "inning-started": z.strictObject({
    half: z.enum(["top", "bottom"]),
    inning: z.number().int().positive().max(99),
  }),
  "batter-changed": z.strictObject({
    characterId: CharacterIdSchema,
    side: TeamSideSchema,
  }),
  "pitcher-changed": z.strictObject({
    characterId: CharacterIdSchema,
    side: TeamSideSchema,
  }),
  "plate-appearance-ended": z.strictObject({
    batterCharacterId: CharacterIdSchema,
    battingSide: TeamSideSchema,
    errorByCharacterId: CharacterIdSchema.nullable(),
    outsRecorded: z.number().int().min(0).max(3),
    pitcherCharacterId: CharacterIdSchema,
    result: PlateAppearanceResultSchema,
    rbi: z.number().int().min(0).max(4),
    scorerCharacterIds: z.array(CharacterIdSchema).max(4),
  }),
  substitution: z.strictObject({
    incomingCharacterId: CharacterIdSchema,
    outgoingCharacterId: CharacterIdSchema,
    position: z.enum(["P", "C", "1B", "2B", "3B", "SS", "LF", "CF", "RF", "DH"]),
    side: TeamSideSchema,
  }),
  "game-ended": z.strictObject({
    awayRuns: z.number().int().nonnegative().max(999),
    homeRuns: z.number().int().nonnegative().max(999),
    reason: z.enum(["completed", "mercy", "forfeit", "quit"]),
  }),
  "bridge-warning": z.strictObject({
    code: z.enum(["overflow", "sequence-gap", "provisional-observation", "incompatibility"]),
    droppedEvents: z.number().int().nonnegative(),
    message: z.string().min(1).max(500),
  }),
} as const;

export function parseTelemetryEventPayload(
  eventType: z.infer<typeof TelemetryEventTypeSchema>,
  payload: unknown,
) {
  return TelemetryEventPayloadSchemas[eventType].parse(payload);
}

export const TelemetryEnvelopeSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    kind: z.literal("telemetry-envelope"),
    protocolVersion: z.literal(1),
    correlationId: UuidSchema,
    leagueId: UuidSchema,
    matchId: UuidSchema,
    attemptId: UuidSchema,
    attemptNonce: AttemptNonceSchema,
    sequence: z.number().int().positive(),
    frame: z.number().int().nonnegative(),
    eventType: TelemetryEventTypeSchema,
    observationSource: TelemetryObservationSourceSchema,
    payload: z.record(z.string().min(1), z.unknown()),
    adapterVersion: VersionSchema,
    gameBuildSha256: Sha256Schema,
    stateFingerprint: Sha256Schema.optional(),
  })
  .meta({
    title: "TelemetryEnvelope v1",
    description: "One ordered, idempotently ingestible game event.",
  });

export type TelemetryEnvelope = z.infer<typeof TelemetryEnvelopeSchema>;

export const TelemetryUploadRequestSchema = z.strictObject({
  schemaVersion: z.literal(1),
  kind: z.literal("telemetry-upload-request"),
  runnerId: UuidSchema,
  attemptId: UuidSchema,
  leaseId: UuidSchema,
  events: z.array(TelemetryEnvelopeSchema).min(1).max(256),
});

export const TelemetryUploadResponseSchema = z.strictObject({
  schemaVersion: z.literal(1),
  kind: z.literal("telemetry-upload-response"),
  attemptId: UuidSchema,
  acceptedSequences: z.array(z.number().int().positive()).max(256),
  duplicateSequences: z.array(z.number().int().positive()).max(256),
  nextExpectedSequence: z.number().int().positive(),
  maxAcceptedSequence: z.number().int().nonnegative(),
  requiresReview: z.boolean(),
  issues: z.array(z.string().min(1).max(500)).max(100),
});

export const TelemetryUploadMessageSchema = z.union([
  TelemetryUploadRequestSchema,
  TelemetryUploadResponseSchema,
]).meta({
  title: "TelemetryUploadMessage v1",
  description: "Bounded, retry-safe upload of locally spooled telemetry events.",
});

export type TelemetryUploadRequest = z.infer<typeof TelemetryUploadRequestSchema>;
export type TelemetryUploadResponse = z.infer<typeof TelemetryUploadResponseSchema>;
