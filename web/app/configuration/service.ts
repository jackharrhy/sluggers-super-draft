import { randomUUID } from 'node:crypto'

import {
  MatchLineupOverrideSchema,
  RulesetRevisionSchema,
  StatProfileRevisionSchema,
  TeamLineupRevisionSchema,
  compileAdapterOperations,
  validateStatProfileRevision,
  validateTeamLineupRevision,
  type AdapterOperationBundle,
  type MatchLineupOverride,
  type RulesetRevision,
  type StatProfileRevision,
  type TeamLineupRevision,
} from '@starworks/contracts'
import { and, asc, desc, eq, max } from 'drizzle-orm'

import {
  auditRecords,
  leagueTeams,
  lineupRevisions,
  matchLineupOverrides,
  rosterRevisions,
  rulesetRevisions,
  rulesets,
  statProfileRevisions,
  statProfiles,
} from '../platform/database/schema.ts'
import type { StarworksDatabase } from '../platform/database/connection.ts'
import { PlatformError } from '../platform/errors.ts'
import type { SessionIdentity } from '../platform/model.ts'
import { administrativeRoles } from '../platform/repository.ts'
import { validateSluggersLineup, type SluggersLineupIssue } from '../sluggers/lineups.ts'

export interface ConfigurationServiceOptions {
  clock?: () => Date
  createId?: () => string
}

export interface ConfigurationDashboard {
  profiles: Array<{ id: string; name: string; slug: string; revisions: RevisionSummary[] }>
  rulesets: Array<{ id: string; name: string; slug: string; revisions: RevisionSummary[] }>
  teams: Array<{ id: string; name: string; lineups: RevisionSummary[] }>
}

export interface RevisionSummary {
  id: string
  revisionNumber: number
  status: 'draft' | 'published'
  createdAt: Date
  publishedAt: Date | null
}

export interface StatProfileRevisionDetail {
  basedOnRevision: StatProfileRevision | null
  history: RevisionSummary[]
  issues: ReturnType<typeof validateStatProfileRevision>
  revision: StatProfileRevision
}

export interface RulesetRevisionDetail {
  basedOnRevision: RulesetRevision | null
  history: RevisionSummary[]
  revision: RulesetRevision
}

export interface TeamLineupRevisionDetail {
  basedOnRevision: TeamLineupRevision | null
  history: RevisionSummary[]
  issues: Array<ReturnType<typeof validateTeamLineupRevision>[number] | SluggersLineupIssue>
  revision: TeamLineupRevision
  teamName: string
}

export type ConfigurationApplication = Pick<
  ConfigurationService,
  | 'cloneRulesetRevision'
  | 'cloneStatProfileRevision'
  | 'cloneTeamLineupRevision'
  | 'compilePublishedConfiguration'
  | 'createMatchLineupOverride'
  | 'createRulesetDraft'
  | 'createStatProfileDraft'
  | 'createTeamLineupDraft'
  | 'dashboard'
  | 'getRulesetRevision'
  | 'getStatProfileRevision'
  | 'getTeamLineupRevision'
  | 'publishRuleset'
  | 'publishStatProfile'
  | 'publishTeamLineup'
  | 'updateRulesetDraft'
  | 'updateStatProfileDraft'
  | 'updateTeamLineupDraft'
>

export class ConfigurationService {
  readonly #clock: () => Date
  readonly #createId: () => string

  constructor(
    readonly database: StarworksDatabase,
    options: ConfigurationServiceOptions = {},
  ) {
    this.#clock = options.clock ?? (() => new Date())
    this.#createId = options.createId ?? randomUUID
  }

  async dashboard(identity: SessionIdentity | null, leagueId: string): Promise<ConfigurationDashboard> {
    this.#requireLeagueAdmin(identity, leagueId)
    let [profileRows, profileRevisionRows, rulesetRows, rulesetRevisionRows, teamRows, lineupRows] =
      await Promise.all([
        this.database.select().from(statProfiles).where(eq(statProfiles.leagueId, leagueId)).orderBy(asc(statProfiles.name)),
        this.database.select().from(statProfileRevisions).where(eq(statProfileRevisions.leagueId, leagueId)).orderBy(desc(statProfileRevisions.revisionNumber)),
        this.database.select().from(rulesets).where(eq(rulesets.leagueId, leagueId)).orderBy(asc(rulesets.name)),
        this.database.select().from(rulesetRevisions).where(eq(rulesetRevisions.leagueId, leagueId)).orderBy(desc(rulesetRevisions.revisionNumber)),
        this.database.select({ id: leagueTeams.id, name: leagueTeams.name }).from(leagueTeams).where(eq(leagueTeams.leagueId, leagueId)).orderBy(asc(leagueTeams.name)),
        this.database.select().from(lineupRevisions).where(eq(lineupRevisions.leagueId, leagueId)).orderBy(desc(lineupRevisions.revisionNumber)),
      ])
    return {
      profiles: profileRows.map((profile) => ({
        id: profile.id,
        name: profile.name,
        slug: profile.slug,
        revisions: profileRevisionRows.filter((revision) => revision.profileId === profile.id).map(summary),
      })),
      rulesets: rulesetRows.map((ruleset) => ({
        id: ruleset.id,
        name: ruleset.name,
        slug: ruleset.slug,
        revisions: rulesetRevisionRows.filter((revision) => revision.rulesetId === ruleset.id).map(summary),
      })),
      teams: teamRows.map((team) => ({
        ...team,
        lineups: lineupRows.filter((revision) => revision.teamId === team.id).map(summary),
      })),
    }
  }

  async createStatProfileDraft(
    identity: SessionIdentity | null,
    leagueId: string,
    input: Pick<StatProfileRevision, 'name' | 'definitions' | 'characterValues' | 'sluggersTuning'> & { slug: string },
  ): Promise<StatProfileRevision> {
    this.#requireLeagueAdmin(identity, leagueId)
    let now = this.#clock()
    let revision = StatProfileRevisionSchema.parse({
      kind: 'stat-profile-revision',
      leagueId,
      profileId: this.#createId(),
      revisionId: this.#createId(),
      revisionNumber: 1,
      status: 'draft',
      name: input.name,
      definitions: input.definitions,
      characterValues: input.characterValues,
      sluggersTuning: input.sluggersTuning,
      basedOnRevisionId: null,
      createdAt: now.toISOString(),
      publishedAt: null,
    })
    await this.database.transaction(async (transaction) => {
      await transaction.insert(statProfiles).values({
        id: revision.profileId,
        leagueId,
        name: input.name,
        slug: input.slug,
      })
      await transaction.insert(statProfileRevisions).values({
        basedOnRevisionId: null,
        characterValues: revision.characterValues,
        createdAt: now,
        createdByPersonId: identity!.personId,
        definitions: revision.definitions,
        id: revision.revisionId,
        leagueId,
        name: revision.name,
        profileId: revision.profileId,
        sluggersTuning: revision.sluggersTuning,
        revisionNumber: 1,
      })
      await audit(transaction, identity!.personId, leagueId, 'stat_profile.draft.created', revision.revisionId)
    })
    return revision
  }

  async getStatProfileRevision(
    identity: SessionIdentity | null,
    leagueId: string,
    revisionId: string,
  ): Promise<StatProfileRevisionDetail> {
    this.#requireLeagueAdmin(identity, leagueId)
    let revision = await this.#loadStatRevision(leagueId, revisionId)
    if (!revision) throw new PlatformError('Stat profile revision was not found', 'not_found')
    let history = await this.database
      .select()
      .from(statProfileRevisions)
      .where(and(eq(statProfileRevisions.leagueId, leagueId), eq(statProfileRevisions.profileId, revision.profileId)))
      .orderBy(desc(statProfileRevisions.revisionNumber))
    let basedOnRevision = revision.basedOnRevisionId
      ? await this.#loadStatRevision(leagueId, revision.basedOnRevisionId)
      : null
    return { basedOnRevision, revision, history: history.map(summary), issues: validateStatProfileRevision(revision) }
  }

  async updateStatProfileDraft(
    identity: SessionIdentity | null,
    leagueId: string,
    revisionId: string,
    input: Pick<StatProfileRevision, 'name' | 'definitions' | 'characterValues' | 'sluggersTuning'>,
  ): Promise<StatProfileRevision> {
    this.#requireLeagueAdmin(identity, leagueId)
    let current = await this.#loadStatRevision(leagueId, revisionId)
    if (!current) throw new PlatformError('Stat profile revision was not found', 'not_found')
    let revision = StatProfileRevisionSchema.parse({ ...current, ...input })
    let updated = await this.database
      .update(statProfileRevisions)
      .set({ characterValues: revision.characterValues, definitions: revision.definitions, name: revision.name, sluggersTuning: revision.sluggersTuning })
      .where(and(eq(statProfileRevisions.id, revisionId), eq(statProfileRevisions.leagueId, leagueId), eq(statProfileRevisions.status, 'draft')))
      .returning({ id: statProfileRevisions.id })
    if (!updated.length) throw new PlatformError('Published revisions cannot be edited', 'conflict')
    return revision
  }

  async publishStatProfile(
    identity: SessionIdentity | null,
    leagueId: string,
    revisionId: string,
  ): Promise<StatProfileRevision> {
    this.#requireLeagueAdmin(identity, leagueId)
    let revision = await this.#loadStatRevision(leagueId, revisionId)
    if (!revision) throw new PlatformError('Stat profile revision was not found', 'not_found')
    let issues = validateStatProfileRevision(revision)
    if (issues.length) throw new PlatformError(`Stat profile is invalid: ${issues.map((issue) => issue.code).join(', ')}`, 'invalid_input')
    let now = this.#clock()
    await this.database.transaction(async (transaction) => {
      let updated = await transaction
        .update(statProfileRevisions)
        .set({ publishedAt: now, status: 'published' })
        .where(and(eq(statProfileRevisions.id, revisionId), eq(statProfileRevisions.leagueId, leagueId), eq(statProfileRevisions.status, 'draft')))
        .returning({ id: statProfileRevisions.id })
      if (!updated.length) throw new PlatformError('Revision is already published', 'conflict')
      await audit(transaction, identity!.personId, leagueId, 'stat_profile.published', revisionId)
    })
    return { ...revision, publishedAt: now.toISOString(), status: 'published' }
  }

  async cloneStatProfileRevision(
    identity: SessionIdentity | null,
    leagueId: string,
    revisionId: string,
  ): Promise<StatProfileRevision> {
    this.#requireLeagueAdmin(identity, leagueId)
    let source = await this.#loadStatRevision(leagueId, revisionId)
    if (!source) throw new PlatformError('Stat profile revision was not found', 'not_found')
    if (source.status !== 'published') {
      throw new PlatformError('Only a published stat profile can start a new revision', 'conflict')
    }
    let [latest] = await this.database
      .select({ value: max(statProfileRevisions.revisionNumber) })
      .from(statProfileRevisions)
      .where(and(eq(statProfileRevisions.leagueId, leagueId), eq(statProfileRevisions.profileId, source.profileId)))
    let now = this.#clock()
    let revision = StatProfileRevisionSchema.parse({
      ...source,
      basedOnRevisionId: source.revisionId,
      createdAt: now.toISOString(),
      publishedAt: null,
      revisionId: this.#createId(),
      revisionNumber: (latest?.value ?? 0) + 1,
      status: 'draft',
    })
    await this.database.transaction(async (transaction) => {
      await transaction.insert(statProfileRevisions).values({
        basedOnRevisionId: source.revisionId,
        characterValues: revision.characterValues,
        createdAt: now,
        createdByPersonId: identity!.personId,
        definitions: revision.definitions,
        id: revision.revisionId,
        leagueId,
        name: revision.name,
        profileId: revision.profileId,
        sluggersTuning: revision.sluggersTuning,
        revisionNumber: revision.revisionNumber,
      })
      await audit(transaction, identity!.personId, leagueId, 'stat_profile.revision.cloned', revision.revisionId)
    })
    return revision
  }

  async createRulesetDraft(
    identity: SessionIdentity | null,
    leagueId: string,
    input: Pick<RulesetRevision, 'name' | 'settings'> & { slug: string },
  ): Promise<RulesetRevision> {
    this.#requireLeagueAdmin(identity, leagueId)
    let now = this.#clock()
    let revision = RulesetRevisionSchema.parse({
      kind: 'ruleset-revision',
      leagueId,
      rulesetId: this.#createId(),
      revisionId: this.#createId(),
      revisionNumber: 1,
      status: 'draft',
      name: input.name,
      settings: input.settings,
      basedOnRevisionId: null,
      createdAt: now.toISOString(),
      publishedAt: null,
    })
    await this.database.transaction(async (transaction) => {
      await transaction.insert(rulesets).values({ id: revision.rulesetId, leagueId, name: input.name, slug: input.slug })
      await transaction.insert(rulesetRevisions).values({
        createdAt: now,
        createdByPersonId: identity!.personId,
        id: revision.revisionId,
        leagueId,
        name: revision.name,
        revisionNumber: 1,
        rulesetId: revision.rulesetId,
        settings: revision.settings,
      })
      await audit(transaction, identity!.personId, leagueId, 'ruleset.draft.created', revision.revisionId)
    })
    return revision
  }

  async getRulesetRevision(identity: SessionIdentity | null, leagueId: string, revisionId: string): Promise<RulesetRevisionDetail> {
    this.#requireLeagueAdmin(identity, leagueId)
    let revision = await this.#loadRulesetRevision(leagueId, revisionId)
    if (!revision) throw new PlatformError('Ruleset revision was not found', 'not_found')
    let history = await this.database.select().from(rulesetRevisions).where(and(eq(rulesetRevisions.leagueId, leagueId), eq(rulesetRevisions.rulesetId, revision.rulesetId))).orderBy(desc(rulesetRevisions.revisionNumber))
    let basedOnRevision = revision.basedOnRevisionId
      ? await this.#loadRulesetRevision(leagueId, revision.basedOnRevisionId)
      : null
    return { basedOnRevision, revision, history: history.map(summary) }
  }

  async updateRulesetDraft(identity: SessionIdentity | null, leagueId: string, revisionId: string, input: Pick<RulesetRevision, 'name' | 'settings'>): Promise<RulesetRevision> {
    this.#requireLeagueAdmin(identity, leagueId)
    let current = await this.#loadRulesetRevision(leagueId, revisionId)
    if (!current) throw new PlatformError('Ruleset revision was not found', 'not_found')
    let revision = RulesetRevisionSchema.parse({ ...current, ...input })
    let updated = await this.database.update(rulesetRevisions).set({ name: revision.name, settings: revision.settings }).where(and(eq(rulesetRevisions.id, revisionId), eq(rulesetRevisions.leagueId, leagueId), eq(rulesetRevisions.status, 'draft'))).returning({ id: rulesetRevisions.id })
    if (!updated.length) throw new PlatformError('Published revisions cannot be edited', 'conflict')
    return revision
  }

  async publishRuleset(identity: SessionIdentity | null, leagueId: string, revisionId: string): Promise<RulesetRevision> {
    this.#requireLeagueAdmin(identity, leagueId)
    let revision = await this.#loadRulesetRevision(leagueId, revisionId)
    if (!revision) throw new PlatformError('Ruleset revision was not found', 'not_found')
    for (let setting of revision.settings) {
      if (setting.loadPhase !== 'web-only' && !setting.gameplayTarget) throw new PlatformError(`Rule ${setting.key} requires a gameplay target`, 'invalid_input')
    }
    let now = this.#clock()
    await this.database.transaction(async (transaction) => {
      let updated = await transaction.update(rulesetRevisions).set({ publishedAt: now, status: 'published' }).where(and(eq(rulesetRevisions.id, revisionId), eq(rulesetRevisions.leagueId, leagueId), eq(rulesetRevisions.status, 'draft'))).returning({ id: rulesetRevisions.id })
      if (!updated.length) throw new PlatformError('Revision is already published', 'conflict')
      await audit(transaction, identity!.personId, leagueId, 'ruleset.published', revisionId)
    })
    return { ...revision, publishedAt: now.toISOString(), status: 'published' }
  }

  async cloneRulesetRevision(
    identity: SessionIdentity | null,
    leagueId: string,
    revisionId: string,
  ): Promise<RulesetRevision> {
    this.#requireLeagueAdmin(identity, leagueId)
    let source = await this.#loadRulesetRevision(leagueId, revisionId)
    if (!source) throw new PlatformError('Ruleset revision was not found', 'not_found')
    if (source.status !== 'published') {
      throw new PlatformError('Only a published ruleset can start a new revision', 'conflict')
    }
    let [latest] = await this.database
      .select({ value: max(rulesetRevisions.revisionNumber) })
      .from(rulesetRevisions)
      .where(and(eq(rulesetRevisions.leagueId, leagueId), eq(rulesetRevisions.rulesetId, source.rulesetId)))
    let now = this.#clock()
    let revision = RulesetRevisionSchema.parse({
      ...source,
      basedOnRevisionId: source.revisionId,
      createdAt: now.toISOString(),
      publishedAt: null,
      revisionId: this.#createId(),
      revisionNumber: (latest?.value ?? 0) + 1,
      status: 'draft',
    })
    await this.database.transaction(async (transaction) => {
      await transaction.insert(rulesetRevisions).values({
        basedOnRevisionId: source.revisionId,
        createdAt: now,
        createdByPersonId: identity!.personId,
        id: revision.revisionId,
        leagueId,
        name: revision.name,
        revisionNumber: revision.revisionNumber,
        rulesetId: revision.rulesetId,
        settings: revision.settings,
      })
      await audit(transaction, identity!.personId, leagueId, 'ruleset.revision.cloned', revision.revisionId)
    })
    return revision
  }

  async createTeamLineupDraft(
    identity: SessionIdentity | null,
    leagueId: string,
    teamId: string,
    input: { rosterCharacterIds: string[]; lineup: TeamLineupRevision['lineup'] },
  ): Promise<TeamLineupRevision> {
    await this.#requireTeamAdmin(identity, leagueId, teamId)
    let now = this.#clock()
    let [rosterMax] = await this.database.select({ value: max(rosterRevisions.revisionNumber) }).from(rosterRevisions).where(and(eq(rosterRevisions.leagueId, leagueId), eq(rosterRevisions.teamId, teamId)))
    let [lineupMax] = await this.database.select({ value: max(lineupRevisions.revisionNumber) }).from(lineupRevisions).where(and(eq(lineupRevisions.leagueId, leagueId), eq(lineupRevisions.teamId, teamId)))
    let revision = TeamLineupRevisionSchema.parse({
      kind: 'team-lineup-revision',
      leagueId,
      teamId,
      rosterRevisionId: this.#createId(),
      rosterRevisionNumber: (rosterMax?.value ?? 0) + 1,
      lineupRevisionId: this.#createId(),
      lineupRevisionNumber: (lineupMax?.value ?? 0) + 1,
      status: 'draft',
      rosterCharacterIds: input.rosterCharacterIds,
      lineup: input.lineup,
      basedOnLineupRevisionId: null,
      createdAt: now.toISOString(),
      publishedAt: null,
    })
    await this.database.transaction(async (transaction) => {
      await transaction.insert(rosterRevisions).values({
        createdAt: now,
        createdByPersonId: identity!.personId,
        id: revision.rosterRevisionId,
        leagueId,
        revisionNumber: revision.rosterRevisionNumber,
        rosterCharacterIds: revision.rosterCharacterIds,
        teamId,
      })
      await transaction.insert(lineupRevisions).values({
        createdAt: now,
        createdByPersonId: identity!.personId,
        id: revision.lineupRevisionId,
        leagueId,
        lineup: revision.lineup,
        revisionNumber: revision.lineupRevisionNumber,
        rosterRevisionId: revision.rosterRevisionId,
        teamId,
      })
      await audit(transaction, identity!.personId, leagueId, 'lineup.draft.created', revision.lineupRevisionId)
    })
    return revision
  }

  async getTeamLineupRevision(identity: SessionIdentity | null, leagueId: string, teamId: string, revisionId: string): Promise<TeamLineupRevisionDetail> {
    await this.#requireTeamAdmin(identity, leagueId, teamId)
    let [revision, [team]] = await Promise.all([
      this.#loadLineupRevision(leagueId, teamId, revisionId),
      this.database.select({ name: leagueTeams.name }).from(leagueTeams).where(and(eq(leagueTeams.leagueId, leagueId), eq(leagueTeams.id, teamId))).limit(1),
    ])
    if (!revision || !team) throw new PlatformError('Lineup revision was not found', 'not_found')
    let [history, basedOnRevision] = await Promise.all([
      this.database.select().from(lineupRevisions).where(and(eq(lineupRevisions.leagueId, leagueId), eq(lineupRevisions.teamId, teamId))).orderBy(desc(lineupRevisions.revisionNumber)),
      revision.basedOnLineupRevisionId
        ? this.#loadLineupRevision(leagueId, teamId, revision.basedOnLineupRevisionId)
        : Promise.resolve(null),
    ])
    return {
      basedOnRevision,
      revision,
      history: history.map(summary),
      issues: [
        ...validateTeamLineupRevision(revision),
        ...validateSluggersLineup(revision.lineup),
      ],
      teamName: team.name,
    }
  }

  async updateTeamLineupDraft(
    identity: SessionIdentity | null,
    leagueId: string,
    teamId: string,
    revisionId: string,
    input: { rosterCharacterIds: string[]; lineup: TeamLineupRevision['lineup'] },
  ): Promise<TeamLineupRevision> {
    await this.#requireTeamAdmin(identity, leagueId, teamId)
    let current = await this.#loadLineupRevision(leagueId, teamId, revisionId)
    if (!current) throw new PlatformError('Lineup revision was not found', 'not_found')
    let revision = TeamLineupRevisionSchema.parse({ ...current, ...input })
    await this.database.transaction(async (transaction) => {
      let roster = await transaction
        .update(rosterRevisions)
        .set({ rosterCharacterIds: revision.rosterCharacterIds })
        .where(and(eq(rosterRevisions.id, revision.rosterRevisionId), eq(rosterRevisions.status, 'draft')))
        .returning({ id: rosterRevisions.id })
      let lineup = await transaction
        .update(lineupRevisions)
        .set({ lineup: revision.lineup })
        .where(and(eq(lineupRevisions.id, revisionId), eq(lineupRevisions.status, 'draft')))
        .returning({ id: lineupRevisions.id })
      if (!roster.length || !lineup.length) {
        throw new PlatformError('Published lineups cannot be edited', 'conflict')
      }
    })
    return revision
  }

  async publishTeamLineup(identity: SessionIdentity | null, leagueId: string, teamId: string, revisionId: string): Promise<TeamLineupRevision> {
    await this.#requireTeamAdmin(identity, leagueId, teamId)
    let revision = await this.#loadLineupRevision(leagueId, teamId, revisionId)
    if (!revision) throw new PlatformError('Lineup revision was not found', 'not_found')
    let issues = [
      ...validateTeamLineupRevision(revision),
      ...validateSluggersLineup(revision.lineup),
    ]
    if (issues.length) throw new PlatformError(`Lineup is invalid: ${issues.join(', ')}`, 'invalid_input')
    let now = this.#clock()
    await this.database.transaction(async (transaction) => {
      let roster = await transaction.update(rosterRevisions).set({ publishedAt: now, status: 'published' }).where(and(eq(rosterRevisions.id, revision.rosterRevisionId), eq(rosterRevisions.status, 'draft'))).returning({ id: rosterRevisions.id })
      let lineup = await transaction.update(lineupRevisions).set({ publishedAt: now, status: 'published' }).where(and(eq(lineupRevisions.id, revisionId), eq(lineupRevisions.status, 'draft'))).returning({ id: lineupRevisions.id })
      if (!roster.length || !lineup.length) throw new PlatformError('Lineup is already published', 'conflict')
      await audit(transaction, identity!.personId, leagueId, 'lineup.published', revisionId)
    })
    return { ...revision, publishedAt: now.toISOString(), status: 'published' }
  }

  async cloneTeamLineupRevision(
    identity: SessionIdentity | null,
    leagueId: string,
    teamId: string,
    revisionId: string,
  ): Promise<TeamLineupRevision> {
    await this.#requireTeamAdmin(identity, leagueId, teamId)
    let source = await this.#loadLineupRevision(leagueId, teamId, revisionId)
    if (!source) throw new PlatformError('Lineup revision was not found', 'not_found')
    if (source.status !== 'published') {
      throw new PlatformError('Only a published lineup can start a new revision', 'conflict')
    }
    let [rosterLatest] = await this.database.select({ value: max(rosterRevisions.revisionNumber) }).from(rosterRevisions).where(and(eq(rosterRevisions.leagueId, leagueId), eq(rosterRevisions.teamId, teamId)))
    let [lineupLatest] = await this.database.select({ value: max(lineupRevisions.revisionNumber) }).from(lineupRevisions).where(and(eq(lineupRevisions.leagueId, leagueId), eq(lineupRevisions.teamId, teamId)))
    let now = this.#clock()
    let revision = TeamLineupRevisionSchema.parse({
      ...source,
      basedOnLineupRevisionId: source.lineupRevisionId,
      createdAt: now.toISOString(),
      lineupRevisionId: this.#createId(),
      lineupRevisionNumber: (lineupLatest?.value ?? 0) + 1,
      publishedAt: null,
      rosterRevisionId: this.#createId(),
      rosterRevisionNumber: (rosterLatest?.value ?? 0) + 1,
      status: 'draft',
    })
    await this.database.transaction(async (transaction) => {
      await transaction.insert(rosterRevisions).values({
        basedOnRevisionId: source.rosterRevisionId,
        createdAt: now,
        createdByPersonId: identity!.personId,
        id: revision.rosterRevisionId,
        leagueId,
        revisionNumber: revision.rosterRevisionNumber,
        rosterCharacterIds: revision.rosterCharacterIds,
        teamId,
      })
      await transaction.insert(lineupRevisions).values({
        basedOnRevisionId: source.lineupRevisionId,
        createdAt: now,
        createdByPersonId: identity!.personId,
        id: revision.lineupRevisionId,
        leagueId,
        lineup: revision.lineup,
        revisionNumber: revision.lineupRevisionNumber,
        rosterRevisionId: revision.rosterRevisionId,
        teamId,
      })
      await audit(transaction, identity!.personId, leagueId, 'lineup.revision.cloned', revision.lineupRevisionId)
    })
    return revision
  }

  async createMatchLineupOverride(
    identity: SessionIdentity | null,
    leagueId: string,
    teamId: string,
    input: {
      baseLineupRevisionId: string
      effectiveLineup: TeamLineupRevision['lineup']
      matchId: string
    },
  ): Promise<MatchLineupOverride> {
    await this.#requireTeamAdmin(identity, leagueId, teamId)
    let base = await this.#loadLineupRevision(leagueId, teamId, input.baseLineupRevisionId)
    if (!base) throw new PlatformError('Base lineup revision was not found', 'not_found')
    if (base.status !== 'published') {
      throw new PlatformError('A match override requires a published lineup', 'conflict')
    }
    let issues = [
      ...validateTeamLineupRevision({ ...base, lineup: input.effectiveLineup }),
      ...validateSluggersLineup(input.effectiveLineup),
    ]
    if (issues.length) {
      throw new PlatformError(`Match lineup is invalid: ${issues.join(', ')}`, 'invalid_input')
    }
    let now = this.#clock()
    let override = MatchLineupOverrideSchema.parse({
      kind: 'match-lineup-override',
      baseLineupRevisionId: input.baseLineupRevisionId,
      createdAt: now.toISOString(),
      effectiveLineup: input.effectiveLineup,
      leagueId,
      matchId: input.matchId,
      overrideId: this.#createId(),
      teamId,
    })
    await this.database.transaction(async (transaction) => {
      await transaction.insert(matchLineupOverrides).values({
        baseLineupRevisionId: override.baseLineupRevisionId,
        createdAt: now,
        createdByPersonId: identity!.personId,
        effectiveLineup: override.effectiveLineup,
        id: override.overrideId,
        leagueId,
        matchId: override.matchId,
        teamId,
      })
      await audit(transaction, identity!.personId, leagueId, 'lineup.match_override.created', override.overrideId)
    })
    return override
  }

  async compilePublishedConfiguration(input: {
    identity: SessionIdentity | null
    leagueId: string
    statProfileRevisionId: string
    rulesetRevisionId: string
    teamId: string
    lineupRevisionId: string
    adapterVersion: string
  }): Promise<AdapterOperationBundle> {
    await this.#requireTeamAdmin(input.identity, input.leagueId, input.teamId)
    let [profile, ruleset, lineup] = await Promise.all([
      this.#loadStatRevision(input.leagueId, input.statProfileRevisionId),
      this.#loadRulesetRevision(input.leagueId, input.rulesetRevisionId),
      this.#loadLineupRevision(input.leagueId, input.teamId, input.lineupRevisionId),
    ])
    if (!profile || !ruleset || !lineup) throw new PlatformError('Published configuration was not found', 'not_found')
    let lineupIssues = validateSluggersLineup(lineup.lineup)
    if (lineupIssues.length) {
      throw new PlatformError(`Published lineup is not supported by the Sluggers runner: ${lineupIssues.join(', ')}`, 'conflict')
    }
    return compileAdapterOperations({
      adapterVersion: input.adapterVersion,
      generatedAt: this.#clock().toISOString(),
      lineup,
      profile,
      ruleset,
    })
  }

  async #loadStatRevision(leagueId: string, revisionId: string): Promise<StatProfileRevision | null> {
    let [row] = await this.database.select().from(statProfileRevisions).where(and(eq(statProfileRevisions.leagueId, leagueId), eq(statProfileRevisions.id, revisionId))).limit(1)
    return row ? StatProfileRevisionSchema.parse({ kind: 'stat-profile-revision', leagueId: row.leagueId, profileId: row.profileId, revisionId: row.id, revisionNumber: row.revisionNumber, status: row.status, name: row.name, definitions: row.definitions, characterValues: row.characterValues, sluggersTuning: row.sluggersTuning ?? undefined, basedOnRevisionId: row.basedOnRevisionId, createdAt: row.createdAt.toISOString(), publishedAt: row.publishedAt?.toISOString() ?? null }) : null
  }

  async #loadRulesetRevision(leagueId: string, revisionId: string): Promise<RulesetRevision | null> {
    let [row] = await this.database.select().from(rulesetRevisions).where(and(eq(rulesetRevisions.leagueId, leagueId), eq(rulesetRevisions.id, revisionId))).limit(1)
    return row ? RulesetRevisionSchema.parse({ kind: 'ruleset-revision', leagueId: row.leagueId, rulesetId: row.rulesetId, revisionId: row.id, revisionNumber: row.revisionNumber, status: row.status, name: row.name, settings: row.settings, basedOnRevisionId: row.basedOnRevisionId, createdAt: row.createdAt.toISOString(), publishedAt: row.publishedAt?.toISOString() ?? null }) : null
  }

  async #loadLineupRevision(leagueId: string, teamId: string, revisionId: string): Promise<TeamLineupRevision | null> {
    let [row] = await this.database.select({ lineup: lineupRevisions, roster: rosterRevisions }).from(lineupRevisions).innerJoin(rosterRevisions, and(eq(rosterRevisions.leagueId, lineupRevisions.leagueId), eq(rosterRevisions.teamId, lineupRevisions.teamId), eq(rosterRevisions.id, lineupRevisions.rosterRevisionId))).where(and(eq(lineupRevisions.leagueId, leagueId), eq(lineupRevisions.teamId, teamId), eq(lineupRevisions.id, revisionId))).limit(1)
    return row ? TeamLineupRevisionSchema.parse({ kind: 'team-lineup-revision', leagueId: row.lineup.leagueId, teamId: row.lineup.teamId, rosterRevisionId: row.roster.id, rosterRevisionNumber: row.roster.revisionNumber, lineupRevisionId: row.lineup.id, lineupRevisionNumber: row.lineup.revisionNumber, status: row.lineup.status, rosterCharacterIds: row.roster.rosterCharacterIds, lineup: row.lineup.lineup, basedOnLineupRevisionId: row.lineup.basedOnRevisionId, createdAt: row.lineup.createdAt.toISOString(), publishedAt: row.lineup.publishedAt?.toISOString() ?? null }) : null
  }

  #requireLeagueAdmin(identity: SessionIdentity | null, leagueId: string): asserts identity is SessionIdentity {
    if (!identity) throw new PlatformError('Sign in is required', 'unauthorized')
    let membership = identity.memberships.find((candidate) => candidate.leagueId === leagueId)
    if (!identity.isSiteAdmin && !membership?.roles.some((role) => administrativeRoles.has(role))) throw new PlatformError('League administrator access is required', 'forbidden')
  }

  async #requireTeamAdmin(identity: SessionIdentity | null, leagueId: string, teamId: string): Promise<void> {
    if (!identity) throw new PlatformError('Sign in is required', 'unauthorized')
    let membership = identity.memberships.find((candidate) => candidate.leagueId === leagueId)
    if (identity.isSiteAdmin || membership?.roles.some((role) => administrativeRoles.has(role))) return
    let [team] = await this.database.select({ managerPersonId: leagueTeams.managerPersonId }).from(leagueTeams).where(and(eq(leagueTeams.leagueId, leagueId), eq(leagueTeams.id, teamId))).limit(1)
    if (team?.managerPersonId !== identity.personId) throw new PlatformError('Team manager access is required', 'forbidden')
  }
}

function summary(row: { id: string; revisionNumber: number; status: 'draft' | 'published'; createdAt: Date; publishedAt: Date | null }): RevisionSummary {
  return { id: row.id, revisionNumber: row.revisionNumber, status: row.status, createdAt: row.createdAt, publishedAt: row.publishedAt }
}

type ConfigurationTransaction = Parameters<Parameters<StarworksDatabase['transaction']>[0]>[0]

async function audit(transaction: ConfigurationTransaction, actorPersonId: string, leagueId: string, action: string, targetId: string): Promise<void> {
  await transaction.insert(auditRecords).values({ action, actorPersonId, leagueId, targetId, targetType: 'configuration_revision' })
}
