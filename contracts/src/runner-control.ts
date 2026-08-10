import { z } from "zod";
import { TimestampSchema, UuidSchema, VersionSchema } from "./common.ts";
import { RunEnvelopeSchema } from "./run-envelope.ts";

export const RunnerFeatureSchema = z.enum([
  "build-sluggers",
  "launch-dolphin",
  "runtime-bridge-v1",
  "telemetry-spool-v1",
  "capture-ffmpeg",
  "broadcast-rtmp",
]);

export const RunnerCapabilitiesSchema = z.strictObject({
  architecture: z.enum(["arm64", "x64"]),
  operatingSystem: z.enum(["linux", "macos", "windows"]),
  runnerVersion: VersionSchema,
  adapterIds: z.array(z.string().min(1).max(100)).max(16),
  features: z.array(RunnerFeatureSchema).max(RunnerFeatureSchema.options.length),
  dolphinVersion: z.string().min(1).max(100).nullable(),
});

export const RunnerComponentStateSchema = z.enum([
  "disabled",
  "starting",
  "healthy",
  "degraded",
  "failed",
  "stopped",
]);

export const RunnerComponentHealthSchema = z.strictObject({
  dolphin: RunnerComponentStateSchema.optional(),
  bridge: RunnerComponentStateSchema.optional(),
  recording: RunnerComponentStateSchema.optional(),
  publishing: RunnerComponentStateSchema.optional(),
});

export const RunnerRegistrationRequestSchema = z.strictObject({
  schemaVersion: z.literal(1),
  kind: z.literal("runner-registration-request"),
  stationName: z.string().min(2).max(100),
  capabilities: RunnerCapabilitiesSchema,
});

export const RunnerRegistrationResponseSchema = z.strictObject({
  schemaVersion: z.literal(1),
  kind: z.literal("runner-registration-response"),
  runnerId: UuidSchema,
  heartbeatSeconds: z.number().int().min(5).max(300),
  leaseSeconds: z.number().int().min(15).max(900),
  versionPolicy: z.strictObject({
    minimumRunnerVersion: VersionSchema,
    recommendedRunnerVersion: VersionSchema,
    status: z.enum(["current", "update-available", "update-required"]),
  }).optional(),
});

export const RunnerHeartbeatRequestSchema = z.strictObject({
  schemaVersion: z.literal(1),
  kind: z.literal("runner-heartbeat-request"),
  runnerId: UuidSchema,
  sentAt: TimestampSchema,
  state: z.enum(["idle", "preparing", "running", "recovering", "degraded"]),
  activeAttemptId: UuidSchema.nullable(),
  activeLeaseId: UuidSchema.nullable(),
  lastCapturedSequence: z.number().int().nonnegative().nullable(),
  components: RunnerComponentHealthSchema.optional(),
});

export const RunnerHeartbeatResponseSchema = z.strictObject({
  schemaVersion: z.literal(1),
  kind: z.literal("runner-heartbeat-response"),
  serverTime: TimestampSchema,
  accepted: z.boolean(),
});

export const RunnerClaimRequestSchema = z.strictObject({
  schemaVersion: z.literal(1),
  kind: z.literal("runner-claim-request"),
  runnerId: UuidSchema,
});

export const RunnerClaimResponseSchema = z.strictObject({
  schemaVersion: z.literal(1),
  kind: z.literal("runner-claim-response"),
  run: RunEnvelopeSchema.nullable(),
});

export const RunnerFailureKindSchema = z.enum([
  "game-crash",
  "runner-crash",
  "bridge-failure",
  "build-failure",
]);

export const RunnerLeaseUpdateRequestSchema = z.strictObject({
  schemaVersion: z.literal(1),
  kind: z.literal("runner-lease-update-request"),
  runnerId: UuidSchema,
  attemptId: UuidSchema,
  leaseId: UuidSchema,
  action: z.enum(["renew", "started", "complete", "cancel", "fail"]),
  failureKind: RunnerFailureKindSchema.nullable(),
  observedAt: TimestampSchema,
}).superRefine((message, context) => {
  if ((message.action === "fail") !== (message.failureKind !== null)) {
    context.addIssue({ code: "custom", message: "failureKind is required only for fail" });
  }
});

export const RunnerLeaseUpdateResponseSchema = z.strictObject({
  schemaVersion: z.literal(1),
  kind: z.literal("runner-lease-update-response"),
  attemptStatus: z.enum(["leased", "running", "provisional", "cancelled", "failed"]),
  expiresAt: TimestampSchema.nullable(),
});

export const RunnerControlMessageSchema = z.union([
  RunnerRegistrationRequestSchema,
  RunnerRegistrationResponseSchema,
  RunnerHeartbeatRequestSchema,
  RunnerHeartbeatResponseSchema,
  RunnerClaimRequestSchema,
  RunnerClaimResponseSchema,
  RunnerLeaseUpdateRequestSchema,
  RunnerLeaseUpdateResponseSchema,
]).meta({
  title: "RunnerControlMessage v1",
  description: "Versioned registration, heartbeat, claim, and lease messages shared by Remix and the native runner.",
});

export type RunnerCapabilities = z.infer<typeof RunnerCapabilitiesSchema>;
export type RunnerComponentHealth = z.infer<typeof RunnerComponentHealthSchema>;
export type RunnerControlMessage = z.infer<typeof RunnerControlMessageSchema>;
export type RunnerRegistrationRequest = z.infer<typeof RunnerRegistrationRequestSchema>;
export type RunnerRegistrationResponse = z.infer<typeof RunnerRegistrationResponseSchema>;
export type RunnerHeartbeatRequest = z.infer<typeof RunnerHeartbeatRequestSchema>;
export type RunnerHeartbeatResponse = z.infer<typeof RunnerHeartbeatResponseSchema>;
export type RunnerClaimRequest = z.infer<typeof RunnerClaimRequestSchema>;
export type RunnerClaimResponse = z.infer<typeof RunnerClaimResponseSchema>;
export type RunnerLeaseUpdateRequest = z.infer<typeof RunnerLeaseUpdateRequestSchema>;
export type RunnerLeaseUpdateResponse = z.infer<typeof RunnerLeaseUpdateResponseSchema>;
