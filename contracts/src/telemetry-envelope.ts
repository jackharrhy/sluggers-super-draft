import { z } from "zod";
import {
  AttemptNonceSchema,
  JsonScalarSchema,
  Sha256Schema,
  UuidSchema,
  VersionSchema,
} from "./common.ts";

export const TelemetryEventTypeSchema = z.enum([
  "synthetic",
  "game-started",
  "inning-started",
  "plate-appearance-ended",
  "substitution",
  "game-ended",
  "bridge-warning",
]);

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
    sequence: z.number().int().nonnegative(),
    frame: z.number().int().nonnegative(),
    eventType: TelemetryEventTypeSchema,
    payload: z.record(z.string().min(1), JsonScalarSchema),
    adapterVersion: VersionSchema,
    gameBuildSha256: Sha256Schema,
    stateFingerprint: Sha256Schema.optional(),
  })
  .meta({
    title: "TelemetryEnvelope v1",
    description: "One ordered, idempotently ingestible game event.",
  });

export type TelemetryEnvelope = z.infer<typeof TelemetryEnvelopeSchema>;
