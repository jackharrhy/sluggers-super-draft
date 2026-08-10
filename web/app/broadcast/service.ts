import {
  BroadcastOverlaySchema,
  TelemetryEnvelopeSchema,
  type BroadcastOverlay,
  type TelemetryEnvelope,
} from '@starworks/contracts'
import { and, asc, desc, eq, inArray } from 'drizzle-orm'

import type { StarworksDatabase } from '../platform/database/connection.ts'
import {
  leagueTeams,
  leagues,
  matches,
  matchAttempts,
  publicationSettings,
  rosterRevisions,
  telemetryCorrections,
  telemetryEvents,
} from '../platform/database/schema.ts'
import { PlatformError } from '../platform/errors.ts'
import { deriveTelemetry } from '../telemetry/derive.ts'
import type { MatchBoxScore } from '../telemetry/model.ts'

export interface BroadcastApplication {
  publicOverlay(leagueSlug: string, matchId: string): Promise<BroadcastOverlay>
}

export class BroadcastService implements BroadcastApplication {
  constructor(
    readonly database: StarworksDatabase,
    readonly clock: () => Date = () => new Date(),
  ) {}

  async publicOverlay(leagueSlug: string, matchId: string): Promise<BroadcastOverlay> {
    let [league] = await this.database.select({
      id: leagues.id,
      name: leagues.name,
      slug: leagues.slug,
    }).from(leagues).innerJoin(publicationSettings, eq(publicationSettings.leagueId, leagues.id)).where(and(
      eq(leagues.slug, leagueSlug),
      eq(leagues.status, 'active'),
      eq(publicationSettings.leagueVisible, true),
      eq(publicationSettings.statsVisible, true),
    )).limit(1)
    if (!league) throw new PlatformError('Broadcast overlay is not public', 'not_found')
    let [match] = await this.database.select().from(matches).where(and(
      eq(matches.leagueId, league.id),
      eq(matches.id, matchId),
    )).limit(1)
    if (!match) throw new PlatformError('Broadcast match was not found', 'not_found')
    let teamRows = await this.database.select({ id: leagueTeams.id, name: leagueTeams.name }).from(leagueTeams).where(and(
      eq(leagueTeams.leagueId, league.id),
      inArray(leagueTeams.id, [match.awayTeamId, match.homeTeamId]),
    ))
    let teamNames = new Map(teamRows.map((team) => [team.id, team.name]))
    let [attempt] = await this.database.select().from(matchAttempts).where(and(
      eq(matchAttempts.leagueId, league.id),
      eq(matchAttempts.matchId, match.id),
    )).orderBy(desc(matchAttempts.attemptNumber)).limit(1)

    let score = emptyScore(match.homeTeamId, match.awayTeamId)
    let inning: number | null = null
    let half: 'top' | 'bottom' | null = null
    let recentEvents: BroadcastOverlay['recentEvents'] = []
    if (attempt) {
      let [eventRows, correctionRows, rosterRows] = await Promise.all([
        this.database.select().from(telemetryEvents).where(and(
          eq(telemetryEvents.leagueId, league.id),
          eq(telemetryEvents.matchAttemptId, attempt.id),
        )).orderBy(asc(telemetryEvents.sequence)),
        this.database.select().from(telemetryCorrections).where(and(
          eq(telemetryCorrections.leagueId, league.id),
          eq(telemetryCorrections.matchAttemptId, attempt.id),
        )).orderBy(asc(telemetryCorrections.createdAt), asc(telemetryCorrections.id)),
        this.database.select().from(rosterRevisions).where(and(
          eq(rosterRevisions.leagueId, league.id),
          inArray(rosterRevisions.id, [attempt.homeRosterRevisionId, attempt.awayRosterRevisionId]),
        )),
      ])
      let eventRecords = eventRows.map((event) => ({
        envelope: TelemetryEnvelopeSchema.parse({
          adapterVersion: event.adapterVersion,
          attemptId: event.matchAttemptId,
          attemptNonce: attempt.attemptNonce,
          correlationId: event.correlationId,
          eventType: event.eventType,
          frame: event.frame,
          gameBuildSha256: event.gameBuildSha256,
          kind: 'telemetry-envelope',
          leagueId: event.leagueId,
          matchId: event.matchId,
          observationSource: event.observationSource,
          payload: event.payload,
          protocolVersion: event.protocolVersion,
          schemaVersion: 1,
          sequence: event.sequence,
          stateFingerprint: event.stateFingerprint ?? undefined,
        }) satisfies TelemetryEnvelope,
        receivedAt: event.receivedAt,
      }))
      let events = eventRecords.map((record) => record.envelope)
      if (events.length) {
        let rosters = new Map(rosterRows.map((roster) => [roster.id, roster.rosterCharacterIds]))
        score = deriveTelemetry(events, correctionRows, {
          awayCharacterIds: rosters.get(attempt.awayRosterRevisionId) ?? [],
          awayTeamId: match.awayTeamId,
          homeCharacterIds: rosters.get(attempt.homeRosterRevisionId) ?? [],
          homeTeamId: match.homeTeamId,
        }).boxScore
      }
      let latestInning = [...events].reverse().find((event) => event.eventType === 'inning-started')
      if (latestInning) {
        inning = typeof latestInning.payload.inning === 'number' ? latestInning.payload.inning : null
        half = latestInning.payload.half === 'top' || latestInning.payload.half === 'bottom'
          ? latestInning.payload.half
          : null
      }
      recentEvents = eventRecords.slice(-10).reverse().map(({ envelope, receivedAt }) => ({
        eventType: envelope.eventType,
        frame: envelope.frame,
        payload: scalarPayload(envelope.payload),
        receivedAt: receivedAt.toISOString(),
        sequence: envelope.sequence,
      }))
    }

    return BroadcastOverlaySchema.parse({
      half,
      inning,
      kind: 'broadcast-overlay',
      league,
      match: {
        attemptId: attempt?.id ?? null,
        attemptNumber: attempt?.attemptNumber ?? null,
        id: match.id,
        status: match.status,
      },
      players: Object.entries(score.characters).map(([characterId, statistics]) => ({
        characterId,
        hits: statistics.batting.hits,
        homeRuns: statistics.batting.homeRuns,
        runs: statistics.running.runs,
        runsBattedIn: statistics.batting.runsBattedIn,
        strikeouts: statistics.batting.strikeouts,
        teamId: statistics.teamId,
      })).sort((left, right) => right.hits - left.hits || left.characterId.localeCompare(right.characterId)),
      recentEvents,
      schemaVersion: 1,
      teams: [
        {
          errors: score.teams.away.errors,
          hits: score.teams.away.hits,
          name: teamNames.get(match.awayTeamId) ?? 'Away',
          runs: score.teams.away.runs,
          side: 'away',
          teamId: score.teams.away.teamId,
        },
        {
          errors: score.teams.home.errors,
          hits: score.teams.home.hits,
          name: teamNames.get(match.homeTeamId) ?? 'Home',
          runs: score.teams.home.runs,
          side: 'home',
          teamId: score.teams.home.teamId,
        },
      ],
      updatedAt: this.clock().toISOString(),
    })
  }
}

function emptyScore(homeTeamId: string, awayTeamId: string): MatchBoxScore {
  return {
    characters: {},
    derivationVersion: 1 as const,
    endedReason: null,
    innings: 0,
    teams: {
      away: { errors: 0, hits: 0, lineScore: {}, runs: 0, teamId: awayTeamId },
      home: { errors: 0, hits: 0, lineScore: {}, runs: 0, teamId: homeTeamId },
    },
  }
}

function scalarPayload(payload: Record<string, unknown>): Record<string, string | number | boolean | null> {
  return Object.fromEntries(Object.entries(payload).filter((entry): entry is [string, string | number | boolean | null] => (
    entry[1] === null || ['string', 'number', 'boolean'].includes(typeof entry[1])
  )))
}
