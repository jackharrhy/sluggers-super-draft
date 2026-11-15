import { max, and, eq } from 'drizzle-orm'

import type { StarworksDatabase } from '../platform/database/connection.ts'
import {
  attemptLifecycleEvents,
  auditRecords,
  matches,
  matchAttempts,
} from '../platform/database/schema.ts'

type StarworksTransaction = Parameters<Parameters<StarworksDatabase['transaction']>[0]>[0]

interface FailureRecoveryInput {
  attemptId: string
  createId(): string
  createNonce(): string
  eventType: 'failed' | 'lease-expired' | 'station-revoked'
  failureKind: 'game-crash' | 'runner-crash' | 'bridge-failure' | 'build-failure'
  leagueId: string
  now: Date
  observedAt: Date
  runnerStationId: string | null
}

export interface FailureRecoveryResult {
  replacementAttemptId: string | null
  status: 'failed' | 'review'
}

/** Fail one immutable attempt and queue its one permitted clean retry. */
export async function failAttemptWithRecovery(
  transaction: StarworksTransaction,
  input: FailureRecoveryInput,
): Promise<FailureRecoveryResult | null> {
  let [attempt] = await transaction
    .select()
    .from(matchAttempts)
    .where(and(
      eq(matchAttempts.leagueId, input.leagueId),
      eq(matchAttempts.id, input.attemptId),
    ))
    .for('update')
    .limit(1)
  if (!attempt || !['leased', 'running'].includes(attempt.status)) return null

  await transaction.insert(attemptLifecycleEvents).values({
    eventType: input.eventType,
    failureKind: input.failureKind,
    leagueId: input.leagueId,
    matchAttemptId: input.attemptId,
    observedAt: input.observedAt,
    runnerStationId: input.runnerStationId,
  })

  if (attempt.retryCount >= 1) {
    await transaction.update(matchAttempts).set({
      failedAt: input.now,
      failureKind: input.failureKind,
      status: 'review',
    }).where(and(
      eq(matchAttempts.leagueId, input.leagueId),
      eq(matchAttempts.id, input.attemptId),
    ))
    await transaction.update(matches).set({
      status: 'provisional',
      updatedAt: input.now,
    }).where(and(
      eq(matches.leagueId, input.leagueId),
      eq(matches.id, attempt.matchId),
    ))
    await transaction.insert(auditRecords).values({
      action: 'match_attempt.review_required',
      actorPersonId: null,
      leagueId: input.leagueId,
      metadata: {
        failureKind: input.failureKind,
        reason: 'fresh-attempt-limit-reached',
        retryCount: attempt.retryCount,
      },
      targetId: input.attemptId,
      targetType: 'match_attempt',
    })
    return { replacementAttemptId: null, status: 'review' }
  }

  await transaction.update(matchAttempts).set({
    failedAt: input.now,
    failureKind: input.failureKind,
    status: 'failed',
  }).where(and(
    eq(matchAttempts.leagueId, input.leagueId),
    eq(matchAttempts.id, input.attemptId),
  ))
  await transaction
    .select({ id: matches.id })
    .from(matches)
    .where(and(
      eq(matches.leagueId, input.leagueId),
      eq(matches.id, attempt.matchId),
    ))
    .for('update')
    .limit(1)
  let [latest] = await transaction
    .select({ value: max(matchAttempts.attemptNumber) })
    .from(matchAttempts)
    .where(and(
      eq(matchAttempts.leagueId, input.leagueId),
      eq(matchAttempts.matchId, attempt.matchId),
    ))
  let replacementAttemptId = input.createId()
  let replacementAttemptNumber = (latest?.value ?? attempt.attemptNumber) + 1
  await transaction.insert(matchAttempts).values({
    attemptNonce: input.createNonce(),
    attemptNumber: replacementAttemptNumber,
    awayLineupRevisionId: attempt.awayLineupRevisionId,
    awayRosterRevisionId: attempt.awayRosterRevisionId,
    correlationId: input.createId(),
    contentPackRevisionId: attempt.contentPackRevisionId,
    createdAt: input.now,
    createdByPersonId: attempt.createdByPersonId,
    dynamicRuleOverrides: attempt.dynamicRuleOverrides,
    executionMode: attempt.executionMode,
    gameStadiumId: attempt.gameStadiumId,
    homeLineupRevisionId: attempt.homeLineupRevisionId,
    homeRosterRevisionId: attempt.homeRosterRevisionId,
    id: replacementAttemptId,
    leagueId: input.leagueId,
    matchId: attempt.matchId,
    replacesAttemptId: attempt.id,
    requiredGameBuildSha256: attempt.requiredGameBuildSha256,
    retryCount: attempt.retryCount + 1,
    rulesetRevisionId: attempt.rulesetRevisionId,
    statProfileRevisionId: attempt.statProfileRevisionId,
  })
  await transaction.insert(attemptLifecycleEvents).values({
    eventType: 'queued',
    leagueId: input.leagueId,
    matchAttemptId: replacementAttemptId,
    metadata: { automaticRetry: true, replacesAttemptId: attempt.id },
    observedAt: input.now,
  })
  await transaction.update(matches).set({
    status: 'scheduled',
    updatedAt: input.now,
  }).where(and(
    eq(matches.leagueId, input.leagueId),
    eq(matches.id, attempt.matchId),
  ))
  await transaction.insert(auditRecords).values({
    action: 'match_attempt.retry_queued',
    actorPersonId: null,
    leagueId: input.leagueId,
    metadata: {
      attemptNumber: replacementAttemptNumber,
      failureKind: input.failureKind,
      replacesAttemptId: attempt.id,
    },
    targetId: replacementAttemptId,
    targetType: 'match_attempt',
  })
  return { replacementAttemptId, status: 'failed' }
}
