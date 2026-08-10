import { z } from "zod";
import {
  AssetReferenceSchema,
  GameRevisionSchema,
  Sha256Schema,
  TimestampSchema,
  UuidSchema,
  VersionSchema,
} from "./common.ts";

const CharacterStatAssignmentSchema = z.strictObject({
  assignmentType: z.literal("character-stats"),
  characterId: z.string().min(1).max(127),
  statProfileRevisionId: UuidSchema,
});

const CharacterAssetAssignmentSchema = z.strictObject({
  assignmentType: z.literal("character-asset"),
  characterId: z.string().min(1).max(127),
  slot: z.enum(["icon", "portrait", "model", "texture"]),
  assetSha256: Sha256Schema,
});

export const ContentPackManifestSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    kind: z.literal("content-pack-manifest"),
    contentPackId: UuidSchema,
    revisionId: UuidSchema,
    targetGame: z.strictObject({
      gameId: z.literal("RMBE01"),
      supportedRevisions: z.array(GameRevisionSchema).min(1),
    }),
    statProfileRevisionId: UuidSchema,
    rulesetRevisionId: UuidSchema,
    adapterVersion: VersionSchema,
    assets: z.array(AssetReferenceSchema),
    assignments: z.array(
      z.discriminatedUnion("assignmentType", [
        CharacterStatAssignmentSchema,
        CharacterAssetAssignmentSchema,
      ]),
    ),
    createdAt: TimestampSchema,
  })
  .meta({
    title: "ContentPackManifest v1",
    description:
      "Distributable, declarative inputs for a local Sluggers game build.",
  });

export type ContentPackManifest = z.infer<
  typeof ContentPackManifestSchema
>;
