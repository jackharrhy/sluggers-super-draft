import { z } from "zod";
import {
  JsonScalarSchema,
  TimestampSchema,
  UuidSchema,
  VersionSchema,
} from "./common.ts";
import { FieldingPositionSchema } from "./team-lineup-revision.ts";

const SetCharacterStatOperationSchema = z.strictObject({
  operation: z.literal("set-character-stat"),
  characterId: z.string().min(1).max(127),
  statKey: z.string().min(1).max(80),
  gameplayTarget: z.string().regex(/^[A-Za-z][A-Za-z0-9_.-]{0,126}$/),
  value: JsonScalarSchema,
});

const SetGameRuleOperationSchema = z.strictObject({
  operation: z.literal("set-game-rule"),
  ruleKey: z.string().min(1).max(80),
  loadPhase: z.enum(["build-time", "runtime"]),
  gameplayTarget: z.string().regex(/^[A-Za-z][A-Za-z0-9_.-]{0,126}$/),
  value: JsonScalarSchema,
});

const SelectRosterSlotOperationSchema = z.strictObject({
  operation: z.literal("select-roster-slot"),
  slot: z.number().int().min(0).max(17),
  characterId: z.string().min(1).max(127),
});

const SetCaptainOperationSchema = z.strictObject({
  operation: z.literal("set-captain"),
  characterId: z.string().min(1).max(127),
});

const SetBattingSlotOperationSchema = z.strictObject({
  operation: z.literal("set-batting-slot"),
  slot: z.number().int().min(1).max(9),
  characterId: z.string().min(1).max(127),
});

const SetFieldingPositionOperationSchema = z.strictObject({
  operation: z.literal("set-fielding-position"),
  position: FieldingPositionSchema,
  characterId: z.string().min(1).max(127),
});

export const AdapterOperationSchema = z.discriminatedUnion("operation", [
  SetCharacterStatOperationSchema,
  SetGameRuleOperationSchema,
  SelectRosterSlotOperationSchema,
  SetCaptainOperationSchema,
  SetBattingSlotOperationSchema,
  SetFieldingPositionOperationSchema,
]);

export const AdapterOperationBundleSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    kind: z.literal("adapter-operation-bundle"),
    adapterId: z.literal("sluggers-rmbe01"),
    adapterVersion: VersionSchema,
    leagueId: UuidSchema,
    statProfileRevisionId: UuidSchema,
    rulesetRevisionId: UuidSchema,
    rosterRevisionId: UuidSchema,
    lineupRevisionId: UuidSchema,
    matchLineupOverrideId: UuidSchema.nullable(),
    operations: z.array(AdapterOperationSchema).max(8192),
    generatedAt: TimestampSchema,
  })
  .meta({
    title: "AdapterOperationBundle v1",
    description:
      "Symbolic, bounded operations translated by a versioned game adapter; never raw memory writes.",
  });

export type AdapterOperation = z.infer<typeof AdapterOperationSchema>;
export type AdapterOperationBundle = z.infer<typeof AdapterOperationBundleSchema>;
