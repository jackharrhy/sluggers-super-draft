import { z } from "zod";
import {
  JsonScalarSchema,
  TimestampSchema,
  UuidSchema,
} from "./common.ts";
import { StatKeySchema } from "./stat-profile-revision.ts";

export const RuleSettingSchema = z.strictObject({
  key: StatKeySchema,
  label: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  loadPhase: z.enum(["web-only", "build-time", "runtime"]),
  value: JsonScalarSchema,
  gameplayTarget: z
    .string()
    .regex(/^[A-Za-z][A-Za-z0-9_.-]{0,126}$/)
    .optional(),
});

export const RulesetRevisionSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    kind: z.literal("ruleset-revision"),
    leagueId: UuidSchema,
    rulesetId: UuidSchema,
    revisionId: UuidSchema,
    revisionNumber: z.number().int().positive(),
    status: z.enum(["draft", "published"]),
    name: z.string().min(1).max(100),
    settings: z.array(RuleSettingSchema).max(256),
    basedOnRevisionId: UuidSchema.nullable(),
    createdAt: TimestampSchema,
    publishedAt: TimestampSchema.nullable(),
  })
  .meta({
    title: "RulesetRevision v1",
    description:
      "An immutable-on-publication ruleset with explicit loading phases.",
  });

export type RulesetRevision = z.infer<typeof RulesetRevisionSchema>;
