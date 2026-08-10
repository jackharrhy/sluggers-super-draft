import { randomUUID } from 'node:crypto'

import { and, eq, max } from 'drizzle-orm'
import { z } from 'zod'

import { Sha256Schema, TeamLineupRevisionSchema } from '@starworks/contracts'

import type { StarworksDatabase } from '../platform/database/connection.ts'
import {
  attemptLifecycleEvents,
  auditRecords,
  leagueTeams,
  lineupRevisions,
  matches,
  matchAttempts,
  rosterRevisions,
  rulesetRevisions,
  runnerCredentials,
  runnerLeases,
  runnerStations,
  seasons,
  statProfileRevisions,
} from '../platform/database/schema.ts'
import { PlatformError } from '../platform/errors.ts'
import type { SessionIdentity } from '../platform/model.ts'
import { administrativeRoles } from '../platform/repository.ts'
import { createOpaqueToken } from '../platform/security.ts'

const ScheduleMatchSchema = z.strictObject({
  awayTeamId: z.uuid(),
  homeTeamId: z.uuid(),
  scheduledAt: z.date().nullable(),
  seasonId: z.uuid(),
})

const QueueAttemptSchema = z.strictObject({
  awayLineupRevisionId: z.uuid(),
  dynamicRuleOverrides: z.record(z.string().min(1), z.union([z.string(), z.number().finite(), z.boolean(), z.null()])),
  homeLineupRevisionId: z.uuid(),
  requiredGameBuildSha256: Sha256Schema,
  rulesetRevisionId: z.uuid(),
  statProfileRevisionId: z.uuid(),
})

export interface RunnerAdminServiceOptions {
  clock?: () => Date
  createId?: () => string
  createNonce?: () => string
}

export interface RunnerOperationsDashboard {
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
  matches: Array<{
    id: string
    status: string
    scheduledAt: Date | null
    homeTeamName: string
    awayTeamName: string
    homeTeamId: string
    awayTeamId: string
    attempts: Array<{ id: string; attemptNumber: number; status: string; failureKind: string | null }>
  }>
  stations: Array<{
    id: string
    name: string
    status: string
    runtimeState: string
    lastHeartbeatAt: Date | null
    capabilities: unknown
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
  readonly #createId: () => string
  readonly #createNonce: () => string

  constructor(
    readonly database: StarworksDatabase,
    options: RunnerAdminServiceOptions = {},
  ) {
    this.#clock = options.clock ?? (() => new Date())
    this.#createId = options.createId ?? randomUUID
    this.#createNonce = options.createNonce ?? createOpaqueToken
  }

  async dashboard(
    identity: SessionIdentity | null,
    leagueId: string,
  ): Promise<RunnerOperationsDashboard> {
    this.#requireAdmin(identity, leagueId)
    let [seasonRows, teamRows, lineupRows, profileRows, rulesetRows, matchRows, attemptRows, stationRows] = await Promise.all([
      this.database.select({ id: seasons.id, name: seasons.name }).from(seasons).where(eq(seasons.leagueId, leagueId)),
      this.database.select({ id: leagueTeams.id, name: leagueTeams.name, seasonId: leagueTeams.seasonId }).from(leagueTeams).where(eq(leagueTeams.leagueId, leagueId)),
      this.database.select({ id: lineupRevisions.id, revisionNumber: lineupRevisions.revisionNumber, teamId: lineupRevisions.teamId }).from(lineupRevisions).where(and(eq(lineupRevisions.leagueId, leagueId), eq(lineupRevisions.status, 'published'))),
      this.database.select({ id: statProfileRevisions.id, name: statProfileRevisions.name, revisionNumber: statProfileRevisions.revisionNumber }).from(statProfileRevisions).where(and(eq(statProfileRevisions.leagueId, leagueId), eq(statProfileRevisions.status, 'published'))),
      this.database.select({ id: rulesetRevisions.id, name: rulesetRevisions.name, revisionNumber: rulesetRevisions.revisionNumber }).from(rulesetRevisions).where(and(eq(rulesetRevisions.leagueId, leagueId), eq(rulesetRevisions.status, 'published'))),
      this.database.select().from(matches).where(eq(matches.leagueId, leagueId)),
      this.database.select({ attemptNumber: matchAttempts.attemptNumber, failureKind: matchAttempts.failureKind, id: matchAttempts.id, matchId: matchAttempts.matchId, status: matchAttempts.status }).from(matchAttempts).where(eq(matchAttempts.leagueId, leagueId)),
      this.database.select().from(runnerStations).where(eq(runnerStations.leagueId, leagueId)),
    ])
    let teamNames = new Map(teamRows.map((team) => [team.id, team.name]))
    return {
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
        .select({ id: statProfileRevisions.id })
        .from(statProfileRevisions)
        .where(and(
          eq(statProfileRevisions.leagueId, leagueId),
          eq(statProfileRevisions.id, parsed.data.statProfileRevisionId),
          eq(statProfileRevisions.status, 'published'),
        ))
        .limit(1),
      this.database
        .select({ id: rulesetRevisions.id, settings: rulesetRevisions.settings })
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
    for (let [key, value] of Object.entries(parsed.data.dynamicRuleOverrides)) {
      let setting = ruleset.settings.find((candidate) => candidate.key === key)
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
        createdAt: now,
        createdByPersonId: identity!.personId,
        dynamicRuleOverrides: parsed.data.dynamicRuleOverrides,
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
        let [attempt] = await transaction
          .update(matchAttempts)
          .set({ failedAt: now, failureKind: 'runner-crash', status: 'failed' })
          .where(and(eq(matchAttempts.leagueId, leagueId), eq(matchAttempts.id, lease.attemptId)))
          .returning({ matchId: matchAttempts.matchId })
        if (attempt) {
          await transaction
            .update(matches)
            .set({ status: 'scheduled', updatedAt: now })
            .where(and(eq(matches.leagueId, leagueId), eq(matches.id, attempt.matchId)))
        }
        await transaction.insert(attemptLifecycleEvents).values({
          eventType: 'station-revoked',
          failureKind: 'runner-crash',
          leagueId,
          matchAttemptId: lease.attemptId,
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
    return TeamLineupRevisionSchema.parse({
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
  }

  #requireAdmin(identity: SessionIdentity | null, leagueId: string): asserts identity is SessionIdentity {
    if (!identity) throw new PlatformError('Sign in is required', 'unauthorized')
    let membership = identity.memberships.find((candidate) => candidate.leagueId === leagueId)
    if (!identity.isSiteAdmin && !membership?.roles.some((role) => administrativeRoles.has(role))) {
      throw new PlatformError('League administrator access is required', 'forbidden')
    }
  }
}

function sameJsonScalarType(left: string | number | boolean | null, right: string | number | boolean | null): boolean {
  return left === null ? right === null : right !== null && typeof left === typeof right
}
