import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'

import {
  RulesetRevisionSchema,
  StatProfileRevisionSchema,
  TeamLineupRevisionSchema,
  type RunnerRegistrationRequest,
} from '@starworks/contracts'
import { eq } from 'drizzle-orm'

import lineupFixture from '../../../contracts/fixtures/valid/team-lineup-revision.json' with { type: 'json' }
import rulesetFixture from '../../../contracts/fixtures/valid/ruleset-revision.json' with { type: 'json' }
import statProfileFixture from '../../../contracts/fixtures/valid/stat-profile-revision.json' with { type: 'json' }
import { createDatabase, type StarworksDatabase } from '../platform/database/connection.ts'
import {
  attemptLifecycleEvents,
  leagueTeams,
  leagues,
  lineupRevisions,
  matchAttempts,
  people,
  rosterRevisions,
  rulesetRevisions,
  rulesets,
  runnerCredentials,
  seasons,
  statProfileRevisions,
  statProfiles,
} from '../platform/database/schema.ts'
import type { SessionIdentity } from '../platform/model.ts'
import { PlatformError } from '../platform/errors.ts'
import { hashSecret } from '../platform/security.ts'
import { RunnerAdminService } from './admin-service.ts'
import { RunnerControlService } from './control-service.ts'

let databaseUrl = process.env.STARWORKS_TEST_DATABASE_URL

test(
  'runner registration, recovery, leasing, terminal updates, and expiry are durable',
  { skip: databaseUrl ? false : 'STARWORKS_TEST_DATABASE_URL is not set' },
  async () => {
    let connection = createDatabase(databaseUrl!, { max: 1 })
    try {
      await assert.rejects(
        connection.database.transaction(async (transaction) => {
          let database = transaction as unknown as StarworksDatabase
          let fixture = await createRunnerFixture(database)
          let now = new Date('2026-08-10T12:00:00Z')
          let admin = new RunnerAdminService(database, { clock: () => now })
          let control = new RunnerControlService(database, {
            clock: () => now,
            heartbeatSeconds: 10,
            leaseSeconds: 60,
          })
          let match = await admin.scheduleMatch(fixture.identity, fixture.leagueId, {
            awayTeamId: fixture.away.teamId,
            homeTeamId: fixture.home.teamId,
            scheduledAt: new Date('2026-08-10T12:30:00Z'),
            seasonId: fixture.seasonId,
          })
          let firstAttempt = await admin.queueAttempt(fixture.identity, fixture.leagueId, match.id, {
            awayLineupRevisionId: fixture.away.lineupRevisionId,
            dynamicRuleOverrides: { 'game.innings': 7 },
            homeLineupRevisionId: fixture.home.lineupRevisionId,
            requiredGameBuildSha256: 'a'.repeat(64),
            rulesetRevisionId: fixture.rulesetRevisionId,
            statProfileRevisionId: fixture.statProfileRevisionId,
          })

          let firstRegistration = await control.register(fixture.credentials.first.raw, registration('Desk one'))
          let secondRegistration = await control.register(fixture.credentials.second.raw, registration('Desk two'))
          assert.equal(firstRegistration.heartbeatSeconds, 10)
          assert.equal(firstRegistration.leaseSeconds, 60)
          assert.notEqual(firstRegistration.runnerId, secondRegistration.runnerId)

          let firstClaim = await control.claim(fixture.credentials.first.raw, claim(firstRegistration.runnerId))
          assert.ok(firstClaim.run)
          assert.equal(firstClaim.run.attemptId, firstAttempt.attemptId)
          assert.equal(firstClaim.run.teams[0].teamId, fixture.home.teamId)
          assert.equal(firstClaim.run.dynamicRuleOverrides['game.innings'], 7)
          assert.equal(firstClaim.run.statProfileRevisionId, fixture.statProfileRevisionId)
          assert.equal(firstClaim.run.rulesetRevisionId, fixture.rulesetRevisionId)
          let configuration = await control.configuration(
            fixture.credentials.first.raw,
            firstAttempt.attemptId,
          )
          assert.equal(configuration.attemptNonce, firstClaim.run.attemptNonce)
          assert.equal(configuration.statProfile.revisionId, fixture.statProfileRevisionId)
          assert.equal(configuration.ruleset.revisionId, fixture.rulesetRevisionId)
          assert.deepEqual(
            configuration.teams.map((team) => [team.side, team.lineup.teamId]),
            [['home', fixture.home.teamId], ['away', fixture.away.teamId]],
          )
          let operations = await admin.dashboard(fixture.identity, fixture.leagueId)
          assert.equal(operations.matches[0]?.attempts[0]?.status, 'leased')
          assert.equal(operations.stations.length, 2)
          let recoveryClaim = await control.claim(fixture.credentials.first.raw, claim(firstRegistration.runnerId))
          assert.deepEqual(recoveryClaim.run, firstClaim.run)
          let unavailableClaim = await control.claim(fixture.credentials.second.raw, claim(secondRegistration.runnerId))
          assert.equal(unavailableClaim.run, null)

          let heartbeat = await control.heartbeat(fixture.credentials.first.raw, {
            activeAttemptId: firstClaim.run.attemptId,
            activeLeaseId: firstClaim.run.lease.leaseId,
            kind: 'runner-heartbeat-request',
            lastCapturedSequence: 12,
            runnerId: firstRegistration.runnerId,
            schemaVersion: 1,
            sentAt: now.toISOString(),
            state: 'preparing',
          })
          assert.equal(heartbeat.accepted, true)

          let started = await control.updateLease(
            fixture.credentials.first.raw,
            leaseUpdate(firstRegistration.runnerId, firstClaim.run, 'started', now),
          )
          assert.equal(started.attemptStatus, 'running')
          assert.equal(started.expiresAt, '2026-08-10T12:01:00.000Z')
          now = new Date('2026-08-10T12:00:20Z')
          let renewed = await control.updateLease(
            fixture.credentials.first.raw,
            leaseUpdate(firstRegistration.runnerId, firstClaim.run, 'renew', now),
          )
          assert.equal(renewed.expiresAt, '2026-08-10T12:01:20.000Z')
          let completed = await control.updateLease(
            fixture.credentials.first.raw,
            leaseUpdate(firstRegistration.runnerId, firstClaim.run, 'complete', now),
          )
          assert.equal(completed.attemptStatus, 'provisional')
          let completedAgain = await control.updateLease(
            fixture.credentials.first.raw,
            leaseUpdate(firstRegistration.runnerId, firstClaim.run, 'complete', now),
          )
          assert.deepEqual(completedAgain, completed)

          let cancelledAttempt = await admin.queueAttempt(fixture.identity, fixture.leagueId, match.id, {
            awayLineupRevisionId: fixture.away.lineupRevisionId,
            dynamicRuleOverrides: {},
            homeLineupRevisionId: fixture.home.lineupRevisionId,
            requiredGameBuildSha256: 'b'.repeat(64),
            rulesetRevisionId: fixture.rulesetRevisionId,
            statProfileRevisionId: fixture.statProfileRevisionId,
          })
          assert.equal(cancelledAttempt.attemptNumber, 2)
          let cancellationClaim = await control.claim(fixture.credentials.first.raw, claim(firstRegistration.runnerId))
          assert.ok(cancellationClaim.run)
          assert.notEqual(cancellationClaim.run.attemptNonce, firstClaim.run.attemptNonce)
          let cancelled = await control.updateLease(
            fixture.credentials.first.raw,
            leaseUpdate(firstRegistration.runnerId, cancellationClaim.run, 'cancel', now),
          )
          assert.equal(cancelled.attemptStatus, 'cancelled')

          await admin.queueAttempt(fixture.identity, fixture.leagueId, match.id, {
            awayLineupRevisionId: fixture.away.lineupRevisionId,
            dynamicRuleOverrides: {},
            homeLineupRevisionId: fixture.home.lineupRevisionId,
            requiredGameBuildSha256: 'c'.repeat(64),
            rulesetRevisionId: fixture.rulesetRevisionId,
            statProfileRevisionId: fixture.statProfileRevisionId,
          })
          let expiringClaim = await control.claim(fixture.credentials.first.raw, claim(firstRegistration.runnerId))
          assert.ok(expiringClaim.run)
          now = new Date('2026-08-10T12:02:00Z')
          let afterExpiry = await control.claim(fixture.credentials.second.raw, claim(secondRegistration.runnerId))
          assert.equal(afterExpiry.run, null)
          let [expiredAttempt] = await database
            .select({ failureKind: matchAttempts.failureKind, status: matchAttempts.status })
            .from(matchAttempts)
            .where(eq(matchAttempts.id, expiringClaim.run!.attemptId))
          assert.deepEqual(expiredAttempt, { failureKind: 'runner-crash', status: 'failed' })

          let replacementAttempt = await admin.queueAttempt(fixture.identity, fixture.leagueId, match.id, {
            awayLineupRevisionId: fixture.away.lineupRevisionId,
            dynamicRuleOverrides: {},
            homeLineupRevisionId: fixture.home.lineupRevisionId,
            requiredGameBuildSha256: 'd'.repeat(64),
            rulesetRevisionId: fixture.rulesetRevisionId,
            statProfileRevisionId: fixture.statProfileRevisionId,
          })
          let replacementClaim = await control.claim(fixture.credentials.second.raw, claim(secondRegistration.runnerId))
          assert.equal(replacementClaim.run?.attemptId, replacementAttempt.attemptId)
          await admin.revokeStation(fixture.identity, fixture.leagueId, secondRegistration.runnerId)
          await assert.rejects(
            control.heartbeat(fixture.credentials.second.raw, {
              activeAttemptId: replacementAttempt.attemptId,
              activeLeaseId: replacementClaim.run!.lease.leaseId,
              kind: 'runner-heartbeat-request',
              lastCapturedSequence: null,
              runnerId: secondRegistration.runnerId,
              schemaVersion: 1,
              sentAt: now.toISOString(),
              state: 'running',
            }),
            (error: unknown) => error instanceof PlatformError && error.code === 'unauthorized',
          )

          let lifecycle = await database
            .select({ eventType: attemptLifecycleEvents.eventType })
            .from(attemptLifecycleEvents)
            .where(eq(attemptLifecycleEvents.leagueId, fixture.leagueId))
          assert.deepEqual(
            lifecycle.map((event) => event.eventType),
            ['queued', 'claimed', 'started', 'renewed', 'completed', 'queued', 'claimed', 'cancelled', 'queued', 'claimed', 'lease-expired', 'queued', 'claimed', 'station-revoked'],
          )
          throw new RollbackFixture()
        }),
        (error: unknown) => error instanceof RollbackFixture,
      )
    } finally {
      await connection.close()
    }
  },
)

async function createRunnerFixture(database: StarworksDatabase) {
  let source = TeamLineupRevisionSchema.parse(lineupFixture)
  let profileSource = StatProfileRevisionSchema.parse(statProfileFixture)
  let rulesetSource = RulesetRevisionSchema.parse(rulesetFixture)
  let personId = randomUUID()
  let leagueId = randomUUID()
  let seasonId = randomUUID()
  await database.insert(people).values({ displayName: 'Runner Admin', id: personId })
  await database.insert(leagues).values({
    createdByPersonId: personId,
    id: leagueId,
    name: 'Runner League',
    slug: `runner-${leagueId}`,
  })
  await database.insert(seasons).values({ id: seasonId, leagueId, name: 'Season', slug: 'season' })
  let profileId = randomUUID()
  let statProfileRevisionId = randomUUID()
  let rulesetId = randomUUID()
  let rulesetRevisionId = randomUUID()
  let publishedAt = new Date('2026-08-10T11:00:00Z')
  await database.insert(statProfiles).values({ id: profileId, leagueId, name: 'Stats', slug: 'stats' })
  await database.insert(statProfileRevisions).values({
    characterValues: profileSource.characterValues,
    createdByPersonId: personId,
    definitions: profileSource.definitions,
    id: statProfileRevisionId,
    leagueId,
    name: profileSource.name,
    profileId,
    publishedAt,
    revisionNumber: 1,
    status: 'published',
  })
  await database.insert(rulesets).values({ id: rulesetId, leagueId, name: 'Rules', slug: 'rules' })
  await database.insert(rulesetRevisions).values({
    createdByPersonId: personId,
    id: rulesetRevisionId,
    leagueId,
    name: rulesetSource.name,
    publishedAt,
    revisionNumber: 1,
    rulesetId,
    settings: rulesetSource.settings,
    status: 'published',
  })
  let home = await createTeamConfiguration(database, { leagueId, personId, seasonId }, 'home', source)
  let away = await createTeamConfiguration(database, { leagueId, personId, seasonId }, 'away', source)
  let firstSecret = 'first_runner_secret_abcdefghijklmnopqrstuvwxyz'
  let secondSecret = 'second_runner_secret_abcdefghijklmnopqrstuvwxyz'
  let firstCredentialId = randomUUID()
  let secondCredentialId = randomUUID()
  await database.insert(runnerCredentials).values([
    {
      createdByPersonId: personId,
      id: firstCredentialId,
      leagueId,
      name: 'First runner',
      scopes: ['heartbeat:write', 'runs:claim', 'runs:read'],
      secretHash: hashSecret(firstSecret),
    },
    {
      createdByPersonId: personId,
      id: secondCredentialId,
      leagueId,
      name: 'Second runner',
      scopes: ['heartbeat:write', 'runs:claim', 'runs:read'],
      secretHash: hashSecret(secondSecret),
    },
  ])
  return {
    away,
    credentials: {
      first: { raw: `starworks_runner_${firstCredentialId}.${firstSecret}` },
      second: { raw: `starworks_runner_${secondCredentialId}.${secondSecret}` },
    },
    home,
    identity: {
      discordUserId: '100000000000000010',
      discordUsername: 'runner-admin',
      displayName: 'Runner Admin',
      isSiteAdmin: true,
      memberships: [],
      personId,
    } satisfies SessionIdentity,
    leagueId,
    rulesetRevisionId,
    seasonId,
    statProfileRevisionId,
  }
}

async function createTeamConfiguration(
  database: StarworksDatabase,
  parent: { leagueId: string; personId: string; seasonId: string },
  slug: string,
  source: ReturnType<typeof TeamLineupRevisionSchema.parse>,
) {
  let teamId = randomUUID()
  let rosterRevisionId = randomUUID()
  let lineupRevisionId = randomUUID()
  let publishedAt = new Date('2026-08-10T11:00:00Z')
  await database.insert(leagueTeams).values({
    id: teamId,
    leagueId: parent.leagueId,
    name: `${slug} team`,
    seasonId: parent.seasonId,
    slug,
  })
  await database.insert(rosterRevisions).values({
    createdByPersonId: parent.personId,
    id: rosterRevisionId,
    leagueId: parent.leagueId,
    publishedAt,
    revisionNumber: 1,
    rosterCharacterIds: source.rosterCharacterIds,
    status: 'published',
    teamId,
  })
  await database.insert(lineupRevisions).values({
    createdByPersonId: parent.personId,
    id: lineupRevisionId,
    leagueId: parent.leagueId,
    lineup: source.lineup,
    publishedAt,
    revisionNumber: 1,
    rosterRevisionId,
    status: 'published',
    teamId,
  })
  return { lineupRevisionId, rosterRevisionId, teamId }
}

function registration(stationName: string): RunnerRegistrationRequest {
  return {
    capabilities: {
      adapterIds: ['sluggers-rmbe01'],
      architecture: 'arm64' as const,
      dolphinVersion: '2603',
      features: ['build-sluggers', 'launch-dolphin', 'runtime-bridge-v1'],
      operatingSystem: 'macos' as const,
      runnerVersion: '0.1.0',
    },
    kind: 'runner-registration-request' as const,
    schemaVersion: 1 as const,
    stationName,
  }
}

function claim(runnerId: string) {
  return { kind: 'runner-claim-request' as const, runnerId, schemaVersion: 1 as const }
}

function leaseUpdate(
  runnerId: string,
  run: NonNullable<Awaited<ReturnType<RunnerControlService['claim']>>['run']>,
  action: 'renew' | 'started' | 'complete' | 'cancel',
  observedAt: Date,
) {
  return {
    action,
    attemptId: run.attemptId,
    failureKind: null,
    kind: 'runner-lease-update-request' as const,
    leaseId: run.lease.leaseId,
    observedAt: observedAt.toISOString(),
    runnerId,
    schemaVersion: 1 as const,
  }
}

class RollbackFixture extends Error {}
