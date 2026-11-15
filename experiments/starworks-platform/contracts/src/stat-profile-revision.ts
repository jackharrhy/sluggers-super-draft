import { z } from "zod";
import {
  JsonScalarSchema,
  TimestampSchema,
  UuidSchema,
} from "./common.ts";

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

function numericMatrix(rows: number, columns: number) {
  return z.array(z.array(z.number().finite()).length(columns)).length(rows);
}

function unsignedByteMatrix(rows: number, columns: number) {
  return z
    .array(z.array(z.number().int().min(0).max(255)).length(columns))
    .length(rows);
}

export const SluggersTuningSchema = z.strictObject({
  characterIdsByIndex: z.array(z.string().min(1).max(127)).length(101),
  chemistry: numericMatrix(101, 101),
  trajectoryTables: numericMatrix(24, 25),
  trajectoryNames: z.array(z.string().trim().min(1).max(100)).length(6),
  trajectoryActivation: z.array(z.number().finite()).length(6),
  globalSpeedCurves: numericMatrix(43, 2),
  teamStarEvents: numericMatrix(12, 41),
  starBoosts: numericMatrix(16, 4),
  starHandicaps: numericMatrix(4, 2),
  handicapParameters: unsignedByteMatrix(2, 3),
  importSource: z.strictObject({
    format: z.literal("stat-editor-v4"),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
  }),
});

export const StatProfileRevisionSchema = z
  .strictObject({
    kind: z.literal("stat-profile-revision"),
    leagueId: UuidSchema,
    profileId: UuidSchema,
    revisionId: UuidSchema,
    revisionNumber: z.number().int().positive(),
    status: z.enum(["draft", "published"]),
    name: z.string().min(1).max(100),
    definitions: z.array(StatDefinitionSchema).min(1).max(256),
    characterValues: z.array(CharacterStatValuesSchema).max(512),
    sluggersTuning: SluggersTuningSchema.optional(),
    basedOnRevisionId: UuidSchema.nullable(),
    createdAt: TimestampSchema,
    publishedAt: TimestampSchema.nullable(),
  })
  .meta({
    title: "StatProfileRevision",
    description:
      "The current pre-release stat vocabulary and its independently modeled values.",
  });

export type StatDefinition = z.infer<typeof StatDefinitionSchema>;
export type SluggersTuning = z.infer<typeof SluggersTuningSchema>;
export type StatProfileRevision = z.infer<typeof StatProfileRevisionSchema>;

export const statProfileIssueCodes = [
  "duplicate-definition-id",
  "duplicate-definition-key",
  "invalid-definition-range",
  "duplicate-enum-choice",
  "duplicate-character",
  "unknown-stat-key",
  "missing-required-value",
  "invalid-stat-value",
] as const;

export type StatProfileIssueCode = (typeof statProfileIssueCodes)[number];

export interface StatProfileIssue {
  code: StatProfileIssueCode;
  path: string;
}

export function validateStatProfileRevision(
  revision: StatProfileRevision,
): StatProfileIssue[] {
  let issues: StatProfileIssue[] = [];
  let definitionIds = new Set<string>();
  let definitions = new Map<string, StatDefinition>();
  for (let [index, definition] of revision.definitions.entries()) {
    if (definitionIds.has(definition.definitionId)) {
      issues.push({ code: "duplicate-definition-id", path: `definitions.${index}.definitionId` });
    }
    definitionIds.add(definition.definitionId);
    if (definitions.has(definition.key)) {
      issues.push({ code: "duplicate-definition-key", path: `definitions.${index}.key` });
    }
    definitions.set(definition.key, definition);
    if (
      (definition.dataType === "integer" || definition.dataType === "number") &&
      definition.minimum > definition.maximum
    ) {
      issues.push({ code: "invalid-definition-range", path: `definitions.${index}` });
    }
    if (definition.dataType === "enum") {
      let values = definition.choices.map((choice) => choice.value);
      if (new Set(values).size !== values.length) {
        issues.push({ code: "duplicate-enum-choice", path: `definitions.${index}.choices` });
      }
    }
  }

  let characterIds = new Set<string>();
  for (let [characterIndex, assignment] of revision.characterValues.entries()) {
    if (characterIds.has(assignment.characterId)) {
      issues.push({ code: "duplicate-character", path: `characterValues.${characterIndex}.characterId` });
    }
    characterIds.add(assignment.characterId);
    for (let [key, value] of Object.entries(assignment.values)) {
      let definition = definitions.get(key);
      if (!definition) {
        issues.push({ code: "unknown-stat-key", path: `characterValues.${characterIndex}.values.${key}` });
      } else if (!isValidStatValue(definition, value)) {
        issues.push({ code: "invalid-stat-value", path: `characterValues.${characterIndex}.values.${key}` });
      }
    }
    for (let definition of revision.definitions) {
      if (definition.required && !(definition.key in assignment.values)) {
        issues.push({
          code: "missing-required-value",
          path: `characterValues.${characterIndex}.values.${definition.key}`,
        });
      }
    }
  }
  return issues;
}

function isValidStatValue(definition: StatDefinition, value: unknown): boolean {
  if (definition.dataType === "boolean") return typeof value === "boolean";
  if (definition.dataType === "enum") {
    return (
      typeof value === "string" &&
      definition.choices.some((choice) => choice.value === value)
    );
  }
  if (typeof value !== "number" || !Number.isFinite(value)) return false;
  if (definition.dataType === "integer" && !Number.isInteger(value)) return false;
  return value >= definition.minimum && value <= definition.maximum;
}
