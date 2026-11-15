import { z } from "zod";

export const UuidSchema = z.uuid();
export const Sha256Schema = z
  .string()
  .regex(/^[a-f0-9]{64}$/, "Expected a lowercase SHA-256 digest");
export const VersionSchema = z
  .string()
  .regex(
    /^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/,
    "Expected a semantic version",
  );
export const TimestampSchema = z.iso.datetime({ offset: true });
export const AttemptNonceSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{32,128}$/, "Expected a URL-safe attempt nonce");

export const JsonScalarSchema = z.union([
  z.string(),
  z.number().finite(),
  z.boolean(),
  z.null(),
]);

export const AssetReferenceSchema = z.strictObject({
  sha256: Sha256Schema,
  mediaType: z.string().min(1).max(127),
  sizeBytes: z.number().int().nonnegative(),
  displayName: z.string().min(1).max(255).optional(),
});

export const GameRevisionSchema = z.strictObject({
  region: z.literal("NTSC-U"),
  revision: z.literal(0),
  mainDolSha256: Sha256Schema,
});

export const RelativeBuildPathSchema = z
  .string()
  .regex(
    /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*$/,
    "Expected a safe relative build path",
  );
