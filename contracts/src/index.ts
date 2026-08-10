export * from "./common";
export * from "./content-pack-manifest";
export * from "./game-build-manifest";
export * from "./run-envelope";
export * from "./telemetry-envelope";

import { ContentPackManifestSchema } from "./content-pack-manifest";
import { GameBuildManifestSchema } from "./game-build-manifest";
import { RunEnvelopeSchema } from "./run-envelope";
import { TelemetryEnvelopeSchema } from "./telemetry-envelope";

export const contractSchemas = {
  "content-pack-manifest": ContentPackManifestSchema,
  "game-build-manifest": GameBuildManifestSchema,
  "run-envelope": RunEnvelopeSchema,
  "telemetry-envelope": TelemetryEnvelopeSchema,
} as const;

export type ContractName = keyof typeof contractSchemas;
