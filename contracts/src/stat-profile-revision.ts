import { z } from "zod";
import {
  JsonScalarSchema,
  TimestampSchema,
  UuidSchema,
} from "./common";

export const StatKeySchema = z
  .string()
  .regex(/^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/)
  .max(80);

const StatDisplaySchema = z.strictObject({
  label: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  group: z.string().min(1).max(100),
  order: z.number().int().nonnegative(),
  unit: z.string().min(1).max(32).optional(),
});

const GameplayMappingSchema = z.strictObject({
  adapterId: z.literal("sluggers-rmbe01"),
  loadPhase: z.enum(["build-time", "runtime"]),
  target: z.strictObject({
    resource: z.enum(["dt-na-dat", "main-dol", "runtime-bridge"]),
    field: z.string().regex(/^[A-Za-z][A-Za-z0-9_.-]{0,126}$/),
    codec: z.enum(["bool", "enum", "f32-be", "s16-be", "u16-be", "u32-be", "u8"]),
  }),
});

const DefinitionBase = z.strictObject({
  definitionId: UuidSchema,
  key: StatKeySchema,
  display: StatDisplaySchema,
  gameplayMapping: GameplayMappingSchema.optional(),
  required: z.boolean(),
});

const IntegerStatDefinitionSchema = DefinitionBase.extend({
  dataType: z.literal("integer"),
  minimum: z.number().int(),
  maximum: z.number().int(),
  step: z.number().int().positive(),
});

const NumberStatDefinitionSchema = DefinitionBase.extend({
  dataType: z.literal("number"),
  minimum: z.number().finite(),
  maximum: z.number().finite(),
  step: z.number().positive().finite(),
});

const BooleanStatDefinitionSchema = DefinitionBase.extend({
  dataType: z.literal("boolean"),
});

const EnumStatDefinitionSchema = DefinitionBase.extend({
  dataType: z.literal("enum"),
  choices: z
    .array(
      z.strictObject({
        label: z.string().min(1).max(100),
        value: z.string().min(1).max(100),
      }),
    )
    .min(1)
    .max(64),
});

export const StatDefinitionSchema = z.discriminatedUnion("dataType", [
  IntegerStatDefinitionSchema,
  NumberStatDefinitionSchema,
  BooleanStatDefinitionSchema,
  EnumStatDefinitionSchema,
]);

export const CharacterStatValuesSchema = z.strictObject({
  characterId: z.string().min(1).max(127),
  values: z.record(StatKeySchema, JsonScalarSchema),
});

export const StatProfileRevisionSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    kind: z.literal("stat-profile-revision"),
    leagueId: UuidSchema,
    profileId: UuidSchema,
    revisionId: UuidSchema,
    revisionNumber: z.number().int().positive(),
    status: z.enum(["draft", "published"]),
    name: z.string().min(1).max(100),
    definitions: z.array(StatDefinitionSchema).min(1).max(256),
    characterValues: z.array(CharacterStatValuesSchema).max(512),
    basedOnRevisionId: UuidSchema.nullable(),
    createdAt: TimestampSchema,
    publishedAt: TimestampSchema.nullable(),
  })
  .meta({
    title: "StatProfileRevision v1",
    description:
      "A versioned stat vocabulary and its independently modeled character values.",
  });

export type StatDefinition = z.infer<typeof StatDefinitionSchema>;
export type StatProfileRevision = z.infer<typeof StatProfileRevisionSchema>;
