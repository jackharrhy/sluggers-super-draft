import { z } from "zod";
import {
  RelativeBuildPathSchema,
  Sha256Schema,
  VersionSchema,
} from "./common.ts";

const FingerprintedFileSchema = z.strictObject({
  path: RelativeBuildPathSchema,
  sha256: Sha256Schema,
  sizeBytes: z.number().int().nonnegative(),
});

const PatchReceiptSchema = z.strictObject({
  patchId: z.string().min(1).max(127),
  targetPath: RelativeBuildPathSchema,
  expectedInputSha256: Sha256Schema,
  outputSha256: Sha256Schema,
});

export const GameBuildManifestSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    kind: z.literal("game-build-manifest"),
    baseGame: z.strictObject({
      gameId: z.literal("RMBE01"),
      region: z.literal("NTSC-U"),
      revision: z.literal(0),
      discHeaderSha256: Sha256Schema,
      mainDolSha256: Sha256Schema,
      dataArchiveSha256: Sha256Schema,
      fstSha256: Sha256Schema,
    }),
    adapterVersion: VersionSchema,
    adapterBuildSha256: Sha256Schema,
    compilerVersion: VersionSchema,
    contentPackSha256: Sha256Schema,
    buildSha256: Sha256Schema,
    gameTreeSha256: Sha256Schema,
    outputs: z.array(FingerprintedFileSchema).min(1),
    patchReceipts: z.array(PatchReceiptSchema),
    compatible: z.boolean(),
    warnings: z.array(
      z.strictObject({
        code: z.string().min(1).max(127),
        message: z.string().min(1).max(1_024),
      }),
    ),
  })
  .meta({
    title: "GameBuildManifest",
    description:
      "A deterministic local build receipt whose identity includes the exact adapter artifact but no game data.",
  });

export type GameBuildManifest = z.infer<typeof GameBuildManifestSchema>;
