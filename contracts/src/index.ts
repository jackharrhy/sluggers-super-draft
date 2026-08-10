export * from "./adapter-operation-bundle";
export * from "./common";
export * from "./content-pack-manifest";
export * from "./game-build-manifest";
export * from "./run-envelope";
export * from "./ruleset-revision";
export * from "./stat-profile-revision";
export * from "./team-lineup-revision";
export * from "./telemetry-envelope";

import { ContentPackManifestSchema } from "./content-pack-manifest";
import { GameBuildManifestSchema } from "./game-build-manifest";
import { RunEnvelopeSchema } from "./run-envelope";
import { RulesetRevisionSchema } from "./ruleset-revision";
import { StatProfileRevisionSchema } from "./stat-profile-revision";
import { TeamLineupRevisionSchema } from "./team-lineup-revision";
import { TelemetryEnvelopeSchema } from "./telemetry-envelope";

export const contractSchemas = {
  "adapter-operation-bundle": AdapterOperationBundleSchema,
  "content-pack-manifest": ContentPackManifestSchema,
  "game-build-manifest": GameBuildManifestSchema,
  "run-envelope": RunEnvelopeSchema,
  "ruleset-revision": RulesetRevisionSchema,
  "stat-profile-revision": StatProfileRevisionSchema,
  "team-lineup-revision": TeamLineupRevisionSchema,
  "telemetry-envelope": TelemetryEnvelopeSchema,
} as const;

export type ContractName = keyof typeof contractSchemas;
import { AdapterOperationBundleSchema } from "./adapter-operation-bundle";
