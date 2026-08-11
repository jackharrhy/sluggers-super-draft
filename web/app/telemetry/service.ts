import { randomUUID, timingSafeEqual } from 'node:crypto'

import { and, asc, count, desc, eq, inArray } from 'drizzle-orm'
import { z } from 'zod'

import {
  TelemetryEnvelopeSchema,
  TelemetryUploadRequestSchema,
  TelemetryUploadResponseSchema,
  parseTelemetryEventPayload,
  type TelemetryEnvelope,
  type TelemetryUploadResponse,
} from '@starworks/contracts'

import type { StarworksDatabase } from '../platform/database/connection.ts'
import {
  auditRecords,
  leagueTeams,
  matches,
  matchAttempts,
  publicationSettings,
  rosterRevisions,
  runnerCredentials,
  runnerLeases,
  seasons,
  telemetryCorrections,
  telemetryDerivations,
  telemetryEvents,
} from '../platform/database/schema.ts'
import { PlatformError } from '../platform/errors.ts'
import type { SessionIdentity } from '../platform/model.ts'
import { scoringRoles } from '../platform/repository.ts'
import { hashSecret } from '../platform/security.ts'
import { SLUGGERS_ADAPTER_VERSION } from '../runner/adapter-version.ts'
import { correctionValue, deriveTelemetry } from './derive.ts'
import type {
  MatchBoxScore,
  TelemetryCorrectionRecord,
  TelemetryDerivationResult,
  TelemetryHealth,
} from './model.ts'
import {
  rebuildSeasonStatistics,
  type LeagueOverviewSeason,
  type SeasonStatistics,
} from './statistics.ts'

const RUNNER_CREDENTIAL_PATTERN = /^starworks_runner_([0-9a-f-]{36})\.([A-Za-z0-9_-]{32,128})$/i
const CorrectionSchema = z.strictObject({
  afterValue: z.number().int().nonnegative(),
  beforeValue: z.number().int().nonnegative(),
  entityId: z.string().min(1).max(100),
  entityType: z.enum(['team', 'character']),
  reason: z.string().trim().min(3).max(500),
  statPath: z.string().regex(/^[a-z][a-zA-Z0-9.]{1,99}$/),
})

interface AttemptContext {
  attempt: typeof matchAttempts.$inferSelect
  match: typeof matches.$inferSelect
  homeCharacterIds: string[]
  awayCharacterIds: string[]
}

export interface TelemetryAttemptSummary {
  attemptId: string
  attemptNumber: number
  attemptStatus: string
  matchId: string
  seasonId: string
  matchStatus: string
  homeTeamId: string
  homeTeamName: string
  awayTeamId: string
  awayTeamName: string
  health: TelemetryHealth | null
  derivation: {
    id: string
    status: 'ready' | 'review'
    boxScore: MatchBoxScore
    inputDigest: string
    correctionCount: number
    createdAt: Date
  } | null
  corrections: TelemetryCorrectionRecord[]
}

export interface TelemetryApplication {
  ingest(bearerCredential: string, input: unknown): Promise<TelemetryUploadResponse>
  dashboard(identity: SessionIdentity | null, leagueId: string): Promise<TelemetryAttemptSummary[]>
  derive(identity: SessionIdentity | null, leagueId: string, attemptId: string): Promise<TelemetryDerivationResult>
  correct(identity: SessionIdentity | null, leagueId: string, attemptId: string, input: unknown): Promise<TelemetryDerivationResult>
  confirm(identity: SessionIdentity | null, leagueId: string, attemptId: string): Promise<void>
  finalizeHealthyAttempt(bearerCredential: string, attemptId: string): Promise<{
    leagueId: string
    matchId: string
    status: 'confirmed' | 'review'
  }>
  leagueStatistics(identity: SessionIdentity | null, leagueId: string): Promise<Array<{
    name: string
    seasonId: string
    statistics: SeasonStatistics
  }>>
  leagueOverview(identity: SessionIdentity | null, leagueId: string): Promise<LeagueOverviewSeason[]>
  rebuildSeason(identity: SessionIdentity | null, leagueId: string, seasonId: string): Promise<SeasonStatistics>
}

export class TelemetryService implements TelemetryApplication {
  readonly #clock: () => Date
  readonly #createId: () => string

  constructor(
    readonly database: StarworksDatabase,
    options: { clock?: () => Date; createId?: () => string } = {},
  ) {
    this.#clock = options.clock ?? (() => new Date())
    this.#createId = options.createId ?? randomUUID
  }

  async ingest(bearerCredential: string, input: unknown): Promise<TelemetryUploadResponse> {
    let parsed = TelemetryUploadRequestSchema.safeParse(input)
    if (!parsed.success) throw new PlatformError('Telemetry upload is invalid', 'invalid_input')
    for (let event of parsed.data.events) {
      try {
        parseTelemetryEventPayload(event.eventType, event.payload)
      } catch {
        throw new PlatformError(`Telemetry payload at sequence ${event.sequence} is invalid`, 'invalid_input')
      }
    }
    let authenticated = await this.#authenticate(bearerCredential)
    if (!authenticated.stationId || authenticated.stationId !== parsed.data.runnerId) {
      throw new PlatformError('Runner credential is not bound to this station', 'unauthorized')
    }
    let stationId = authenticated.stationId
    if (new Set(parsed.data.events.map((event) => event.sequence)).size !== parsed.data.events.length) {
      throw new PlatformError('Telemetry upload contains a duplicate sequence', 'invalid_input')
    }
    let now = this.#clock()
    let result = await this.database.transaction(async (transaction) => {
      let [execution] = await transaction
        .select({ attempt: matchAttempts, lease: runnerLeases, match: matches })
        .from(matchAttempts)
        .innerJoin(matches, and(eq(matches.leagueId, matchAttempts.leagueId), eq(matches.id, matchAttempts.matchId)))
        .innerJoin(runnerLeases, and(eq(runnerLeases.leagueId, matchAttempts.leagueId), eq(runnerLeases.matchAttemptId, matchAttempts.id)))
        .where(and(
          eq(matchAttempts.leagueId, authenticated.leagueId),
          eq(matchAttempts.id, parsed.data.attemptId),
          eq(runnerLeases.id, parsed.data.leaseId),
          eq(runnerLeases.runnerStationId, stationId),
        ))
        .for('update')
        .limit(1)
      if (!execution) throw new PlatformError('Telemetry attempt lease was not found', 'not_found')
      if (!['leased', 'running', 'provisional', 'review'].includes(execution.attempt.status)) {
        throw new PlatformError('This attempt no longer accepts telemetry', 'conflict')
      }
      for (let event of parsed.data.events) this.#assertBoundEvent(event, execution.attempt, execution.match)

      let sequences = parsed.data.events.map((event) => event.sequence)
      let existing = await transaction
        .select()
        .from(telemetryEvents)
        .where(and(
          eq(telemetryEvents.leagueId, authenticated.leagueId),
          eq(telemetryEvents.matchAttemptId, parsed.data.attemptId),
          inArray(telemetryEvents.sequence, sequences),
        ))
      let bySequence = new Map(existing.map((event) => [event.sequence, event]))
      let acceptedSequences: number[] = []
      let duplicateSequences: number[] = []
      for (let event of [...parsed.data.events].sort((left, right) => left.sequence - right.sequence)) {
        let prior = bySequence.get(event.sequence)
        if (prior) {
          if (!sameEvent(prior, event)) {
            throw new PlatformError(`Sequence ${event.sequence} conflicts with an accepted event`, 'conflict')
          }
          duplicateSequences.push(event.sequence)
          continue
        }
        await transaction.insert(telemetryEvents).values({
          adapterVersion: event.adapterVersion,
          correlationId: event.correlationId,
          eventType: event.eventType,
          frame: event.frame,
          gameBuildSha256: event.gameBuildSha256,
          leagueId: event.leagueId,
          matchAttemptId: event.attemptId,
          matchId: event.matchId,
          observationSource: event.observationSource,
          payload: event.payload,
          protocolVersion: event.protocolVersion,
          receivedAt: now,
          sequence: event.sequence,
          stateFingerprint: event.stateFingerprint,
        })
        acceptedSequences.push(event.sequence)
      }
      let allRows = await transaction
        .select()
        .from(telemetryEvents)
        .where(and(
          eq(telemetryEvents.leagueId, authenticated.leagueId),
          eq(telemetryEvents.matchAttemptId, parsed.data.attemptId),
        ))
        .orderBy(asc(telemetryEvents.sequence))
      let events = allRows.map(rowToEnvelope.bind(null, execution.attempt))
      let uploadHealth = basicHealth(events)
      return { acceptedSequences, duplicateSequences, health: uploadHealth }
    })
    return TelemetryUploadResponseSchema.parse({
      acceptedSequences: result.acceptedSequences,
      attemptId: parsed.data.attemptId,
      duplicateSequences: result.duplicateSequences,
      issues: result.health.issues,
      kind: 'telemetry-upload-response',
      maxAcceptedSequence: result.health.lastSequence,
      nextExpectedSequence: result.health.nextExpectedSequence,
      requiresReview: result.health.requiresReview,
      schemaVersion: 1,
    })
  }

  async dashboard(
    identity: SessionIdentity | null,
    leagueId: string,
  ): Promise<TelemetryAttemptSummary[]> {
    this.#requireMember(identity, leagueId)
    let [attemptRows, eventRows, correctionRows, derivationRows, teamRows] = await Promise.all([
      this.database
        .select({ attempt: matchAttempts, match: matches })
        .from(matchAttempts)
        .innerJoin(matches, and(eq(matches.leagueId, matchAttempts.leagueId), eq(matches.id, matchAttempts.matchId)))
        .where(eq(matchAttempts.leagueId, leagueId))
        .orderBy(desc(matchAttempts.createdAt)),
      this.database.select().from(telemetryEvents).where(eq(telemetryEvents.leagueId, leagueId)).orderBy(asc(telemetryEvents.sequence)),
      this.database.select().from(telemetryCorrections).where(eq(telemetryCorrections.leagueId, leagueId)).orderBy(asc(telemetryCorrections.createdAt), asc(telemetryCorrections.id)),
      this.database.select().from(telemetryDerivations).where(eq(telemetryDerivations.leagueId, leagueId)).orderBy(desc(telemetryDerivations.createdAt)),
      this.database.select({ id: leagueTeams.id, name: leagueTeams.name }).from(leagueTeams).where(eq(leagueTeams.leagueId, leagueId)),
    ])
    let teamNames = new Map(teamRows.map((team) => [team.id, team.name]))
    return attemptRows.map(({ attempt, match }) => {
      let rows = eventRows.filter((event) => event.matchAttemptId === attempt.id)
      let events = rows.map(rowToEnvelope.bind(null, attempt))
      let latest = derivationRows.find((derivation) => derivation.matchAttemptId === attempt.id)
      return {
        attemptId: attempt.id,
        attemptNumber: attempt.attemptNumber,
        attemptStatus: attempt.status,
        awayTeamId: match.awayTeamId,
        awayTeamName: teamNames.get(match.awayTeamId) ?? 'Unknown team',
        corrections: correctionRows.filter((correction) => correction.matchAttemptId === attempt.id),
        derivation: latest ? {
          boxScore: latest.boxScore as unknown as MatchBoxScore,
          correctionCount: latest.correctionCount,
          createdAt: latest.createdAt,
          id: latest.id,
          inputDigest: latest.inputDigest,
          status: latest.status,
        } : null,
        health: events.length ? basicHealth(events) : null,
        homeTeamId: match.homeTeamId,
        homeTeamName: teamNames.get(match.homeTeamId) ?? 'Unknown team',
        matchId: match.id,
        matchStatus: match.status,
        seasonId: match.seasonId,
      }
    })
  }

  async derive(
    identity: SessionIdentity | null,
    leagueId: string,
    attemptId: string,
  ): Promise<TelemetryDerivationResult> {
    this.#requireAdmin(identity, leagueId)
    return this.#deriveAndStore(leagueId, attemptId)
  }

  async correct(
    identity: SessionIdentity | null,
    leagueId: string,
    attemptId: string,
    input: unknown,
  ): Promise<TelemetryDerivationResult> {
    this.#requireAdmin(identity, leagueId)
    let parsed = CorrectionSchema.safeParse(input)
    if (!parsed.success) throw new PlatformError('Telemetry correction is invalid', 'invalid_input')
    let [attempt] = await this.database
      .select({ status: matchAttempts.status })
      .from(matchAttempts)
      .where(and(eq(matchAttempts.leagueId, leagueId), eq(matchAttempts.id, attemptId)))
      .limit(1)
    if (!attempt) throw new PlatformError('Match attempt was not found', 'not_found')
    if (!['provisional', 'review'].includes(attempt.status)) {
      throw new PlatformError('Only a provisional attempt can be corrected', 'conflict')
    }
    let current = await this.#deriveAndStore(leagueId, attemptId)
    let actual = correctionValue(current.boxScore, parsed.data.entityType, parsed.data.entityId, parsed.data.statPath)
    if (actual === null) throw new PlatformError('Correction target was not found in the box score', 'invalid_input')
    if (actual !== parsed.data.beforeValue) {
      throw new PlatformError(`Correction expected ${parsed.data.beforeValue} but the current value is ${actual}`, 'conflict')
    }
    let correctionId = this.#createId()
    await this.database.transaction(async (transaction) => {
      await transaction.insert(telemetryCorrections).values({
        ...parsed.data,
        actorPersonId: identity!.personId,
        id: correctionId,
        leagueId,
        matchAttemptId: attemptId,
      })
      await transaction.insert(auditRecords).values({
        action: 'telemetry.corrected',
        actorPersonId: identity!.personId,
        leagueId,
        metadata: { ...parsed.data, attemptId },
        targetId: correctionId,
        targetType: 'telemetry-correction',
      })
      await transaction.update(matchAttempts).set({ status: 'review' }).where(and(
        eq(matchAttempts.leagueId, leagueId), eq(matchAttempts.id, attemptId),
      ))
    })
    return this.#deriveAndStore(leagueId, attemptId)
  }

  async confirm(
    identity: SessionIdentity | null,
    leagueId: string,
    attemptId: string,
  ): Promise<void> {
    this.#requireAdmin(identity, leagueId)
    let derived = await this.#deriveAndStore(leagueId, attemptId)
    if (derived.health.requiresReview) {
      throw new PlatformError(`Telemetry requires review: ${derived.health.issues.join('; ')}`, 'conflict')
    }
    let now = this.#clock()
    await this.database.transaction(async (transaction) => {
      let [row] = await transaction
        .select({ attempt: matchAttempts, match: matches })
        .from(matchAttempts)
        .innerJoin(matches, and(eq(matches.leagueId, matchAttempts.leagueId), eq(matches.id, matchAttempts.matchId)))
        .where(and(eq(matchAttempts.leagueId, leagueId), eq(matchAttempts.id, attemptId)))
        .for('update')
        .limit(1)
      if (!row) throw new PlatformError('Match attempt was not found', 'not_found')
      if (row.attempt.status === 'confirmed' && row.match.status === 'confirmed') return
      if (!['provisional', 'review'].includes(row.attempt.status)) {
        throw new PlatformError('Only a completed attempt can be confirmed', 'conflict')
      }
      let confirmed = await transaction
        .select({ id: matchAttempts.id })
        .from(matchAttempts)
        .where(and(
          eq(matchAttempts.leagueId, leagueId),
          eq(matchAttempts.matchId, row.match.id),
          eq(matchAttempts.status, 'confirmed'),
        ))
        .limit(1)
      if (confirmed.length) throw new PlatformError('This match already has a confirmed attempt', 'conflict')
      await transaction.update(matchAttempts).set({
        confirmationSource: 'manual',
        confirmedAt: now,
        confirmedByPersonId: identity!.personId,
        status: 'confirmed',
      }).where(and(eq(matchAttempts.leagueId, leagueId), eq(matchAttempts.id, attemptId)))
      await transaction.update(matches).set({ status: 'confirmed', updatedAt: now }).where(and(
        eq(matches.leagueId, leagueId), eq(matches.id, row.match.id),
      ))
      await transaction.insert(auditRecords).values({
        action: 'telemetry.confirmed',
        actorPersonId: identity!.personId,
        leagueId,
        metadata: { derivationVersion: 1, inputDigest: derived.inputDigest },
        targetId: attemptId,
        targetType: 'match-attempt',
      })
    })
  }

  async finalizeHealthyAttempt(
    bearerCredential: string,
    attemptId: string,
  ): Promise<{ leagueId: string; matchId: string; status: 'confirmed' | 'review' }> {
    let credential = await this.#authenticate(bearerCredential)
    if (!credential.stationId) {
      throw new PlatformError('Runner credential is not bound to a station', 'unauthorized')
    }
    let [bound] = await this.database
      .select({ attempt: matchAttempts, lease: runnerLeases })
      .from(matchAttempts)
      .innerJoin(runnerLeases, and(
        eq(runnerLeases.leagueId, matchAttempts.leagueId),
        eq(runnerLeases.matchAttemptId, matchAttempts.id),
      ))
      .where(and(
        eq(matchAttempts.leagueId, credential.leagueId),
        eq(matchAttempts.id, attemptId),
        eq(runnerLeases.runnerStationId, credential.stationId),
      ))
      .limit(1)
    if (!bound) throw new PlatformError('Completed telemetry attempt was not found', 'not_found')
    if (bound.attempt.status === 'confirmed') {
      return { leagueId: bound.attempt.leagueId, matchId: bound.attempt.matchId, status: 'confirmed' }
    }
    if (!['provisional', 'review'].includes(bound.attempt.status)) {
      throw new PlatformError('Only a completed attempt can be finalized', 'conflict')
    }

    let derived: TelemetryDerivationResult
    try {
      derived = await this.#deriveAndStore(credential.leagueId, attemptId)
    } catch (error) {
      if (!(error instanceof PlatformError) || error.message !== 'No telemetry has been accepted for this attempt') throw error
      await this.#markAutomaticReview(credential.leagueId, attemptId, bound.attempt.matchId, [error.message])
      return { leagueId: credential.leagueId, matchId: bound.attempt.matchId, status: 'review' }
    }
    if (derived.health.requiresReview || derived.correctionCount > 0) {
      await this.#markAutomaticReview(
        credential.leagueId,
        attemptId,
        bound.attempt.matchId,
        derived.correctionCount > 0
          ? [...derived.health.issues, 'manual telemetry corrections require review']
          : derived.health.issues,
      )
      return { leagueId: credential.leagueId, matchId: bound.attempt.matchId, status: 'review' }
    }

    let now = this.#clock()
    let confirmed = await this.database.transaction(async (transaction) => {
      let [row] = await transaction
        .select({ attempt: matchAttempts, match: matches })
        .from(matchAttempts)
        .innerJoin(matches, and(
          eq(matches.leagueId, matchAttempts.leagueId),
          eq(matches.id, matchAttempts.matchId),
        ))
        .where(and(
          eq(matchAttempts.leagueId, credential.leagueId),
          eq(matchAttempts.id, attemptId),
        ))
        .for('update')
        .limit(1)
      if (!row) throw new PlatformError('Match attempt was not found', 'not_found')
      if (row.attempt.status === 'confirmed' && row.match.status === 'confirmed') return true
      if (row.attempt.status !== 'provisional') {
        throw new PlatformError('Attempt entered review before automatic confirmation', 'conflict')
      }
      let [currentEventCount, currentCorrectionCount] = await Promise.all([
        transaction.select({ value: count() }).from(telemetryEvents).where(and(
          eq(telemetryEvents.leagueId, credential.leagueId),
          eq(telemetryEvents.matchAttemptId, attemptId),
        )),
        transaction.select({ value: count() }).from(telemetryCorrections).where(and(
          eq(telemetryCorrections.leagueId, credential.leagueId),
          eq(telemetryCorrections.matchAttemptId, attemptId),
        )),
      ])
      if (currentEventCount[0]?.value !== derived.health.eventCount
        || currentCorrectionCount[0]?.value !== derived.correctionCount) {
        let issues = ['telemetry changed during automatic confirmation']
        await transaction.update(matchAttempts).set({ status: 'review' }).where(and(
          eq(matchAttempts.leagueId, credential.leagueId),
          eq(matchAttempts.id, attemptId),
        ))
        await transaction.update(matches).set({ status: 'provisional', updatedAt: now }).where(and(
          eq(matches.leagueId, credential.leagueId),
          eq(matches.id, row.match.id),
        ))
        await transaction.insert(auditRecords).values({
          action: 'telemetry.auto_confirmation_blocked',
          actorPersonId: null,
          leagueId: credential.leagueId,
          metadata: { issues },
          targetId: attemptId,
          targetType: 'match-attempt',
        })
        return false
      }
      let existingConfirmation = await transaction.select({ id: matchAttempts.id }).from(matchAttempts).where(and(
        eq(matchAttempts.leagueId, credential.leagueId),
        eq(matchAttempts.matchId, row.match.id),
        eq(matchAttempts.status, 'confirmed'),
      )).limit(1)
      if (existingConfirmation.length) throw new PlatformError('This match already has a confirmed attempt', 'conflict')
      await transaction.update(matchAttempts).set({
        confirmationSource: 'system',
        confirmedAt: now,
        confirmedByPersonId: null,
        status: 'confirmed',
      }).where(and(
        eq(matchAttempts.leagueId, credential.leagueId),
        eq(matchAttempts.id, attemptId),
      ))
      await transaction.update(matches).set({ status: 'confirmed', updatedAt: now }).where(and(
        eq(matches.leagueId, credential.leagueId),
        eq(matches.id, row.match.id),
      ))
      await transaction.insert(auditRecords).values({
        action: 'telemetry.auto_confirmed',
        actorPersonId: null,
        leagueId: credential.leagueId,
        metadata: {
          adapterVersion: SLUGGERS_ADAPTER_VERSION,
          derivationVersion: 1,
          eventCount: derived.health.eventCount,
          gameBuildSha256: bound.attempt.requiredGameBuildSha256,
          inputDigest: derived.inputDigest,
          observationSource: 'bridge-hook',
          protocolVersion: 1,
        },
        targetId: attemptId,
        targetType: 'match-attempt',
      })
      return true
    })
    return {
      leagueId: credential.leagueId,
      matchId: bound.attempt.matchId,
      status: confirmed ? 'confirmed' : 'review',
    }
  }

  async #markAutomaticReview(
    leagueId: string,
    attemptId: string,
    matchId: string,
    issues: string[],
  ): Promise<void> {
    await this.database.transaction(async (transaction) => {
      await transaction.update(matchAttempts).set({ status: 'review' }).where(and(
        eq(matchAttempts.leagueId, leagueId),
        eq(matchAttempts.id, attemptId),
      ))
      await transaction.update(matches).set({ status: 'provisional', updatedAt: this.#clock() }).where(and(
        eq(matches.leagueId, leagueId),
        eq(matches.id, matchId),
      ))
      await transaction.insert(auditRecords).values({
        action: 'telemetry.auto_confirmation_blocked',
        actorPersonId: null,
        leagueId,
        metadata: { issues },
        targetId: attemptId,
        targetType: 'match-attempt',
      })
    })
  }

  async rebuildSeason(
    identity: SessionIdentity | null,
    leagueId: string,
    seasonId: string,
  ): Promise<SeasonStatistics> {
    this.#requireMember(identity, leagueId)
    return rebuildSeasonStatistics(this.database, leagueId, seasonId)
  }

  async leagueStatistics(
    identity: SessionIdentity | null,
    leagueId: string,
  ): Promise<Array<{ name: string; seasonId: string; statistics: SeasonStatistics }>> {
    this.#requireMember(identity, leagueId)
    let seasonRows = await this.database
      .select({ id: seasons.id, name: seasons.name })
      .from(seasons)
      .where(eq(seasons.leagueId, leagueId))
      .orderBy(desc(seasons.createdAt))
    return Promise.all(seasonRows.map(async (season) => ({
      name: season.name,
      seasonId: season.id,
      statistics: await rebuildSeasonStatistics(this.database, leagueId, season.id),
    })))
  }

  async leagueOverview(
    identity: SessionIdentity | null,
    leagueId: string,
  ): Promise<LeagueOverviewSeason[]> {
    let member = this.#isMember(identity, leagueId)
    let [publication] = await this.database
      .select({
        leagueVisible: publicationSettings.leagueVisible,
        standingsVisible: publicationSettings.standingsVisible,
        statsVisible: publicationSettings.statsVisible,
      })
      .from(publicationSettings)
      .where(eq(publicationSettings.leagueId, leagueId))
      .limit(1)
    if (!member && !publication?.leagueVisible) {
      throw new PlatformError('League membership is required', 'forbidden')
    }
    let showStandings = member || publication?.standingsVisible === true
    let showStats = member || publication?.statsVisible === true
    let seasonRows = await this.database
      .select({ id: seasons.id, name: seasons.name })
      .from(seasons)
      .where(eq(seasons.leagueId, leagueId))
      .orderBy(desc(seasons.createdAt))
    if (!showStandings && !showStats) {
      return seasonRows.map((season) => ({
        name: season.name,
        playerTotals: null,
        seasonId: season.id,
        standings: null,
      }))
    }
    return Promise.all(seasonRows.map(async (season) => {
      let statistics = await rebuildSeasonStatistics(this.database, leagueId, season.id)
      return {
        name: season.name,
        playerTotals: showStats ? statistics.playerTotals : null,
        seasonId: season.id,
        standings: showStandings ? statistics.standings : null,
      }
    }))
  }

  async #deriveAndStore(leagueId: string, attemptId: string): Promise<TelemetryDerivationResult> {
    let context = await this.#attemptContext(leagueId, attemptId)
    let [eventRows, correctionRows] = await Promise.all([
      this.database.select().from(telemetryEvents).where(and(
        eq(telemetryEvents.leagueId, leagueId), eq(telemetryEvents.matchAttemptId, attemptId),
      )).orderBy(asc(telemetryEvents.sequence)),
      this.database.select().from(telemetryCorrections).where(and(
        eq(telemetryCorrections.leagueId, leagueId), eq(telemetryCorrections.matchAttemptId, attemptId),
      )).orderBy(asc(telemetryCorrections.createdAt), asc(telemetryCorrections.id)),
    ])
    if (!eventRows.length) throw new PlatformError('No telemetry has been accepted for this attempt', 'conflict')
    let result = deriveTelemetry(
      eventRows.map(rowToEnvelope.bind(null, context.attempt)),
      correctionRows,
      {
        awayCharacterIds: context.awayCharacterIds,
        awayTeamId: context.match.awayTeamId,
        homeCharacterIds: context.homeCharacterIds,
        homeTeamId: context.match.homeTeamId,
      },
    )
    let derivationId = this.#createId()
    await this.database.insert(telemetryDerivations).values({
      boxScore: result.boxScore as unknown as Record<string, unknown>,
      correctionCount: result.correctionCount,
      derivationVersion: 1,
      eventCount: result.health.eventCount,
      id: derivationId,
      inputDigest: result.inputDigest,
      issues: result.health.issues,
      leagueId,
      matchAttemptId: attemptId,
      matchId: context.match.id,
      sourceFirstSequence: result.health.firstSequence,
      sourceLastSequence: result.health.lastSequence,
      status: result.health.requiresReview ? 'review' : 'ready',
    }).onConflictDoNothing()
    if (result.health.requiresReview && ['provisional', 'review'].includes(context.attempt.status)) {
      await this.database.update(matchAttempts).set({ status: 'review' }).where(and(
        eq(matchAttempts.leagueId, leagueId), eq(matchAttempts.id, attemptId),
      ))
    }
    return result
  }

  async #attemptContext(leagueId: string, attemptId: string): Promise<AttemptContext> {
    let [row] = await this.database
      .select({ attempt: matchAttempts, match: matches })
      .from(matchAttempts)
      .innerJoin(matches, and(eq(matches.leagueId, matchAttempts.leagueId), eq(matches.id, matchAttempts.matchId)))
      .where(and(eq(matchAttempts.leagueId, leagueId), eq(matchAttempts.id, attemptId)))
      .limit(1)
    if (!row) throw new PlatformError('Match attempt was not found', 'not_found')
    let rosters = await this.database.select({
      id: rosterRevisions.id,
      rosterCharacterIds: rosterRevisions.rosterCharacterIds,
    }).from(rosterRevisions).where(and(
      eq(rosterRevisions.leagueId, leagueId),
      inArray(rosterRevisions.id, [row.attempt.homeRosterRevisionId, row.attempt.awayRosterRevisionId]),
    ))
    let home = rosters.find((roster) => roster.id === row.attempt.homeRosterRevisionId)
    let away = rosters.find((roster) => roster.id === row.attempt.awayRosterRevisionId)
    if (!home || !away) throw new PlatformError('Attempt roster snapshots are unavailable', 'conflict')
    return { ...row, awayCharacterIds: away.rosterCharacterIds, homeCharacterIds: home.rosterCharacterIds }
  }

  async #latestDerivation(leagueId: string, attemptId: string) {
    let [latest] = await this.database.select().from(telemetryDerivations).where(and(
      eq(telemetryDerivations.leagueId, leagueId), eq(telemetryDerivations.matchAttemptId, attemptId),
    )).orderBy(desc(telemetryDerivations.createdAt)).limit(1)
    return latest
  }

  async #authenticate(bearerCredential: string) {
    let match = RUNNER_CREDENTIAL_PATTERN.exec(bearerCredential)
    if (!match) throw new PlatformError('Runner credential is invalid', 'unauthorized')
    let [, credentialId, secret] = match
    let [credential] = await this.database.select().from(runnerCredentials).where(eq(runnerCredentials.id, credentialId!)).limit(1)
    let candidateHash = hashSecret(secret!)
    let now = this.#clock()
    if (!credential || credential.revokedAt || (credential.expiresAt && credential.expiresAt <= now)
      || !safeEqual(candidateHash, credential.secretHash) || !credential.scopes.includes('telemetry:write')) {
      throw new PlatformError('Runner credential is not authorized', 'unauthorized')
    }
    await this.database.update(runnerCredentials).set({ lastUsedAt: now }).where(eq(runnerCredentials.id, credential.id))
    return credential
  }

  #assertBoundEvent(
    event: TelemetryEnvelope,
    attempt: typeof matchAttempts.$inferSelect,
    match: typeof matches.$inferSelect,
  ): void {
    if (event.leagueId !== attempt.leagueId || event.matchId !== match.id || event.attemptId !== attempt.id
      || event.attemptNonce !== attempt.attemptNonce || event.correlationId !== attempt.correlationId
      || event.gameBuildSha256 !== attempt.requiredGameBuildSha256
      || event.adapterVersion !== SLUGGERS_ADAPTER_VERSION) {
      throw new PlatformError(`Telemetry sequence ${event.sequence} is not bound to this attempt`, 'conflict')
    }
  }

  #requireMember(identity: SessionIdentity | null, leagueId: string): asserts identity is SessionIdentity {
    if (!identity) throw new PlatformError('Sign in is required', 'unauthorized')
    if (!this.#isMember(identity, leagueId)) {
      throw new PlatformError('League membership is required', 'forbidden')
    }
  }

  #isMember(identity: SessionIdentity | null, leagueId: string): identity is SessionIdentity {
    return Boolean(identity && (identity.isSiteAdmin
      || identity.memberships.some((membership) => membership.leagueId === leagueId)))
  }

  #requireAdmin(identity: SessionIdentity | null, leagueId: string): asserts identity is SessionIdentity {
    this.#requireMember(identity, leagueId)
    let membership = identity.memberships.find((candidate) => candidate.leagueId === leagueId)
    if (!identity.isSiteAdmin && !membership?.roles.some((role) => scoringRoles.has(role))) {
      throw new PlatformError('Scorekeeper access is required', 'forbidden')
    }
  }
}

function rowToEnvelope(
  attempt: typeof matchAttempts.$inferSelect,
  row: typeof telemetryEvents.$inferSelect,
): TelemetryEnvelope {
  return TelemetryEnvelopeSchema.parse({
    adapterVersion: row.adapterVersion,
    attemptId: row.matchAttemptId,
    attemptNonce: attempt.attemptNonce,
    correlationId: row.correlationId,
    eventType: row.eventType,
    frame: row.frame,
    gameBuildSha256: row.gameBuildSha256,
    kind: 'telemetry-envelope',
    leagueId: row.leagueId,
    matchId: row.matchId,
    observationSource: row.observationSource,
    payload: row.payload,
    protocolVersion: row.protocolVersion,
    schemaVersion: 1,
    sequence: row.sequence,
    stateFingerprint: row.stateFingerprint ?? undefined,
  })
}

function basicHealth(events: TelemetryEnvelope[]): TelemetryHealth {
  let present = new Set(events.map((event) => event.sequence))
  let nextExpectedSequence = 1
  while (present.has(nextExpectedSequence)) nextExpectedSequence += 1
  let issues: string[] = []
  if (events[0]?.sequence !== 1) issues.push(`telemetry begins at sequence ${events[0]?.sequence ?? 0}, expected 1`)
  for (let index = 1; index < events.length; index += 1) {
    if (events[index]!.sequence !== events[index - 1]!.sequence + 1) {
      issues.push(`sequence gap between ${events[index - 1]!.sequence} and ${events[index]!.sequence}`)
    }
  }
  if (events.some((event) => event.observationSource === 'memory-observation')) {
    issues.push('provisional read-only memory observations require review')
  }
  if (events.some((event) => event.eventType === 'bridge-warning'
    && (event.payload.code === 'overflow' || event.payload.code === 'sequence-gap'))) {
    issues.push('bridge reported missing or overflowing telemetry')
  }
  if (events.some((event) => event.eventType === 'bridge-warning'
    && (event.payload.code === 'provisional-observation' || event.payload.code === 'incompatibility'))) {
    issues.push('bridge reported provisional or incompatible telemetry')
  }
  return {
    eventCount: events.length,
    firstSequence: events[0]?.sequence ?? 0,
    issues,
    lastSequence: events.at(-1)?.sequence ?? 0,
    nextExpectedSequence,
    requiresReview: issues.length > 0,
  }
}

function sameEvent(row: typeof telemetryEvents.$inferSelect, event: TelemetryEnvelope): boolean {
  return row.correlationId === event.correlationId
    && row.matchId === event.matchId
    && row.frame === event.frame
    && row.protocolVersion === event.protocolVersion
    && row.eventType === event.eventType
    && row.observationSource === event.observationSource
    && row.adapterVersion === event.adapterVersion
    && row.gameBuildSha256 === event.gameBuildSha256
    && row.stateFingerprint === (event.stateFingerprint ?? null)
    && stableJson(row.payload) === stableJson(event.payload)
}

function safeEqual(candidate: string, expected: string): boolean {
  let left = Buffer.from(candidate, 'utf8')
  let right = Buffer.from(expected, 'utf8')
  return left.length === right.length && timingSafeEqual(left, right)
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(',')}}`
  return JSON.stringify(value)
}
