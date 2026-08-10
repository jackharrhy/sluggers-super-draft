import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'

import { and, count, eq } from 'drizzle-orm'

import type { TelemetryEnvelope } from '@starworks/contracts'

import { createDatabase } from '../platform/database/connection.ts'
import {
  auditRecords,
  leagueMemberships,
  leagueTeams,
  leagues,
  lineupRevisions,
  matches,
  matchAttempts,
  people,
  publicationSettings,
  rosterRevisions,
  rulesetRevisions,
  rulesets,
  runnerCredentials,
  runnerLeases,
  runnerStations,
  seasons,
  statProfileRevisions,
  statProfiles,
  telemetryCorrections,
  telemetryDerivations,
  telemetryEvents,
} from '../platform/database/schema.ts'
import { PlatformError } from '../platform/errors.ts'
import type { SessionIdentity } from '../platform/model.ts'
import { hashSecret } from '../platform/security.ts'
import { BroadcastService } from '../broadcast/service.ts'
import { TelemetryService } from './service.ts'

let databaseUrl = process.env.STARWORKS_TEST_DATABASE_URL

test(
  'telemetry retries idempotently, regenerates box scores, audits corrections, and rebuilds standings',
  { skip: databaseUrl ? false : 'STARWORKS_TEST_DATABASE_URL is not set' },
  async () => {
    let connection = createDatabase(databaseUrl!, { max: 4 })
    let fixture = await createFixture(connection.database)
    let service = new TelemetryService(connection.database, {
      clock: () => new Date('2026-08-10T15:00:00Z'),
    })
    try {
      let events = representativeGame(fixture)
      let first = await service.ingest(fixture.credential, upload(fixture, events.slice(0, 5)))
      assert.deepEqual(first.acceptedSequences, [1, 2, 3, 4, 5])
      assert.equal(first.nextExpectedSequence, 6)
      let retry = await service.ingest(fixture.credential, upload(fixture, events.slice(0, 5)))
      assert.deepEqual(retry.duplicateSequences, [1, 2, 3, 4, 5])
      let second = await service.ingest(fixture.credential, upload(fixture, events.slice(5)))
      assert.deepEqual(second.acceptedSequences, [6, 7, 8, 9, 10])
      assert.equal(second.nextExpectedSequence, 11)

      let [rawCount] = await connection.database.select({ value: count() }).from(telemetryEvents).where(
        eq(telemetryEvents.matchAttemptId, fixture.attemptId),
      )
      assert.equal(rawCount?.value, 10)
      await assert.rejects(
        service.ingest(fixture.credential, upload(fixture, [{ ...events[0]!, frame: 999 }])),
        (error: unknown) => error instanceof PlatformError && error.code === 'conflict',
      )

      let derived = await service.derive(fixture.admin, fixture.leagueId, fixture.attemptId)
      assert.equal(derived.health.requiresReview, false)
      assert.equal(derived.boxScore.teams.away.runs, 2)
      assert.equal(derived.boxScore.teams.home.runs, 1)
      assert.equal(derived.boxScore.teams.away.hits, 2)
      assert.equal(derived.boxScore.characters['away-1']?.batting.homeRuns, 1)
      assert.equal(derived.boxScore.characters['away-2']?.running.runs, 1)
      let regenerated = await service.derive(fixture.admin, fixture.leagueId, fixture.attemptId)
      assert.deepEqual(regenerated.boxScore, derived.boxScore)
      assert.equal(regenerated.inputDigest, derived.inputDigest)
      let [derivationCount] = await connection.database.select({ value: count() }).from(telemetryDerivations).where(
        eq(telemetryDerivations.matchAttemptId, fixture.attemptId),
      )
      assert.equal(derivationCount?.value, 1)

      let corrected = await service.correct(fixture.admin, fixture.leagueId, fixture.attemptId, {
        afterValue: 3,
        beforeValue: 2,
        entityId: fixture.awayTeamId,
        entityType: 'team',
        reason: 'Official scorer awarded an additional hit',
        statPath: 'hits',
      })
      assert.equal(corrected.boxScore.teams.away.hits, 3)
      assert.equal(corrected.health.requiresReview, false)
      let [correction] = await connection.database.select().from(telemetryCorrections).where(
        eq(telemetryCorrections.matchAttemptId, fixture.attemptId),
      )
      assert.equal(correction?.actorPersonId, fixture.admin.personId)
      assert.equal(correction?.beforeValue, 2)
      assert.equal(correction?.afterValue, 3)
      assert.equal(correction?.reason, 'Official scorer awarded an additional hit')
      let [correctionAudit] = await connection.database.select().from(auditRecords).where(and(
        eq(auditRecords.leagueId, fixture.leagueId), eq(auditRecords.action, 'telemetry.corrected'),
      ))
      assert.equal(correctionAudit?.metadata.beforeValue, 2)
      assert.equal(correctionAudit?.metadata.afterValue, 3)

      let broadcast = new BroadcastService(connection.database, () => new Date('2026-08-10T15:01:00Z'))
      await assert.rejects(
        broadcast.publicOverlay(fixture.leagueSlug, fixture.matchId),
        (error: unknown) => error instanceof PlatformError && error.code === 'not_found',
      )
      await connection.database.update(publicationSettings).set({
        leagueVisible: true,
        statsVisible: true,
      }).where(eq(publicationSettings.leagueId, fixture.leagueId))
      let overlay = await broadcast.publicOverlay(fixture.leagueSlug, fixture.matchId)
      assert.equal(overlay.updatedAt, '2026-08-10T15:01:00.000Z')
      assert.equal(overlay.inning, 1)
      assert.equal(overlay.half, 'bottom')
      assert.equal(overlay.teams[0].runs, 2)
      assert.equal(overlay.teams[0].hits, 3)
      assert.equal(overlay.teams[1].runs, 1)
      assert.equal(overlay.players.find((player) => player.characterId === 'away-1')?.homeRuns, 1)
      assert.equal(overlay.recentEvents[0]?.eventType, 'game-ended')
      assert.equal('attemptNonce' in overlay, false)

      await service.confirm(fixture.admin, fixture.leagueId, fixture.attemptId)
      let [attempt] = await connection.database.select().from(matchAttempts).where(eq(matchAttempts.id, fixture.attemptId))
      let [match] = await connection.database.select().from(matches).where(eq(matches.id, fixture.matchId))
      assert.equal(attempt?.status, 'confirmed')
      assert.equal(attempt?.confirmedByPersonId, fixture.admin.personId)
      assert.equal(match?.status, 'confirmed')

      let totals = await service.rebuildSeason(fixture.admin, fixture.leagueId, fixture.seasonId)
      let rebuilt = await service.rebuildSeason(fixture.admin, fixture.leagueId, fixture.seasonId)
      assert.deepEqual(rebuilt, totals)
      assert.deepEqual(totals.standings.map(({ teamId, wins, losses }) => ({ teamId, wins, losses })), [
        { losses: 0, teamId: fixture.awayTeamId, wins: 1 },
        { losses: 1, teamId: fixture.homeTeamId, wins: 0 },
      ])
      assert.equal(totals.playerTotals['away-1']?.batting.homeRuns, 1)
    } finally {
      await cleanupFixture(connection, fixture.leagueId, fixture.admin.personId)
      await connection.close()
    }
  },
)

test(
  'missing or overflowing telemetry is visible and blocks confirmation',
  { skip: databaseUrl ? false : 'STARWORKS_TEST_DATABASE_URL is not set' },
  async () => {
    let connection = createDatabase(databaseUrl!, { max: 4 })
    let fixture = await createFixture(connection.database)
    let service = new TelemetryService(connection.database)
    try {
      let events = representativeGame(fixture)
      let warning: TelemetryEnvelope = {
        ...events[1]!,
        eventType: 'bridge-warning',
        frame: 500,
        payload: { code: 'overflow', droppedEvents: 4, message: 'Event ring overflowed' },
        sequence: 3,
      }
      let ended = { ...events[9]!, frame: 600, sequence: 4 }
      let uploaded = await service.ingest(fixture.credential, upload(fixture, [events[0]!, warning, ended]))
      assert.equal(uploaded.requiresReview, true)
      assert.ok(uploaded.issues.some((issue) => issue.includes('sequence gap')))
      assert.ok(uploaded.issues.some((issue) => issue.includes('overflowing')))
      let derived = await service.derive(fixture.admin, fixture.leagueId, fixture.attemptId)
      assert.equal(derived.health.requiresReview, true)
      await assert.rejects(
        service.confirm(fixture.admin, fixture.leagueId, fixture.attemptId),
        (error: unknown) => error instanceof PlatformError && error.code === 'conflict',
      )
      let [attempt] = await connection.database.select().from(matchAttempts).where(eq(matchAttempts.id, fixture.attemptId))
      assert.equal(attempt?.status, 'review')
    } finally {
      await cleanupFixture(connection, fixture.leagueId, fixture.admin.personId)
      await connection.close()
    }
  },
)

function representativeGame(fixture: Awaited<ReturnType<typeof createFixture>>): TelemetryEnvelope[] {
  let base = (sequence: number, frame: number): Omit<TelemetryEnvelope, 'eventType' | 'payload'> => ({
    adapterVersion: '0.1.0',
    attemptId: fixture.attemptId,
    attemptNonce: fixture.attemptNonce,
    correlationId: fixture.correlationId,
    frame,
    gameBuildSha256: 'a'.repeat(64),
    kind: 'telemetry-envelope',
    leagueId: fixture.leagueId,
    matchId: fixture.matchId,
    observationSource: 'bridge-hook',
    protocolVersion: 1,
    schemaVersion: 1,
    sequence,
  })
  return [
    { ...base(1, 1), eventType: 'game-started', payload: { awayTeamId: fixture.awayTeamId, homeTeamId: fixture.homeTeamId } },
    { ...base(2, 20), eventType: 'inning-started', payload: { half: 'top', inning: 1 } },
    { ...base(3, 30), eventType: 'batter-changed', payload: { characterId: 'away-1', side: 'away' } },
    { ...base(4, 31), eventType: 'pitcher-changed', payload: { characterId: 'home-1', side: 'home' } },
    { ...base(5, 100), eventType: 'plate-appearance-ended', payload: {
      batterCharacterId: 'away-2', battingSide: 'away', errorByCharacterId: null,
      outsRecorded: 0, pitcherCharacterId: 'home-1', result: 'single', rbi: 0,
      scorerCharacterIds: [],
    } },
    { ...base(6, 180), eventType: 'plate-appearance-ended', payload: {
      batterCharacterId: 'away-1', battingSide: 'away', errorByCharacterId: null,
      outsRecorded: 0, pitcherCharacterId: 'home-1', result: 'home-run', rbi: 2,
      scorerCharacterIds: ['away-2', 'away-1'],
    } },
    { ...base(7, 300), eventType: 'inning-started', payload: { half: 'bottom', inning: 1 } },
    { ...base(8, 400), eventType: 'plate-appearance-ended', payload: {
      batterCharacterId: 'home-1', battingSide: 'home', errorByCharacterId: null,
      outsRecorded: 0, pitcherCharacterId: 'away-1', result: 'home-run', rbi: 1,
      scorerCharacterIds: ['home-1'],
    } },
    { ...base(9, 480), eventType: 'plate-appearance-ended', payload: {
      batterCharacterId: 'home-2', battingSide: 'home', errorByCharacterId: null,
      outsRecorded: 1, pitcherCharacterId: 'away-1', result: 'out', rbi: 0,
      scorerCharacterIds: [],
    } },
    { ...base(10, 600), eventType: 'game-ended', payload: { awayRuns: 2, homeRuns: 1, reason: 'completed' } },
  ]
}

function upload(fixture: Awaited<ReturnType<typeof createFixture>>, events: TelemetryEnvelope[]) {
  return {
    attemptId: fixture.attemptId,
    events,
    kind: 'telemetry-upload-request',
    leaseId: fixture.leaseId,
    runnerId: fixture.stationId,
    schemaVersion: 1,
  }
}

async function createFixture(database: ReturnType<typeof createDatabase>['database']) {
  let adminPersonId = randomUUID()
  let leagueId = randomUUID()
  let seasonId = randomUUID()
  let homeTeamId = randomUUID()
  let awayTeamId = randomUUID()
  let homeRosterRevisionId = randomUUID()
  let awayRosterRevisionId = randomUUID()
  let homeLineupRevisionId = randomUUID()
  let awayLineupRevisionId = randomUUID()
  let profileId = randomUUID()
  let profileRevisionId = randomUUID()
  let rulesetId = randomUUID()
  let rulesetRevisionId = randomUUID()
  let matchId = randomUUID()
  let attemptId = randomUUID()
  let correlationId = randomUUID()
  let attemptNonce = `telemetry_${randomUUID().replaceAll('-', '')}`
  let stationId = randomUUID()
  let credentialId = randomUUID()
  let credentialSecret = `telemetry_secret_${randomUUID().replaceAll('-', '')}`
  let leaseId = randomUUID()
  let homeRoster = Array.from({ length: 9 }, (_, index) => `home-${index + 1}`)
  let awayRoster = Array.from({ length: 9 }, (_, index) => `away-${index + 1}`)
  await database.insert(people).values({ displayName: 'Telemetry Fixture Admin', id: adminPersonId, isSiteAdmin: true })
  let leagueSlug = `telemetry-${leagueId}`
  await database.insert(leagues).values({ createdByPersonId: adminPersonId, id: leagueId, name: 'Telemetry Fixture', slug: leagueSlug })
  await database.insert(publicationSettings).values({ leagueId })
  await database.insert(seasons).values({ id: seasonId, leagueId, name: 'Season One', slug: 'season-one', status: 'active' })
  await database.insert(leagueTeams).values([
    { id: homeTeamId, leagueId, name: 'Home Stars', seasonId, slug: 'home-stars' },
    { id: awayTeamId, leagueId, name: 'Away Comets', seasonId, slug: 'away-comets' },
  ])
  await database.insert(rosterRevisions).values([
    { createdByPersonId: adminPersonId, id: homeRosterRevisionId, leagueId, publishedAt: new Date(), revisionNumber: 1, rosterCharacterIds: homeRoster, status: 'published', teamId: homeTeamId },
    { createdByPersonId: adminPersonId, id: awayRosterRevisionId, leagueId, publishedAt: new Date(), revisionNumber: 1, rosterCharacterIds: awayRoster, status: 'published', teamId: awayTeamId },
  ])
  await database.insert(lineupRevisions).values([
    { createdByPersonId: adminPersonId, id: homeLineupRevisionId, leagueId, lineup: lineup(homeRoster), publishedAt: new Date(), revisionNumber: 1, rosterRevisionId: homeRosterRevisionId, status: 'published', teamId: homeTeamId },
    { createdByPersonId: adminPersonId, id: awayLineupRevisionId, leagueId, lineup: lineup(awayRoster), publishedAt: new Date(), revisionNumber: 1, rosterRevisionId: awayRosterRevisionId, status: 'published', teamId: awayTeamId },
  ])
  await database.insert(statProfiles).values({ id: profileId, leagueId, name: 'Stock', slug: 'stock' })
  await database.insert(statProfileRevisions).values({ characterValues: [], createdByPersonId: adminPersonId, definitions: [], id: profileRevisionId, leagueId, name: 'Stock', profileId, publishedAt: new Date(), revisionNumber: 1, status: 'published' })
  await database.insert(rulesets).values({ id: rulesetId, leagueId, name: 'League', slug: 'league' })
  await database.insert(rulesetRevisions).values({ createdByPersonId: adminPersonId, id: rulesetRevisionId, leagueId, name: 'League', publishedAt: new Date(), revisionNumber: 1, rulesetId, settings: [], status: 'published' })
  await database.insert(matches).values({ awayTeamId, createdByPersonId: adminPersonId, homeTeamId, id: matchId, leagueId, seasonId, status: 'provisional' })
  await database.insert(matchAttempts).values({
    attemptNonce, attemptNumber: 1, awayLineupRevisionId, awayRosterRevisionId,
    correlationId, createdByPersonId: adminPersonId, homeLineupRevisionId,
    homeRosterRevisionId, id: attemptId, leagueId, matchId,
    requiredGameBuildSha256: 'a'.repeat(64), rulesetRevisionId,
    statProfileRevisionId: profileRevisionId, status: 'provisional',
  })
  await database.insert(runnerStations).values({ capabilities: {
    adapterIds: ['sluggers-rmbe01'], architecture: 'arm64', dolphinVersion: null,
    features: ['telemetry-spool-v1'], operatingSystem: 'macos', runnerVersion: '0.1.0',
  }, id: stationId, leagueId, name: 'Telemetry Station' })
  await database.insert(runnerCredentials).values({ createdByPersonId: adminPersonId, id: credentialId, leagueId, name: 'Telemetry credential', scopes: ['telemetry:write'], secretHash: hashSecret(credentialSecret), stationId })
  await database.insert(runnerLeases).values({ expiresAt: new Date('2026-08-10T16:00:00Z'), id: leaseId, lastRenewedAt: new Date('2026-08-10T14:00:00Z'), leagueId, matchAttemptId: attemptId, releasedAt: new Date('2026-08-10T14:59:00Z'), runnerStationId: stationId, status: 'released' })
  let admin: SessionIdentity = {
    discordUserId: adminPersonId, discordUsername: 'telemetry-admin', displayName: 'Telemetry Fixture Admin',
    isSiteAdmin: true, memberships: [], personId: adminPersonId,
  }
  return {
    admin, attemptId, attemptNonce, awayTeamId, correlationId,
    credential: `starworks_runner_${credentialId}.${credentialSecret}`,
    homeTeamId, leagueId, leagueSlug, leaseId, matchId, seasonId, stationId,
  }
}

function lineup(roster: string[]) {
  let positions = ['P', 'C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF'] as const
  return {
    battingOrder: roster,
    bench: [],
    captainCharacterId: roster[0]!,
    fielding: positions.map((position, index) => ({ characterId: roster[index]!, position })),
    pitcherCharacterId: roster[0]!,
  }
}

async function cleanupFixture(
  connection: ReturnType<typeof createDatabase>,
  leagueId: string,
  adminPersonId: string,
): Promise<void> {
  await connection.client.begin(async (transaction) => {
    await transaction`alter table roster_revisions disable trigger user`
    await transaction`alter table lineup_revisions disable trigger user`
    await transaction`alter table stat_profile_revisions disable trigger user`
    await transaction`alter table ruleset_revisions disable trigger user`
    await transaction`delete from matches where league_id = ${leagueId}`
    await transaction`delete from leagues where id = ${leagueId}`
    await transaction`alter table roster_revisions enable trigger user`
    await transaction`alter table lineup_revisions enable trigger user`
    await transaction`alter table stat_profile_revisions enable trigger user`
    await transaction`alter table ruleset_revisions enable trigger user`
  })
  await connection.client`delete from people where id = ${adminPersonId}`
}
