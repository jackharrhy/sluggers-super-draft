import { randomUUID } from 'node:crypto'

import { and, desc, eq, max } from 'drizzle-orm'
import { z } from 'zod'

import {
  RulesetRevisionSchema,
  Sha256Schema,
  StatProfileRevisionSchema,
  TeamLineupRevisionSchema,
} from '@starworks/contracts'

import type { StarworksDatabase } from '../platform/database/connection.ts'
import {
  attemptLifecycleEvents,
  auditRecords,
  contentPacks,
  contentPackRevisions,
  leagueTeams,
  lineupRevisions,
  matches,
  matchAttempts,
  people,
  rosterRevisions,
  rulesetRevisions,
  runnerCredentials,
  runnerLeases,
  runnerStations,
  seasons,
  statProfileRevisions,
  venues,
} from '../platform/database/schema.ts'
import { PlatformError } from '../platform/errors.ts'
import type { SessionIdentity } from '../platform/model.ts'
import { runnerOperationRoles } from '../platform/repository.ts'
import { createOpaqueToken } from '../platform/security.ts'
import { SLUGGERS_ADAPTER_VERSION } from './adapter-version.ts'
import { failAttemptWithRecovery } from './recovery.ts'

const ScheduleMatchSchema = z.strictObject({
  awayTeamId: z.uuid(),
  homeTeamId: z.uuid(),
  scheduledAt: z.date().nullable(),
  seasonId: z.uuid(),
  venueId: z.uuid().nullable().default(null),
})

const QueueAttemptSchema = z.strictObject({
  awayLineupRevisionId: z.uuid(),
  contentPackRevisionId: z.uuid().nullable().default(null),
  dynamicRuleOverrides: z.record(z.string().min(1), z.union([z.string(), z.number().finite(), z.boolean(), z.null()])),
  homeLineupRevisionId: z.uuid(),
  executionMode: z.literal('cpu-vs-cpu').default('cpu-vs-cpu'),
  gameStadiumId: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/).default('mario-stadium'),
  requiredGameBuildSha256: Sha256Schema,
  rulesetRevisionId: z.uuid(),
  statProfileRevisionId: z.uuid(),
})

export interface RunnerAdminServiceOptions {
  adapterVersion?: string
  clock?: () => Date
  createId?: () => string
  createNonce?: () => string
}

export interface RunnerOperationsDashboard {
  audit: Array<{
    action: string
    actorDisplayName: string | null
    metadata: Record<string, unknown>
    occurredAt: Date
    targetId: string
    targetType: string
  }>
  seasons: Array<{
    id: string
    name: string
    teams: Array<{
      id: string
      name: string
      lineups: Array<{ id: string; revisionNumber: number }>
    }>
  }>
  statProfiles: Array<{ id: string; name: string; revisionNumber: number }>
  rulesets: Array<{ id: string; name: string; revisionNumber: number }>
  contentPacks: Array<{ id: string; name: string; revisionNumber: number; rulesetRevisionId: string; statProfileRevisionId: string }>
  venues: Array<{ gameVenueId: string | null; id: string; name: string }>
  matches: Array<{
    id: string
    status: string
    scheduledAt: Date | null
    homeTeamName: string
    awayTeamName: string
    homeTeamId: string
    awayTeamId: string
    attempts: Array<{
      id: string
      attemptNumber: number
      status: string
      failureKind: string | null
      requiredGameBuildSha256: string
    }>
  }>
  stations: Array<{
    id: string
    name: string
    status: string
    runtimeState: string
    lastHeartbeatAt: Date | null
    capabilities: unknown
    componentHealth: Record<string, string>
  }>
}

export interface RunnerAdminApplication {
  dashboard(identity: SessionIdentity | null, leagueId: string): Promise<RunnerOperationsDashboard>
  scheduleMatch: RunnerAdminService['scheduleMatch']
  queueAttempt: RunnerAdminService['queueAttempt']
  revokeStation: RunnerAdminService['revokeStation']
}

export class RunnerAdminService {
  readonly #clock: () => Date
  readonly #adapterVersion: string
  readonly #createId: () => string
  readonly #createNonce: () => string

  constructor(
    readonly database: StarworksDatabase,
    options: RunnerAdminServiceOptions = {},
  ) {
    this.#clock = options.clock ?? (() => new Date())
    this.#adapterVersion = options.adapterVersion ?? SLUGGERS_ADAPTER_VERSION
    this.#createId = options.createId ?? randomUUID
    this.#createNonce = options.createNonce ?? createOpaqueToken
  }

  async dashboard(
    identity: SessionIdentity | null,
    leagueId: string,
  ): Promise<RunnerOperationsDashboard> {
    this.#requireAdmin(identity, leagueId)
    let [seasonRows, teamRows, lineupRows, profileRows, rulesetRows, contentPackRows, venueRows, matchRows, attemptRows, stationRows, auditRows] = await Promise.all([
      this.database.select({ id: seasons.id, name: seasons.name }).from(seasons).where(eq(seasons.leagueId, leagueId)),
      this.database.select({ id: leagueTeams.id, name: leagueTeams.name, seasonId: leagueTeams.seasonId }).from(leagueTeams).where(eq(leagueTeams.leagueId, leagueId)),
      this.database.select({ id: lineupRevisions.id, revisionNumber: lineupRevisions.revisionNumber, teamId: lineupRevisions.teamId }).from(lineupRevisions).where(and(eq(lineupRevisions.leagueId, leagueId), eq(lineupRevisions.status, 'published'))),
      this.database.select({ id: statProfileRevisions.id, name: statProfileRevisions.name, revisionNumber: statProfileRevisions.revisionNumber }).from(statProfileRevisions).where(and(eq(statProfileRevisions.leagueId, leagueId), eq(statProfileRevisions.status, 'published'))),
      this.database.select({ id: rulesetRevisions.id, name: rulesetRevisions.name, revisionNumber: rulesetRevisions.revisionNumber }).from(rulesetRevisions).where(and(eq(rulesetRevisions.leagueId, leagueId), eq(rulesetRevisions.status, 'published'))),
      this.database.select({ id: contentPackRevisions.id, name: contentPacks.name, revisionNumber: contentPackRevisions.revisionNumber, rulesetRevisionId: contentPackRevisions.rulesetRevisionId, statProfileRevisionId: contentPackRevisions.statProfileRevisionId }).from(contentPackRevisions).innerJoin(contentPacks, and(eq(contentPacks.leagueId, contentPackRevisions.leagueId), eq(contentPacks.id, contentPackRevisions.contentPackId))).where(and(eq(contentPackRevisions.leagueId, leagueId), eq(contentPackRevisions.status, 'published'))),
      this.database.select({ gameVenueId: venues.gameVenueId, id: venues.id, name: venues.name }).from(venues).where(eq(venues.leagueId, leagueId)),
      this.database.select().from(matches).where(eq(matches.leagueId, leagueId)),
      this.database.select({
        attemptNumber: matchAttempts.attemptNumber,
        failureKind: matchAttempts.failureKind,
        id: matchAttempts.id,
        matchId: matchAttempts.matchId,
        requiredGameBuildSha256: matchAttempts.requiredGameBuildSha256,
        status: matchAttempts.status,
      }).from(matchAttempts).where(eq(matchAttempts.leagueId, leagueId)),
      this.database.select().from(runnerStations).where(eq(runnerStations.leagueId, leagueId)),
      this.database
        .select({
          action: auditRecords.action,
          actorDisplayName: people.displayName,
          metadata: auditRecords.metadata,
          occurredAt: auditRecords.occurredAt,
          targetId: auditRecords.targetId,
          targetType: auditRecords.targetType,
        })
        .from(auditRecords)
        .leftJoin(people, eq(people.id, auditRecords.actorPersonId))
        .where(eq(auditRecords.leagueId, leagueId))
        .orderBy(desc(auditRecords.occurredAt), desc(auditRecords.id))
        .limit(100),
    ])
    let teamNames = new Map(teamRows.map((team) => [team.id, team.name]))
    return {
      audit: auditRows,
      contentPacks: contentPackRows,
      seasons: seasonRows.map((season) => ({
        ...season,
        teams: teamRows.filter((team) => team.seasonId === season.id).map((team) => ({
          id: team.id,
          lineups: lineupRows.filter((lineup) => lineup.teamId === team.id).map((lineup) => ({ id: lineup.id, revisionNumber: lineup.revisionNumber })),
          name: team.name,
        })),
      })),
      statProfiles: profileRows,
      rulesets: rulesetRows,
      venues: venueRows,
      matches: matchRows.map((match) => ({
        attempts: attemptRows.filter((attempt) => attempt.matchId === match.id).map(({ matchId: _, ...attempt }) => attempt),
        awayTeamName: teamNames.get(match.awayTeamId) ?? 'Unknown team',
        awayTeamId: match.awayTeamId,
        homeTeamName: teamNames.get(match.homeTeamId) ?? 'Unknown team',
        homeTeamId: match.homeTeamId,
        id: match.id,
        scheduledAt: match.scheduledAt,
        status: match.status,
      })),
      stations: stationRows.map((station) => ({
        capabilities: station.capabilities,
        componentHealth: station.componentHealth,
        id: station.id,
        lastHeartbeatAt: station.lastHeartbeatAt,
        name: station.name,
        runtimeState: station.runtimeState,
        status: station.status,
      })),
    }
  }

  async scheduleMatch(
    identity: SessionIdentity | null,
    leagueId: string,
    input: z.input<typeof ScheduleMatchSchema>,
  ): Promise<{ id: string }> {
    this.#requireAdmin(identity, leagueId)
    let parsed = ScheduleMatchSchema.safeParse(input)
    if (!parsed.success || parsed.data.homeTeamId === parsed.data.awayTeamId) {
      throw new PlatformError('Match schedule is invalid', 'invalid_input')
    }
    let teams = await this.database
      .select({ id: leagueTeams.id, seasonId: leagueTeams.seasonId })
      .from(leagueTeams)
      .where(eq(leagueTeams.leagueId, leagueId))
    let selected = teams.filter((team) => team.id === parsed.data.homeTeamId || team.id === parsed.data.awayTeamId)
    if (selected.length !== 2 || selected.some((team) => team.seasonId !== parsed.data.seasonId)) {
      throw new PlatformError('Both match teams must belong to the selected league season', 'invalid_input')
    }
    if (parsed.data.venueId) {
      let [venue] = await this.database
        .select({ id: venues.id })
        .from(venues)
        .where(and(eq(venues.leagueId, leagueId), eq(venues.id, parsed.data.venueId)))
        .limit(1)
      if (!venue) throw new PlatformError('Match venue must belong to this league', 'invalid_input')
    }
    let matchId = this.#createId()
    await this.database.transaction(async (transaction) => {
      await transaction.insert(matches).values({
        awayTeamId: parsed.data.awayTeamId,
        createdByPersonId: identity!.personId,
        homeTeamId: parsed.data.homeTeamId,
        id: matchId,
        leagueId,
        scheduledAt: parsed.data.scheduledAt,
        seasonId: parsed.data.seasonId,
        venueId: parsed.data.venueId,
      })
      await transaction.insert(auditRecords).values({
        action: 'match.scheduled',
        actorPersonId: identity!.personId,
        leagueId,
        targetId: matchId,
        targetType: 'match',
      })
    })
    return { id: matchId }
  }

  async queueAttempt(
    identity: SessionIdentity | null,
    leagueId: string,
    matchId: string,
    input: z.input<typeof QueueAttemptSchema>,
  ): Promise<{ attemptId: string; attemptNumber: number }> {
    this.#requireAdmin(identity, leagueId)
    let parsed = QueueAttemptSchema.safeParse(input)
    if (!parsed.success) throw new PlatformError('Match attempt configuration is invalid', 'invalid_input')
    let [match] = await this.database
      .select()
      .from(matches)
      .where(and(eq(matches.leagueId, leagueId), eq(matches.id, matchId)))
      .limit(1)
    if (!match) throw new PlatformError('Match was not found', 'not_found')
    if (match.status === 'confirmed' || match.status === 'cancelled') {
      throw new PlatformError('This match cannot accept another attempt', 'conflict')
    }
    let [home, away] = await Promise.all([
      this.#loadPublishedLineup(leagueId, parsed.data.homeLineupRevisionId),
      this.#loadPublishedLineup(leagueId, parsed.data.awayLineupRevisionId),
    ])
    if (!home || home.teamId !== match.homeTeamId || !away || away.teamId !== match.awayTeamId) {
      throw new PlatformError('Attempt lineups must be published for the scheduled teams', 'invalid_input')
    }
    let [[profile], [ruleset]] = await Promise.all([
      this.database
        .select()
        .from(statProfileRevisions)
        .where(and(
          eq(statProfileRevisions.leagueId, leagueId),
          eq(statProfileRevisions.id, parsed.data.statProfileRevisionId),
          eq(statProfileRevisions.status, 'published'),
        ))
        .limit(1),
      this.database
        .select()
        .from(rulesetRevisions)
        .where(and(
          eq(rulesetRevisions.leagueId, leagueId),
          eq(rulesetRevisions.id, parsed.data.rulesetRevisionId),
          eq(rulesetRevisions.status, 'published'),
        ))
        .limit(1),
    ])
    if (!profile || !ruleset) {
      throw new PlatformError('Attempt stat profile and ruleset must be published', 'invalid_input')
    }
    let profileDocument = StatProfileRevisionSchema.safeParse({
      basedOnRevisionId: profile.basedOnRevisionId,
      characterValues: profile.characterValues,
      createdAt: profile.createdAt.toISOString(),
      definitions: profile.definitions,
      kind: 'stat-profile-revision',
      leagueId: profile.leagueId,
      name: profile.name,
      profileId: profile.profileId,
      publishedAt: profile.publishedAt?.toISOString() ?? null,
      revisionId: profile.id,
      revisionNumber: profile.revisionNumber,
      schemaVersion: 1,
      sluggersTuning: profile.sluggersTuning ?? undefined,
      status: profile.status,
    })
    let rulesetDocument = RulesetRevisionSchema.safeParse({
      basedOnRevisionId: ruleset.basedOnRevisionId,
      createdAt: ruleset.createdAt.toISOString(),
      kind: 'ruleset-revision',
      leagueId: ruleset.leagueId,
      name: ruleset.name,
      publishedAt: ruleset.publishedAt?.toISOString() ?? null,
      revisionId: ruleset.id,
      revisionNumber: ruleset.revisionNumber,
      rulesetId: ruleset.rulesetId,
      schemaVersion: 1,
      settings: ruleset.settings,
      status: ruleset.status,
    })
    if (!profileDocument.success || !rulesetDocument.success) {
      throw new PlatformError('Attempt stat profile and ruleset must be valid published revisions', 'invalid_input')
    }
    if (parsed.data.contentPackRevisionId) {
      let [contentPack] = await this.database
        .select({
          adapterVersion: contentPackRevisions.adapterVersion,
          id: contentPackRevisions.id,
          manifest: contentPackRevisions.manifest,
          rulesetRevisionId: contentPackRevisions.rulesetRevisionId,
          statProfileRevisionId: contentPackRevisions.statProfileRevisionId,
        })
        .from(contentPackRevisions)
        .where(and(
          eq(contentPackRevisions.leagueId, leagueId),
          eq(contentPackRevisions.id, parsed.data.contentPackRevisionId),
          eq(contentPackRevisions.status, 'published'),
        ))
        .limit(1)
      if (
        !contentPack
        || !contentPack.manifest
        || contentPack.adapterVersion !== this.#adapterVersion
        || contentPack.statProfileRevisionId !== parsed.data.statProfileRevisionId
        || contentPack.rulesetRevisionId !== parsed.data.rulesetRevisionId
      ) {
        throw new PlatformError('Content pack must be published for the selected adapter, stat profile, and ruleset', 'invalid_input')
      }
    }
    for (let [key, value] of Object.entries(parsed.data.dynamicRuleOverrides)) {
      let setting = rulesetDocument.data.settings.find((candidate) => candidate.key === key)
      if (!setting || setting.loadPhase !== 'runtime' || !sameJsonScalarType(setting.value, value)) {
        throw new PlatformError(`Dynamic rule override ${key} is not compatible with the published ruleset`, 'invalid_input')
      }
    }
    let attemptId = this.#createId()
    let correlationId = this.#createId()
    let now = this.#clock()
    let attemptNumber = await this.database.transaction(async (transaction) => {
      let [lockedMatch] = await transaction
        .select({ id: matches.id, status: matches.status })
        .from(matches)
        .where(and(eq(matches.leagueId, leagueId), eq(matches.id, matchId)))
        .for('update')
        .limit(1)
      if (!lockedMatch || lockedMatch.status === 'confirmed' || lockedMatch.status === 'cancelled') {
        throw new PlatformError('This match cannot accept another attempt', 'conflict')
      }
      let [latest] = await transaction
        .select({ value: max(matchAttempts.attemptNumber) })
        .from(matchAttempts)
        .where(and(eq(matchAttempts.leagueId, leagueId), eq(matchAttempts.matchId, matchId)))
      let nextAttemptNumber = (latest?.value ?? 0) + 1
      await transaction.insert(matchAttempts).values({
        attemptNonce: this.#createNonce(),
        attemptNumber: nextAttemptNumber,
        awayLineupRevisionId: away.lineupRevisionId,
        awayRosterRevisionId: away.rosterRevisionId,
        correlationId,
        contentPackRevisionId: parsed.data.contentPackRevisionId,
        createdAt: now,
        createdByPersonId: identity!.personId,
        dynamicRuleOverrides: parsed.data.dynamicRuleOverrides,
        executionMode: parsed.data.executionMode,
        gameStadiumId: parsed.data.gameStadiumId,
        homeLineupRevisionId: home.lineupRevisionId,
        homeRosterRevisionId: home.rosterRevisionId,
        id: attemptId,
        leagueId,
        matchId,
        requiredGameBuildSha256: parsed.data.requiredGameBuildSha256,
        rulesetRevisionId: parsed.data.rulesetRevisionId,
        statProfileRevisionId: parsed.data.statProfileRevisionId,
      })
      await transaction.insert(attemptLifecycleEvents).values({
        eventType: 'queued',
        leagueId,
        matchAttemptId: attemptId,
        observedAt: now,
      })
      await transaction.insert(auditRecords).values({
        action: 'match_attempt.queued',
        actorPersonId: identity!.personId,
        leagueId,
        metadata: { attemptNumber: nextAttemptNumber, matchId },
        targetId: attemptId,
        targetType: 'match_attempt',
      })
      return nextAttemptNumber
    })
    return { attemptId, attemptNumber }
  }

  async revokeStation(
    identity: SessionIdentity | null,
    leagueId: string,
    stationId: string,
  ): Promise<void> {
    this.#requireAdmin(identity, leagueId)
    let now = this.#clock()
    await this.database.transaction(async (transaction) => {
      let revoked = await transaction
        .update(runnerStations)
        .set({ revokedAt: now, status: 'revoked', updatedAt: now })
        .where(and(eq(runnerStations.leagueId, leagueId), eq(runnerStations.id, stationId), eq(runnerStations.status, 'active')))
        .returning({ id: runnerStations.id })
      if (!revoked.length) throw new PlatformError('Runner station was not found or is already revoked', 'not_found')
      await transaction
        .update(runnerCredentials)
        .set({ revokedAt: now })
        .where(and(eq(runnerCredentials.leagueId, leagueId), eq(runnerCredentials.stationId, stationId)))
      let leases = await transaction
        .update(runnerLeases)
        .set({ releasedAt: now, status: 'revoked' })
        .where(and(eq(runnerLeases.leagueId, leagueId), eq(runnerLeases.runnerStationId, stationId), eq(runnerLeases.status, 'active')))
        .returning({ attemptId: runnerLeases.matchAttemptId })
      for (let lease of leases) {
        await failAttemptWithRecovery(transaction, {
          attemptId: lease.attemptId,
          createId: this.#createId,
          createNonce: this.#createNonce,
          eventType: 'station-revoked',
          failureKind: 'runner-crash',
          leagueId,
          now,
          observedAt: now,
          runnerStationId: stationId,
        })
      }
      await transaction.insert(auditRecords).values({
        action: 'runner_station.revoked',
        actorPersonId: identity!.personId,
        leagueId,
        targetId: stationId,
        targetType: 'runner_station',
      })
    })
  }

  async #loadPublishedLineup(leagueId: string, revisionId: string) {
    let [row] = await this.database
      .select({ lineup: lineupRevisions, roster: rosterRevisions })
      .from(lineupRevisions)
      .innerJoin(rosterRevisions, and(eq(rosterRevisions.leagueId, lineupRevisions.leagueId), eq(rosterRevisions.id, lineupRevisions.rosterRevisionId)))
      .where(and(eq(lineupRevisions.leagueId, leagueId), eq(lineupRevisions.id, revisionId), eq(lineupRevisions.status, 'published'), eq(rosterRevisions.status, 'published')))
      .limit(1)
    if (!row) return null
    let parsed = TeamLineupRevisionSchema.safeParse({
      basedOnLineupRevisionId: row.lineup.basedOnRevisionId,
      createdAt: row.lineup.createdAt.toISOString(),
      kind: 'team-lineup-revision',
      leagueId,
      lineup: row.lineup.lineup,
      lineupRevisionId: row.lineup.id,
      lineupRevisionNumber: row.lineup.revisionNumber,
      publishedAt: row.lineup.publishedAt?.toISOString() ?? null,
      rosterCharacterIds: row.roster.rosterCharacterIds,
      rosterRevisionId: row.roster.id,
      rosterRevisionNumber: row.roster.revisionNumber,
      schemaVersion: 1,
      status: row.lineup.status,
      teamId: row.lineup.teamId,
    })
    return parsed.success ? parsed.data : null
  }

  #requireAdmin(identity: SessionIdentity | null, leagueId: string): asserts identity is SessionIdentity {
    if (!identity) throw new PlatformError('Sign in is required', 'unauthorized')
    let membership = identity.memberships.find((candidate) => candidate.leagueId === leagueId)
    if (!identity.isSiteAdmin && !membership?.roles.some((role) => runnerOperationRoles.has(role))) {
      throw new PlatformError('Runner operator access is required', 'forbidden')
    }
  }
}

function sameJsonScalarType(left: string | number | boolean | null, right: string | number | boolean | null): boolean {
  return left === null ? right === null : right !== null && typeof left === typeof right
}
