import {
  AdapterOperationBundleSchema,
  type AdapterOperation,
  type AdapterOperationBundle,
} from "./adapter-operation-bundle.ts";
import type { RulesetRevision } from "./ruleset-revision.ts";
import {
  validateStatProfileRevision,
  type StatProfileRevision,
} from "./stat-profile-revision.ts";
import {
  validateTeamLineupRevision,
  type TeamLineupRevision,
} from "./team-lineup-revision.ts";

export interface CompileAdapterOperationsInput {
  adapterVersion: string;
  generatedAt: string;
  lineup: TeamLineupRevision;
  matchLineupOverrideId?: string | null;
  profile: StatProfileRevision;
  ruleset: RulesetRevision;
}

export function compileAdapterOperations(
  input: CompileAdapterOperationsInput,
): AdapterOperationBundle {
  requirePublished(input.profile.status, "stat profile");
  requirePublished(input.ruleset.status, "ruleset");
  requirePublished(input.lineup.status, "lineup");
  let leagueIds = new Set([
    input.profile.leagueId,
    input.ruleset.leagueId,
    input.lineup.leagueId,
  ]);
  if (leagueIds.size !== 1) throw new Error("Configuration revisions belong to different leagues");
  let statIssues = validateStatProfileRevision(input.profile);
  if (statIssues.length) {
    throw new Error(`Stat profile is invalid: ${statIssues.map((issue) => issue.code).join(", ")}`);
  }
  let lineupIssues = validateTeamLineupRevision(input.lineup);
  if (lineupIssues.length) {
    throw new Error(`Lineup is invalid: ${lineupIssues.join(", ")}`);
  }

  let operations: AdapterOperation[] = [];
  if (input.profile.sluggersTuning) {
    let valuesByCharacter = new Map(
      input.profile.characterValues.map((assignment) => [assignment.characterId, assignment]),
    );
    let orderedValues = input.profile.sluggersTuning.characterIdsByIndex.map((characterId) => {
      let assignment = valuesByCharacter.get(characterId);
      if (!assignment) {
        throw new Error(`Full Sluggers profile is missing character values for ${characterId}`);
      }
      return assignment;
    });
    if (new Set(input.profile.sluggersTuning.characterIdsByIndex).size !== 101) {
      throw new Error("Full Sluggers profile character slots must be unique");
    }
    operations.push({
      operation: "apply-sluggers-stat-profile",
      loadPhase: "build-time",
      resource: "main-dol",
      characterValues: orderedValues,
      tuning: input.profile.sluggersTuning,
    });
  } else {
    let definitions = new Map(input.profile.definitions.map((definition) => [definition.key, definition]));
    for (let assignment of [...input.profile.characterValues].sort((left, right) => left.characterId.localeCompare(right.characterId))) {
      for (let [key, value] of Object.entries(assignment.values).sort(([left], [right]) => left.localeCompare(right))) {
        let mapping = definitions.get(key)?.gameplayMapping;
        if (!mapping) continue;
        operations.push({
          operation: "set-character-stat",
          characterId: assignment.characterId,
          statKey: key,
          gameplayTarget: mapping.target.field,
          loadPhase: mapping.loadPhase,
          resource: mapping.target.resource,
          codec: mapping.target.codec,
          value,
        });
      }
    }
  }
  for (let setting of [...input.ruleset.settings].sort((left, right) => left.key.localeCompare(right.key))) {
    if (setting.loadPhase === "web-only") continue;
    if (!setting.gameplayTarget) throw new Error(`Game rule ${setting.key} has no gameplay target`);
    operations.push({
      operation: "set-game-rule",
      ruleKey: setting.key,
      loadPhase: setting.loadPhase,
      gameplayTarget: setting.gameplayTarget,
      value: setting.value,
    });
  }
  input.lineup.rosterCharacterIds.forEach((characterId, slot) => {
    operations.push({ operation: "select-roster-slot", slot, characterId });
  });
  operations.push({
    operation: "set-captain",
    characterId: input.lineup.lineup.captainCharacterId,
  });
  input.lineup.lineup.battingOrder.forEach((characterId, index) => {
    operations.push({ operation: "set-batting-slot", slot: index + 1, characterId });
  });
  for (let assignment of input.lineup.lineup.fielding) {
    operations.push({
      operation: "set-fielding-position",
      position: assignment.position,
      characterId: assignment.characterId,
    });
  }

  return AdapterOperationBundleSchema.parse({
    schemaVersion: 1,
    kind: "adapter-operation-bundle",
    adapterId: "sluggers-rmbe01",
    adapterVersion: input.adapterVersion,
    leagueId: input.profile.leagueId,
    statProfileRevisionId: input.profile.revisionId,
    rulesetRevisionId: input.ruleset.revisionId,
    rosterRevisionId: input.lineup.rosterRevisionId,
    lineupRevisionId: input.lineup.lineupRevisionId,
    matchLineupOverrideId: input.matchLineupOverrideId ?? null,
    operations,
    generatedAt: input.generatedAt,
  });
}

function requirePublished(status: "draft" | "published", name: string): void {
  if (status !== "published") throw new Error(`${name} must be published`);
}
