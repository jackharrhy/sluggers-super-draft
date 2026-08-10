import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'

import { asc, eq } from 'drizzle-orm'

import { createDatabase } from '../platform/database/connection.ts'
import {
  leagueMemberships,
  leagueTeams,
  leagues,
  people,
  rosterRevisions,
  rosterTransactions,
  seasons,
  tradeApprovals,
  tradeProposals,
} from '../platform/database/schema.ts'
import { PlatformError } from '../platform/errors.ts'
import type { SessionIdentity } from '../platform/model.ts'
import { LeagueOperationsService } from './service.ts'

let databaseUrl = process.env.STARWORKS_TEST_DATABASE_URL

test(
  'approved trades honor deadlines and create immutable roster revisions and receipts',
  { skip: databaseUrl ? false : 'STARWORKS_TEST_DATABASE_URL is not set' },
  async () => {
    let connection = createDatabase(databaseUrl!, { max: 4 })
    let fixture = await createFixture(connection.database)
    let now = new Date('2026-08-10T12:00:00Z')
    let service = new LeagueOperationsService(connection.database, { clock: () => now })

    try {
      await service.setDeadline(fixture.admin, fixture.leagueId, {
        closesAt: new Date('2026-08-10T13:00:00Z'),
        kind: 'trade',
        note: 'Opening-season trade deadline',
        seasonId: fixture.seasonId,
      })
      let proposal = await service.proposeTrade(fixture.marioManager, fixture.leagueId, {
        counterpartyCharacterIds: ['peach-0'],
        counterpartyTeamId: fixture.peachTeamId,
        message: 'One-for-one captain exchange',
        proposerCharacterIds: ['mario-0'],
        proposerTeamId: fixture.marioTeamId,
        seasonId: fixture.seasonId,
      })

      let beforeApproval = await service.dashboard(fixture.peachManager, fixture.leagueId)
      assert.equal(beforeApproval.trades[0]?.status, 'pending')
      assert.equal(beforeApproval.trades[0]?.approvals.length, 1)
      await service.reviewTrade(fixture.peachManager, fixture.leagueId, proposal.id, {
        decision: 'approved',
        reason: 'Accepted by Peach manager',
      })

      let rosterRows = await connection.database
        .select()
        .from(rosterRevisions)
        .where(eq(rosterRevisions.leagueId, fixture.leagueId))
        .orderBy(asc(rosterRevisions.teamId), asc(rosterRevisions.revisionNumber))
      assert.equal(rosterRows.length, 4)
      let mario = rosterRows.filter((roster) => roster.teamId === fixture.marioTeamId)
      let peach = rosterRows.filter((roster) => roster.teamId === fixture.peachTeamId)
      assert.deepEqual(mario[0]?.rosterCharacterIds, fixture.originalMarioRoster)
      assert.deepEqual(peach[0]?.rosterCharacterIds, fixture.originalPeachRoster)
      assert.ok(mario[1]?.rosterCharacterIds.includes('peach-0'))
      assert.ok(!mario[1]?.rosterCharacterIds.includes('mario-0'))
      assert.ok(peach[1]?.rosterCharacterIds.includes('mario-0'))
      assert.ok(!peach[1]?.rosterCharacterIds.includes('peach-0'))
      assert.equal(mario[1]?.basedOnRevisionId, mario[0]?.id)
      assert.equal(peach[1]?.basedOnRevisionId, peach[0]?.id)

      let receipts = await connection.database
        .select()
        .from(rosterTransactions)
        .where(eq(rosterTransactions.sourceId, proposal.id))
      assert.equal(receipts.length, 2)
      assert.ok(receipts.every((receipt) => receipt.fromBeforeRosterRevisionId && receipt.fromAfterRosterRevisionId))
      assert.ok(receipts.every((receipt) => receipt.toBeforeRosterRevisionId && receipt.toAfterRosterRevisionId))
      let approvals = await connection.database
        .select()
        .from(tradeApprovals)
        .where(eq(tradeApprovals.proposalId, proposal.id))
      assert.deepEqual(new Set(approvals.map((approval) => approval.teamId)), new Set([fixture.marioTeamId, fixture.peachTeamId]))
      let [applied] = await connection.database.select().from(tradeProposals).where(eq(tradeProposals.id, proposal.id))
      assert.equal(applied?.status, 'applied')

      let rejected = await service.proposeTrade(fixture.marioManager, fixture.leagueId, {
        counterpartyCharacterIds: ['peach-1'],
        counterpartyTeamId: fixture.peachTeamId,
        message: null,
        proposerCharacterIds: ['mario-1'],
        proposerTeamId: fixture.marioTeamId,
        seasonId: fixture.seasonId,
      })
      await service.reviewTrade(fixture.peachManager, fixture.leagueId, rejected.id, {
        decision: 'rejected',
        reason: 'Not the right fit',
      })
      let [rejectedRow] = await connection.database.select().from(tradeProposals).where(eq(tradeProposals.id, rejected.id))
      assert.equal(rejectedRow?.status, 'rejected')
      assert.equal((await connection.database.select().from(rosterRevisions).where(eq(rosterRevisions.leagueId, fixture.leagueId))).length, 4)

      now = new Date('2026-08-10T13:00:01Z')
      await assert.rejects(
        service.proposeTrade(fixture.marioManager, fixture.leagueId, {
          counterpartyCharacterIds: ['peach-2'],
          counterpartyTeamId: fixture.peachTeamId,
          message: null,
          proposerCharacterIds: ['mario-2'],
          proposerTeamId: fixture.marioTeamId,
          seasonId: fixture.seasonId,
        }),
        (error: unknown) => error instanceof PlatformError && error.code === 'conflict',
      )
    } finally {
      await cleanupFixture(connection, fixture.leagueId)
      await connection.close()
    }
  },
)

async function createFixture(database: ReturnType<typeof createDatabase>['database']) {
  let adminPersonId = randomUUID()
  let marioPersonId = randomUUID()
  let peachPersonId = randomUUID()
  let leagueId = randomUUID()
  let seasonId = randomUUID()
  let marioTeamId = randomUUID()
  let peachTeamId = randomUUID()
  let originalMarioRoster = Array.from({ length: 9 }, (_, index) => `mario-${index}`)
  let originalPeachRoster = Array.from({ length: 9 }, (_, index) => `peach-${index}`)
  await database.insert(people).values([
    { displayName: 'Operations Fixture Admin', id: adminPersonId, isSiteAdmin: true },
    { displayName: 'Operations Mario Manager', id: marioPersonId },
    { displayName: 'Operations Peach Manager', id: peachPersonId },
  ])
  await database.insert(leagues).values({
    createdByPersonId: adminPersonId,
    id: leagueId,
    name: 'Roster Operations Fixture',
    slug: `roster-operations-${leagueId}`,
  })
  await database.insert(leagueMemberships).values([
    { leagueId, personId: marioPersonId },
    { leagueId, personId: peachPersonId },
  ])
  await database.insert(seasons).values({ id: seasonId, leagueId, name: 'Season One', slug: 'season-one' })
  await database.insert(leagueTeams).values([
    { id: marioTeamId, leagueId, managerPersonId: marioPersonId, name: 'Mario Fireballs', seasonId, slug: 'mario-fireballs' },
    { id: peachTeamId, leagueId, managerPersonId: peachPersonId, name: 'Peach Monarchs', seasonId, slug: 'peach-monarchs' },
  ])
  await database.insert(rosterRevisions).values([
    {
      createdByPersonId: adminPersonId,
      id: randomUUID(),
      leagueId,
      publishedAt: new Date('2026-08-10T11:00:00Z'),
      revisionNumber: 1,
      rosterCharacterIds: originalMarioRoster,
      status: 'published',
      teamId: marioTeamId,
    },
    {
      createdByPersonId: adminPersonId,
      id: randomUUID(),
      leagueId,
      publishedAt: new Date('2026-08-10T11:00:00Z'),
      revisionNumber: 1,
      rosterCharacterIds: originalPeachRoster,
      status: 'published',
      teamId: peachTeamId,
    },
  ])
  let identity = (personId: string, displayName: string, isSiteAdmin = false): SessionIdentity => ({
    discordUserId: personId,
    discordUsername: displayName.toLowerCase().replaceAll(' ', '-'),
    displayName,
    isSiteAdmin,
    memberships: isSiteAdmin ? [] : [{
      leagueId,
      leagueName: 'Roster Operations Fixture',
      leagueSlug: `roster-operations-${leagueId}`,
      roles: ['manager'],
    }],
    personId,
  })
  return {
    admin: identity(adminPersonId, 'Operations Fixture Admin', true),
    leagueId,
    marioManager: identity(marioPersonId, 'Operations Mario Manager'),
    marioTeamId,
    originalMarioRoster,
    originalPeachRoster,
    peachManager: identity(peachPersonId, 'Operations Peach Manager'),
    peachTeamId,
    seasonId,
  }
}

async function cleanupFixture(
  connection: ReturnType<typeof createDatabase>,
  leagueId: string,
): Promise<void> {
  await connection.client.begin(async (transaction) => {
    await transaction`alter table roster_revisions disable trigger user`
    await transaction`delete from roster_transactions where league_id = ${leagueId}`
    await transaction`delete from trade_proposals where league_id = ${leagueId}`
    await transaction`delete from league_teams where league_id = ${leagueId}`
    await transaction`delete from leagues where id = ${leagueId}`
    await transaction`alter table roster_revisions enable trigger user`
    await transaction`delete from people where display_name in ('Operations Fixture Admin', 'Operations Mario Manager', 'Operations Peach Manager') and not exists (select 1 from league_memberships where person_id = people.id) and not exists (select 1 from leagues where created_by_person_id = people.id)`
  })
}
