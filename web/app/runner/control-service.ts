import { randomUUID, timingSafeEqual } from 'node:crypto'

import { and, asc, eq, lte } from 'drizzle-orm'

import {
  RunEnvelopeSchema,
  MatchConfigurationPackageSchema,
  RulesetRevisionSchema,
  RunnerClaimRequestSchema,
  RunnerClaimResponseSchema,
  RunnerHeartbeatRequestSchema,
  RunnerHeartbeatResponseSchema,
  RunnerLeaseUpdateRequestSchema,
  RunnerLeaseUpdateResponseSchema,
  RunnerRegistrationRequestSchema,
  RunnerRegistrationResponseSchema,
  StatProfileRevisionSchema,
  TeamLineupRevisionSchema,
  type MatchConfigurationPackage,
  type RunEnvelope,
  type RunnerClaimRequest,
  type RunnerClaimResponse,
  type RunnerHeartbeatRequest,
  type RunnerHeartbeatResponse,
  type RunnerLeaseUpdateRequest,
  type RunnerLeaseUpdateResponse,
  type RunnerRegistrationRequest,
  type RunnerRegistrationResponse,
} from '@starworks/contracts'

import type { StarworksDatabase } from '../platform/database/connection.ts'
import {
  attemptLifecycleEvents,
  lineupRevisions,
  matches,
  matchAttempts,
  rosterRevisions,
  rulesetRevisions,
  runnerCredentials,
  runnerLeases,
  runnerStations,
  statProfileRevisions,
} from '../platform/database/schema.ts'
import { PlatformError } from '../platform/errors.ts'
import type { RunnerCredentialScope } from '../platform/model.ts'
import { hashSecret } from '../platform/security.ts'

const RUNNER_CREDENTIAL_PATTERN = /^starworks_runner_([0-9a-f-]{36})\.([A-Za-z0-9_-]{32,128})$/i

interface AuthenticatedRunnerCredential {
  credentialId: string
  leagueId: string
  scopes: string[]
  stationId: string | null
}

export interface RunnerControlApplication {
  register(bearerCredential: string, input: unknown): Promise<RunnerRegistrationResponse>
  heartbeat(bearerCredential: string, input: unknown): Promise<RunnerHeartbeatResponse>
  claim(bearerCredential: string, input: unknown): Promise<RunnerClaimResponse>
  updateLease(bearerCredential: string, input: unknown): Promise<RunnerLeaseUpdateResponse>
  configuration(bearerCredential: string, attemptId: string): Promise<MatchConfigurationPackage>
}

export interface RunnerControlServiceOptions {
  clock?: () => Date
  createId?: () => string
  heartbeatSeconds?: number
  leaseSeconds?: number
  adapterVersion?: string
  minimumRunnerVersion?: string
  recommendedRunnerVersion?: string
}

export class RunnerControlService {
  readonly #clock: () => Date
  readonly #createId: () => string
  readonly #heartbeatSeconds: number
  readonly #leaseSeconds: number
  readonly #adapterVersion: string
  readonly #minimumRunnerVersion: string
  readonly #recommendedRunnerVersion: string

  constructor(
    readonly database: StarworksDatabase,
    options: RunnerControlServiceOptions = {},
  ) {
    this.#clock = options.clock ?? (() => new Date())
    this.#createId = options.createId ?? randomUUID
    this.#heartbeatSeconds = options.heartbeatSeconds ?? 15
    this.#leaseSeconds = options.leaseSeconds ?? 60
    this.#adapterVersion = options.adapterVersion ?? '0.1.0'
    this.#minimumRunnerVersion = options.minimumRunnerVersion ?? '0.1.0'
    this.#recommendedRunnerVersion = options.recommendedRunnerVersion ?? '0.1.0'
  }

  async register(
    bearerCredential: string,
    input: unknown,
  ): Promise<RunnerRegistrationResponse> {
    let request = this.#parse(RunnerRegistrationRequestSchema, input)
    let authenticated = await this.#authenticate(bearerCredential, 'heartbeat:write')
    let now = this.#clock()
    let stationId = await this.database.transaction(async (transaction) => {
      let [credential] = await transaction
        .select()
        .from(runnerCredentials)
        .where(eq(runnerCredentials.id, authenticated.credentialId))
        .for('update')
        .limit(1)
      if (!credential || credential.revokedAt || (credential.expiresAt && credential.expiresAt <= now)) {
        throw new PlatformError('Runner credential is no longer active', 'unauthorized')
      }
      let id = credential.stationId ?? this.#createId()
      if (credential.stationId) {
        let station = await transaction
          .update(runnerStations)
          .set({
            capabilities: request.capabilities,
            lastHeartbeatAt: now,
            name: request.stationName,
            updatedAt: now,
          })
          .where(and(
            eq(runnerStations.id, id),
            eq(runnerStations.leagueId, credential.leagueId),
            eq(runnerStations.status, 'active'),
          ))
          .returning({ id: runnerStations.id })
        if (!station.length) throw new PlatformError('Runner station has been revoked', 'unauthorized')
      } else {
        await transaction.insert(runnerStations).values({
          capabilities: request.capabilities,
          id,
          lastHeartbeatAt: now,
          leagueId: credential.leagueId,
          name: request.stationName,
        })
        await transaction
          .update(runnerCredentials)
          .set({ stationId: id })
          .where(eq(runnerCredentials.id, credential.id))
      }
      return id
    })
    return RunnerRegistrationResponseSchema.parse({
      heartbeatSeconds: this.#heartbeatSeconds,
      kind: 'runner-registration-response',
      leaseSeconds: this.#leaseSeconds,
      runnerId: stationId,
      schemaVersion: 1,
      versionPolicy: {
        minimumRunnerVersion: this.#minimumRunnerVersion,
        recommendedRunnerVersion: this.#recommendedRunnerVersion,
        status: runnerVersionStatus(
          request.capabilities.runnerVersion,
          this.#minimumRunnerVersion,
          this.#recommendedRunnerVersion,
        ),
      },
    })
  }

  async heartbeat(
    bearerCredential: string,
    input: unknown,
  ): Promise<RunnerHeartbeatResponse> {
    let request = this.#parse(RunnerHeartbeatRequestSchema, input)
    let authenticated = await this.#authenticate(bearerCredential, 'heartbeat:write')
    let stationId = this.#requireBoundStation(authenticated, request.runnerId)
    if ((request.activeAttemptId === null) !== (request.activeLeaseId === null)) {
      throw new PlatformError('Active attempt and lease must be reported together', 'invalid_input')
    }
    if (request.activeAttemptId && request.activeLeaseId) {
      let [lease] = await this.database
        .select({ id: runnerLeases.id })
        .from(runnerLeases)
        .where(and(
          eq(runnerLeases.leagueId, authenticated.leagueId),
          eq(runnerLeases.id, request.activeLeaseId),
          eq(runnerLeases.matchAttemptId, request.activeAttemptId),
          eq(runnerLeases.runnerStationId, stationId),
          eq(runnerLeases.status, 'active'),
        ))
        .limit(1)
      if (!lease) throw new PlatformError('Reported runner lease is not active', 'conflict')
    }
    let now = this.#clock()
    let updated = await this.database
      .update(runnerStations)
      .set({
        componentHealth: request.components ?? {},
        lastHeartbeatAt: now,
        runtimeState: request.state,
        updatedAt: now,
      })
      .where(and(
        eq(runnerStations.leagueId, authenticated.leagueId),
        eq(runnerStations.id, stationId),
        eq(runnerStations.status, 'active'),
      ))
      .returning({ id: runnerStations.id })
    if (!updated.length) throw new PlatformError('Runner station has been revoked', 'unauthorized')
    return RunnerHeartbeatResponseSchema.parse({
      accepted: true,
      kind: 'runner-heartbeat-response',
      schemaVersion: 1,
      serverTime: now.toISOString(),
    })
  }

  async claim(
    bearerCredential: string,
    input: unknown,
  ): Promise<RunnerClaimResponse> {
    let request = this.#parse(RunnerClaimRequestSchema, input)
    let authenticated = await this.#authenticate(bearerCredential, 'runs:claim')
    let stationId = this.#requireBoundStation(authenticated, request.runnerId)
    let now = this.#clock()
    let claimed = await this.database.transaction(async (transaction) => {
      let [station] = await transaction
        .select({ id: runnerStations.id })
        .from(runnerStations)
        .where(and(
          eq(runnerStations.leagueId, authenticated.leagueId),
          eq(runnerStations.id, stationId),
          eq(runnerStations.status, 'active'),
        ))
        .for('update')
        .limit(1)
      if (!station) throw new PlatformError('Runner station has been revoked', 'unauthorized')

      let expiredLeases = await transaction
        .select({
          attemptId: runnerLeases.matchAttemptId,
          leaseId: runnerLeases.id,
        })
        .from(runnerLeases)
        .where(and(
          eq(runnerLeases.leagueId, authenticated.leagueId),
          eq(runnerLeases.status, 'active'),
          lte(runnerLeases.expiresAt, now),
        ))
        .for('update', { skipLocked: true })
      for (let expired of expiredLeases) {
        let released = await transaction
          .update(runnerLeases)
          .set({ releasedAt: now, status: 'expired' })
          .where(and(eq(runnerLeases.id, expired.leaseId), eq(runnerLeases.status, 'active')))
          .returning({ attemptId: runnerLeases.matchAttemptId })
        if (!released.length) continue
        let [failedAttempt] = await transaction
          .update(matchAttempts)
          .set({ failedAt: now, failureKind: 'runner-crash', status: 'failed' })
          .where(and(
            eq(matchAttempts.leagueId, authenticated.leagueId),
            eq(matchAttempts.id, expired.attemptId),
          ))
          .returning({ matchId: matchAttempts.matchId })
        if (!failedAttempt) continue
        await transaction
          .update(matches)
          .set({ status: 'scheduled', updatedAt: now })
          .where(and(eq(matches.leagueId, authenticated.leagueId), eq(matches.id, failedAttempt.matchId)))
        await transaction.insert(attemptLifecycleEvents).values({
          eventType: 'lease-expired',
          failureKind: 'runner-crash',
          leagueId: authenticated.leagueId,
          matchAttemptId: expired.attemptId,
          observedAt: now,
        })
      }

      let [existingLease] = await transaction
        .select({ attemptId: runnerLeases.matchAttemptId, leaseId: runnerLeases.id })
        .from(runnerLeases)
        .where(and(
          eq(runnerLeases.leagueId, authenticated.leagueId),
          eq(runnerLeases.runnerStationId, stationId),
          eq(runnerLeases.status, 'active'),
        ))
        .limit(1)
      if (existingLease) return existingLease

      let [attempt] = await transaction
        .select({ id: matchAttempts.id, matchId: matchAttempts.matchId })
        .from(matchAttempts)
        .where(and(
          eq(matchAttempts.leagueId, authenticated.leagueId),
          eq(matchAttempts.status, 'queued'),
        ))
        .orderBy(asc(matchAttempts.createdAt), asc(matchAttempts.attemptNumber))
        .for('update', { skipLocked: true })
        .limit(1)
      if (!attempt) return null
      let leaseId = this.#createId()
      let expiresAt = this.#leaseExpiry(now)
      await transaction.insert(runnerLeases).values({
        expiresAt,
        id: leaseId,
        lastRenewedAt: now,
        leagueId: authenticated.leagueId,
        matchAttemptId: attempt.id,
        runnerStationId: stationId,
      })
      await transaction
        .update(matchAttempts)
        .set({ issuedAt: now, status: 'leased' })
        .where(and(eq(matchAttempts.leagueId, authenticated.leagueId), eq(matchAttempts.id, attempt.id)))
      await transaction
        .update(matches)
        .set({ status: 'in_progress', updatedAt: now })
        .where(and(eq(matches.leagueId, authenticated.leagueId), eq(matches.id, attempt.matchId)))
      await transaction.insert(attemptLifecycleEvents).values({
        eventType: 'claimed',
        leagueId: authenticated.leagueId,
        matchAttemptId: attempt.id,
        observedAt: now,
        runnerStationId: stationId,
      })
      return { attemptId: attempt.id, leaseId }
    })
    let run = claimed
      ? await this.#loadRunEnvelope(authenticated.leagueId, stationId, claimed.attemptId, claimed.leaseId)
      : null
    return RunnerClaimResponseSchema.parse({
      kind: 'runner-claim-response',
      run,
      schemaVersion: 1,
    })
  }

  async updateLease(
    bearerCredential: string,
    input: unknown,
  ): Promise<RunnerLeaseUpdateResponse> {
    let request = this.#parse(RunnerLeaseUpdateRequestSchema, input)
    let authenticated = await this.#authenticate(bearerCredential, 'runs:claim')
    let stationId = this.#requireBoundStation(authenticated, request.runnerId)
    let now = this.#clock()
    let result = await this.database.transaction(async (transaction) => {
      let [record] = await transaction
        .select({
          attemptStatus: matchAttempts.status,
          expiresAt: runnerLeases.expiresAt,
          leaseStatus: runnerLeases.status,
          matchId: matchAttempts.matchId,
        })
        .from(runnerLeases)
        .innerJoin(matchAttempts, and(
          eq(matchAttempts.leagueId, runnerLeases.leagueId),
          eq(matchAttempts.id, runnerLeases.matchAttemptId),
        ))
        .where(and(
          eq(runnerLeases.leagueId, authenticated.leagueId),
          eq(runnerLeases.id, request.leaseId),
          eq(runnerLeases.matchAttemptId, request.attemptId),
          eq(runnerLeases.runnerStationId, stationId),
        ))
        .for('update')
        .limit(1)
      if (!record) throw new PlatformError('Runner lease was not found', 'not_found')

      let idempotentStatus = this.#idempotentStatus(request.action, record.attemptStatus)
      if (idempotentStatus) {
        return { status: idempotentStatus, expiresAt: null as Date | null }
      }
      if (record.leaseStatus !== 'active') {
        throw new PlatformError('Runner lease is no longer active', 'conflict')
      }
      if (record.expiresAt <= now) {
        await transaction
          .update(runnerLeases)
          .set({ releasedAt: now, status: 'expired' })
          .where(eq(runnerLeases.id, request.leaseId))
        await transaction
          .update(matchAttempts)
          .set({ failedAt: now, failureKind: 'runner-crash', status: 'failed' })
          .where(eq(matchAttempts.id, request.attemptId))
        await transaction
          .update(matches)
          .set({ status: 'scheduled', updatedAt: now })
          .where(and(eq(matches.leagueId, authenticated.leagueId), eq(matches.id, record.matchId)))
        await transaction.insert(attemptLifecycleEvents).values({
          eventType: 'lease-expired',
          failureKind: 'runner-crash',
          leagueId: authenticated.leagueId,
          matchAttemptId: request.attemptId,
          observedAt: now,
          runnerStationId: stationId,
        })
        return { error: 'Runner lease has expired' as const }
      }

      if (request.action === 'renew') {
        if (record.attemptStatus !== 'leased' && record.attemptStatus !== 'running') {
          throw new PlatformError('This attempt cannot renew its lease', 'conflict')
        }
        let expiresAt = this.#leaseExpiry(now)
        await transaction
          .update(runnerLeases)
          .set({ expiresAt, lastRenewedAt: now })
          .where(eq(runnerLeases.id, request.leaseId))
        await this.#recordLifecycle(transaction, authenticated.leagueId, request, stationId, 'renewed')
        return { status: record.attemptStatus, expiresAt }
      }

      if (request.action === 'started') {
        if (record.attemptStatus !== 'leased') {
          throw new PlatformError('Only a leased attempt can start', 'conflict')
        }
        let expiresAt = this.#leaseExpiry(now)
        await transaction
          .update(runnerLeases)
          .set({ expiresAt, lastRenewedAt: now })
          .where(eq(runnerLeases.id, request.leaseId))
        await transaction
          .update(matchAttempts)
          .set({ startedAt: now, status: 'running' })
          .where(eq(matchAttempts.id, request.attemptId))
        await this.#recordLifecycle(transaction, authenticated.leagueId, request, stationId, 'started')
        return { status: 'running' as const, expiresAt }
      }

      let status = request.action === 'complete'
        ? 'provisional' as const
        : request.action === 'cancel'
          ? 'cancelled' as const
          : 'failed' as const
      if (record.attemptStatus !== 'leased' && record.attemptStatus !== 'running') {
        throw new PlatformError('This attempt cannot be completed', 'conflict')
      }
      await transaction
        .update(runnerLeases)
        .set({ releasedAt: now, status: 'released' })
        .where(eq(runnerLeases.id, request.leaseId))
      await transaction
        .update(matchAttempts)
        .set({
          cancelledAt: status === 'cancelled' ? now : undefined,
          completedAt: status === 'provisional' ? now : undefined,
          failedAt: status === 'failed' ? now : undefined,
          failureKind: status === 'failed' ? request.failureKind : undefined,
          status,
        })
        .where(eq(matchAttempts.id, request.attemptId))
      await transaction
        .update(matches)
        .set({ status: status === 'provisional' ? 'provisional' : 'scheduled', updatedAt: now })
        .where(and(eq(matches.leagueId, authenticated.leagueId), eq(matches.id, record.matchId)))
      await this.#recordLifecycle(
        transaction,
        authenticated.leagueId,
        request,
        stationId,
        status === 'provisional' ? 'completed' : status,
      )
      return { status, expiresAt: null as Date | null }
    })
    if ('error' in result && result.error) throw new PlatformError(result.error, 'conflict')
    return RunnerLeaseUpdateResponseSchema.parse({
      attemptStatus: result.status,
      expiresAt: result.expiresAt?.toISOString() ?? null,
      kind: 'runner-lease-update-response',
      schemaVersion: 1,
    })
  }

  async configuration(
    bearerCredential: string,
    attemptId: string,
  ): Promise<MatchConfigurationPackage> {
    let authenticated = await this.#authenticate(bearerCredential, 'runs:read')
    let stationId = this.#requireBoundStation(authenticated, authenticated.stationId ?? '')
    let [execution] = await this.database
      .select({ attempt: matchAttempts, lease: runnerLeases, match: matches })
      .from(matchAttempts)
      .innerJoin(matches, and(
        eq(matches.leagueId, matchAttempts.leagueId),
        eq(matches.id, matchAttempts.matchId),
      ))
      .innerJoin(runnerLeases, and(
        eq(runnerLeases.leagueId, matchAttempts.leagueId),
        eq(runnerLeases.matchAttemptId, matchAttempts.id),
      ))
      .where(and(
        eq(matchAttempts.leagueId, authenticated.leagueId),
        eq(matchAttempts.id, attemptId),
        eq(runnerLeases.runnerStationId, stationId),
        eq(runnerLeases.status, 'active'),
      ))
      .limit(1)
    if (!execution || execution.lease.expiresAt <= this.#clock() || !execution.attempt.issuedAt) {
      throw new PlatformError('Active attempt configuration was not found', 'not_found')
    }
    let [[profile], [ruleset], home, away] = await Promise.all([
      this.database
        .select()
        .from(statProfileRevisions)
        .where(and(
          eq(statProfileRevisions.leagueId, authenticated.leagueId),
          eq(statProfileRevisions.id, execution.attempt.statProfileRevisionId),
          eq(statProfileRevisions.status, 'published'),
        ))
        .limit(1),
      this.database
        .select()
        .from(rulesetRevisions)
        .where(and(
          eq(rulesetRevisions.leagueId, authenticated.leagueId),
          eq(rulesetRevisions.id, execution.attempt.rulesetRevisionId),
          eq(rulesetRevisions.status, 'published'),
        ))
        .limit(1),
      this.#loadPublishedLineup(authenticated.leagueId, execution.attempt.homeLineupRevisionId),
      this.#loadPublishedLineup(authenticated.leagueId, execution.attempt.awayLineupRevisionId),
    ])
    if (!profile || !ruleset || !home || !away) {
      throw new PlatformError('Published attempt configuration is incomplete', 'conflict')
    }
    return MatchConfigurationPackageSchema.parse({
      adapterId: 'sluggers-rmbe01',
      adapterVersion: this.#adapterVersion,
      attemptId: execution.attempt.id,
      attemptNonce: execution.attempt.attemptNonce,
      dynamicRuleOverrides: execution.attempt.dynamicRuleOverrides,
      generatedAt: execution.attempt.issuedAt.toISOString(),
      kind: 'match-configuration-package',
      leagueId: authenticated.leagueId,
      matchId: execution.match.id,
      ruleset: RulesetRevisionSchema.parse({
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
      }),
      schemaVersion: 1,
      statProfile: StatProfileRevisionSchema.parse({
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
        status: profile.status,
      }),
      teams: [{ side: 'home', lineup: home }, { side: 'away', lineup: away }],
    })
  }

  async #authenticate(
    bearerCredential: string,
    requiredScope: RunnerCredentialScope,
  ): Promise<AuthenticatedRunnerCredential> {
    let match = RUNNER_CREDENTIAL_PATTERN.exec(bearerCredential)
    if (!match) throw new PlatformError('Runner credential is invalid', 'unauthorized')
    let [, credentialId, secret] = match
    let [credential] = await this.database
      .select()
      .from(runnerCredentials)
      .where(eq(runnerCredentials.id, credentialId!))
      .limit(1)
    let now = this.#clock()
    let candidateHash = hashSecret(secret!)
    if (
      !credential
      || credential.revokedAt
      || (credential.expiresAt && credential.expiresAt <= now)
      || !this.#hashesEqual(candidateHash, credential.secretHash)
      || !credential.scopes.includes(requiredScope)
    ) {
      throw new PlatformError('Runner credential is not authorized', 'unauthorized')
    }
    await this.database
      .update(runnerCredentials)
      .set({ lastUsedAt: now })
      .where(eq(runnerCredentials.id, credential.id))
    return {
      credentialId: credential.id,
      leagueId: credential.leagueId,
      scopes: credential.scopes,
      stationId: credential.stationId,
    }
  }

  async #loadRunEnvelope(
    leagueId: string,
    stationId: string,
    attemptId: string,
    leaseId: string,
  ): Promise<RunEnvelope> {
    let [row] = await this.database
      .select({ attempt: matchAttempts, lease: runnerLeases, match: matches })
      .from(matchAttempts)
      .innerJoin(matches, and(eq(matches.leagueId, matchAttempts.leagueId), eq(matches.id, matchAttempts.matchId)))
      .innerJoin(runnerLeases, and(eq(runnerLeases.leagueId, matchAttempts.leagueId), eq(runnerLeases.matchAttemptId, matchAttempts.id)))
      .where(and(
        eq(matchAttempts.leagueId, leagueId),
        eq(matchAttempts.id, attemptId),
        eq(runnerLeases.id, leaseId),
        eq(runnerLeases.runnerStationId, stationId),
        eq(runnerLeases.status, 'active'),
      ))
      .limit(1)
    if (!row || !row.attempt.issuedAt) {
      throw new PlatformError('Claimed run envelope could not be loaded', 'conflict')
    }
    return RunEnvelopeSchema.parse({
      attemptId: row.attempt.id,
      attemptNonce: row.attempt.attemptNonce,
      correlationId: row.attempt.correlationId,
      createdByActorId: row.attempt.createdByPersonId,
      dynamicRuleOverrides: row.attempt.dynamicRuleOverrides,
      issuedAt: row.attempt.issuedAt.toISOString(),
      kind: 'run-envelope',
      leagueId,
      lease: {
        expiresAt: row.lease.expiresAt.toISOString(),
        leaseId: row.lease.id,
        runnerId: stationId,
      },
      matchId: row.match.id,
      requiredGameBuildSha256: row.attempt.requiredGameBuildSha256,
      rulesetRevisionId: row.attempt.rulesetRevisionId,
      schemaVersion: 1,
      seasonId: row.match.seasonId,
      statProfileRevisionId: row.attempt.statProfileRevisionId,
      teams: [
        {
          lineupRevisionId: row.attempt.homeLineupRevisionId,
          rosterRevisionId: row.attempt.homeRosterRevisionId,
          side: 'home',
          teamId: row.match.homeTeamId,
        },
        {
          lineupRevisionId: row.attempt.awayLineupRevisionId,
          rosterRevisionId: row.attempt.awayRosterRevisionId,
          side: 'away',
          teamId: row.match.awayTeamId,
        },
      ],
    })
  }

  async #loadPublishedLineup(leagueId: string, revisionId: string) {
    let [row] = await this.database
      .select({ lineup: lineupRevisions, roster: rosterRevisions })
      .from(lineupRevisions)
      .innerJoin(rosterRevisions, and(
        eq(rosterRevisions.leagueId, lineupRevisions.leagueId),
        eq(rosterRevisions.id, lineupRevisions.rosterRevisionId),
      ))
      .where(and(
        eq(lineupRevisions.leagueId, leagueId),
        eq(lineupRevisions.id, revisionId),
        eq(lineupRevisions.status, 'published'),
        eq(rosterRevisions.status, 'published'),
      ))
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

  async #recordLifecycle(
    transaction: Parameters<Parameters<StarworksDatabase['transaction']>[0]>[0],
    leagueId: string,
    request: RunnerLeaseUpdateRequest,
    stationId: string,
    eventType: 'renewed' | 'started' | 'completed' | 'cancelled' | 'failed',
  ) {
    await transaction.insert(attemptLifecycleEvents).values({
      eventType,
      failureKind: eventType === 'failed' ? request.failureKind : null,
      leagueId,
      matchAttemptId: request.attemptId,
      observedAt: new Date(request.observedAt),
      runnerStationId: stationId,
    })
  }

  #hashesEqual(candidate: string, expected: string): boolean {
    let left = Buffer.from(candidate, 'utf8')
    let right = Buffer.from(expected, 'utf8')
    return left.length === right.length && timingSafeEqual(left, right)
  }

  #idempotentStatus(action: RunnerLeaseUpdateRequest['action'], current: string) {
    if (action === 'started' && current === 'running') return 'running' as const
    if (action === 'complete' && current === 'provisional') return 'provisional' as const
    if (action === 'cancel' && current === 'cancelled') return 'cancelled' as const
    if (action === 'fail' && current === 'failed') return 'failed' as const
    return null
  }

  #leaseExpiry(now: Date): Date {
    return new Date(now.getTime() + this.#leaseSeconds * 1_000)
  }

  #parse<Output>(schema: { safeParse(value: unknown): { success: true; data: Output } | { success: false } }, value: unknown): Output {
    let parsed = schema.safeParse(value)
    if (!parsed.success) throw new PlatformError('Runner control message is invalid', 'invalid_input')
    return parsed.data
  }

  #requireBoundStation(authenticated: AuthenticatedRunnerCredential, requestedRunnerId: string): string {
    if (!authenticated.stationId || authenticated.stationId !== requestedRunnerId) {
      throw new PlatformError('Runner credential is not bound to this station', 'unauthorized')
    }
    return authenticated.stationId
  }
}

export function runnerVersionStatus(
  installed: string,
  minimum: string,
  recommended: string,
): 'current' | 'update-available' | 'update-required' {
  if (compareVersions(installed, minimum) < 0) return 'update-required'
  if (compareVersions(installed, recommended) < 0) return 'update-available'
  return 'current'
}

function compareVersions(left: string, right: string): number {
  let leftParts = left.split('.').map(Number)
  let rightParts = right.split('.').map(Number)
  for (let index = 0; index < 3; index += 1) {
    let difference = leftParts[index]! - rightParts[index]!
    if (difference !== 0) return Math.sign(difference)
  }
  return 0
}
