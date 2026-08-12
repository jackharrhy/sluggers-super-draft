import { z } from "zod";
import {
  AttemptNonceSchema,
  JsonScalarSchema,
  Sha256Schema,
  TimestampSchema,
  UuidSchema,
  VersionSchema,
} from "./common.ts";
import { RulesetRevisionSchema } from "./ruleset-revision.ts";
import { StatProfileRevisionSchema } from "./stat-profile-revision.ts";
import { TeamLineupRevisionSchema } from "./team-lineup-revision.ts";
import { ContentPackManifestSchema } from "./content-pack-manifest.ts";
import { MatchExecutionSchema } from "./run-envelope.ts";

const HomeConfigurationSchema = z.strictObject({
  side: z.literal("home"),
  lineup: TeamLineupRevisionSchema,
});

const AwayConfigurationSchema = z.strictObject({
  side: z.literal("away"),
  lineup: TeamLineupRevisionSchema,
});

export const MatchConfigurationPackageSchema = z
  .strictObject({
    kind: z.literal("match-configuration-package"),
    adapterId: z.literal("sluggers-rmbe01"),
    adapterVersion: VersionSchema,
    leagueId: UuidSchema,
    matchId: UuidSchema,
    attemptId: UuidSchema,
    attemptNonce: AttemptNonceSchema,
    contentPack: ContentPackManifestSchema.nullable(),
    statProfile: StatProfileRevisionSchema,
    ruleset: RulesetRevisionSchema,
    teams: z.union([
      z.tuple([HomeConfigurationSchema, AwayConfigurationSchema]),
      z.tuple([AwayConfigurationSchema, HomeConfigurationSchema]),
    ]),
    dynamicRuleOverrides: z.record(z.string().min(1), JsonScalarSchema),
    execution: MatchExecutionSchema,
    generatedAt: TimestampSchema,
    requiredGameBuildSha256: Sha256Schema,
  })
  .superRefine((configuration, context) => {
    let leagueIds = new Set([
      configuration.leagueId,
      configuration.statProfile.leagueId,
      configuration.ruleset.leagueId,
      ...configuration.teams.map((team) => team.lineup.leagueId),
    ]);
    if (leagueIds.size !== 1) {
      context.addIssue({
        code: "custom",
        message: "All match configuration revisions must belong to the package league",
      });
    }
    if (configuration.statProfile.status !== "published") {
      context.addIssue({ code: "custom", message: "Stat profile must be published" });
    }
    if (configuration.ruleset.status !== "published") {
      context.addIssue({ code: "custom", message: "Ruleset must be published" });
    }
    if (configuration.contentPack) {
      if (configuration.contentPack.adapterVersion !== configuration.adapterVersion) {
        context.addIssue({ code: "custom", message: "Content pack must use the match adapter version" });
      }
      if (configuration.contentPack.statProfileRevisionId !== configuration.statProfile.revisionId) {
        context.addIssue({ code: "custom", message: "Content pack must use the match stat profile" });
      }
      if (configuration.contentPack.rulesetRevisionId !== configuration.ruleset.revisionId) {
        context.addIssue({ code: "custom", message: "Content pack must use the match ruleset" });
      }
    }
    for (let team of configuration.teams) {
      if (team.lineup.status !== "published") {
        context.addIssue({ code: "custom", message: `${team.side} lineup must be published` });
      }
    }
  })
  .meta({
    title: "MatchConfigurationPackage",
    description:
      "Published declarative inputs for one leased attempt; contains no game buffers, addresses, or executable patches.",
  });

export type MatchConfigurationPackage = z.infer<typeof MatchConfigurationPackageSchema>;
