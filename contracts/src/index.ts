export * from "./adapter-operation-bundle.ts";
export * from "./common.ts";
export * from "./compile-adapter-operations.ts";
export * from "./content-pack-manifest.ts";
export * from "./game-build-manifest.ts";
export * from "./run-envelope.ts";
export * from "./runner-control.ts";
export * from "./ruleset-revision.ts";
export * from "./stat-profile-revision.ts";
export * from "./team-lineup-revision.ts";
export * from "./telemetry-envelope.ts";

import { AdapterOperationBundleSchema } from "./adapter-operation-bundle.ts";
import { ContentPackManifestSchema } from "./content-pack-manifest.ts";
import { GameBuildManifestSchema } from "./game-build-manifest.ts";
import { RunEnvelopeSchema } from "./run-envelope.ts";
import { RunnerControlMessageSchema } from "./runner-control.ts";
import { RulesetRevisionSchema } from "./ruleset-revision.ts";
import { StatProfileRevisionSchema } from "./stat-profile-revision.ts";
import { TeamLineupRevisionSchema } from "./team-lineup-revision.ts";
import { TelemetryEnvelopeSchema } from "./telemetry-envelope.ts";

export const contractSchemas = {
  "adapter-operation-bundle": AdapterOperationBundleSchema,
  "content-pack-manifest": ContentPackManifestSchema,
  "game-build-manifest": GameBuildManifestSchema,
  "run-envelope": RunEnvelopeSchema,
  "runner-control": RunnerControlMessageSchema,
  "ruleset-revision": RulesetRevisionSchema,
  "stat-profile-revision": StatProfileRevisionSchema,
  "team-lineup-revision": TeamLineupRevisionSchema,
  "telemetry-envelope": TelemetryEnvelopeSchema,
} as const;

export type ContractName = keyof typeof contractSchemas;
