import { z } from "zod";
import {
  JsonScalarSchema,
  TimestampSchema,
  UuidSchema,
} from "./common.ts";
import { TelemetryEventTypeSchema } from "./telemetry-envelope.ts";

const BroadcastTeamSchema = z.strictObject({
  teamId: UuidSchema,
  name: z.string().min(1).max(160),
  side: z.enum(["home", "away"]),
  runs: z.number().int().nonnegative(),
  hits: z.number().int().nonnegative(),
  errors: z.number().int().nonnegative(),
});

const BroadcastPlayerSchema = z.strictObject({
  characterId: z.string().min(1).max(127),
  teamId: UuidSchema,
  hits: z.number().int().nonnegative(),
  homeRuns: z.number().int().nonnegative(),
  runsBattedIn: z.number().int().nonnegative(),
  runs: z.number().int().nonnegative(),
  strikeouts: z.number().int().nonnegative(),
});

const BroadcastRecentEventSchema = z.strictObject({
  sequence: z.number().int().positive(),
  frame: z.number().int().nonnegative(),
  eventType: TelemetryEventTypeSchema,
  receivedAt: TimestampSchema,
  payload: z.record(z.string(), JsonScalarSchema),
});

export const BroadcastOverlaySchema = z.strictObject({
  kind: z.literal("broadcast-overlay"),
  updatedAt: TimestampSchema,
  league: z.strictObject({
    id: UuidSchema,
    name: z.string().min(1).max(160),
    slug: z.string().min(1).max(100),
  }),
  match: z.strictObject({
    id: UuidSchema,
    status: z.enum(["scheduled", "in_progress", "provisional", "confirmed", "cancelled"]),
    attemptId: UuidSchema.nullable(),
    attemptNumber: z.number().int().positive().nullable(),
  }),
  inning: z.number().int().positive().nullable(),
  half: z.enum(["top", "bottom"]).nullable(),
  teams: z.tuple([BroadcastTeamSchema, BroadcastTeamSchema]),
  players: z.array(BroadcastPlayerSchema).max(64),
  recentEvents: z.array(BroadcastRecentEventSchema).max(20),
});

export type BroadcastOverlay = z.infer<typeof BroadcastOverlaySchema>;
