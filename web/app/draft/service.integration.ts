import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'

import { asc, eq } from 'drizzle-orm'

import { createDatabase } from '../platform/database/connection.ts'
import {
  gameCharacterChemistry,
  gameCharacters,
  leagueMemberships,
  leagueTeams,
  leagues,
  people,
  rosterRevisions,
  seasons,
  statProfileRevisions,
  statProfiles,
} from '../platform/database/schema.ts'
import { PlatformError } from '../platform/errors.ts'
import type { SessionIdentity } from '../platform/model.ts'
import { DraftService } from './service.ts'

let databaseUrl = process.env.STARWORKS_TEST_DATABASE_URL

test(
  'the authoritative draft serializes picks, recovers, reverses, auto-picks, and publishes rosters',
  { skip: databaseUrl ? false : 'STARWORKS_TEST_DATABASE_URL is not set' },
  async () => {
    let connection = createDatabase(databaseUrl!, { max: 6 })
    let fixture = await createFixture(connection.database)
    let now = new Date('2026-08-10T12:00:00Z')
    let service = new DraftService(connection.database, { clock: () => now })

    try {
      let created = await service.createDraft(fixture.admin, fixture.leagueId, {
        name: 'Season One Draft',
        orderMode: 'snake',
        pickSeconds: 30,
        rounds: 9,
        seasonId: fixture.seasonId,
        slotTeamIds: [fixture.marioTeamId, fixture.peachTeamId],
        statProfileRevisionId: fixture.statProfileRevisionId,
      })
      await service.startDraft(fixture.admin, fixture.leagueId, created.id)

      let simultaneous = await Promise.allSettled([
        service.makePick(fixture.marioManager, fixture.leagueId, created.id, {
          characterId: 'character-00',
          expectedVersion: 1,
        }),
        service.makePick(fixture.marioManager, fixture.leagueId, created.id, {
          characterId: 'character-01',
          expectedVersion: 1,
        }),
      ])
      assert.equal(simultaneous.filter((result) => result.status === 'fulfilled').length, 1)
      assert.equal(simultaneous.filter((result) => result.status === 'rejected').length, 1)

      let roomAfterReconnect = await new DraftService(connection.database, { clock: () => now })
        .getDraftRoom(fixture.peachManager, fixture.leagueId, created.id)
      assert.equal(roomAfterReconnect.picks.filter((pick) => pick.status === 'active').length, 1)
      assert.equal(roomAfterReconnect.currentTeamId, fixture.peachTeamId)
      assert.equal(roomAfterReconnect.characters.find((character) => character.characterId === 'character-01')?.displayName, 'Luigi')
      assert.deepEqual(
        roomAfterReconnect.characters.find((character) => character.characterId === 'character-01')?.chemistry,
        [{ characterId: 'character-02', displayName: 'Peach', relationship: 'positive' }],
      )

      await service.updateQueue(fixture.peachManager, fixture.leagueId, created.id, fixture.peachTeamId, {
        characterIds: ['character-02', 'character-03'],
      })
      now = new Date('2026-08-10T12:00:31Z')
      let automatic = await service.automaticPickAfterExpiry(fixture.admin, fixture.leagueId, created.id)
      assert.equal(automatic.characterId, 'character-02')
      assert.equal(automatic.source, 'automatic')

      await service.reverseLatestPick(fixture.admin, fixture.leagueId, created.id, 'Manager reported a queue mistake')
      let reversedRoom = await service.getDraftRoom(fixture.admin, fixture.leagueId, created.id)
      assert.equal(reversedRoom.draft.status, 'paused')
      assert.equal(reversedRoom.picks.at(-1)?.status, 'reversed')
      assert.ok(reversedRoom.events.some((event) => event.eventType === 'pick-reversed'))

      now = new Date('2026-08-10T12:00:41Z')
      await service.resumeDraft(fixture.admin, fixture.leagueId, created.id)
      let resumed = await service.getDraftRoom(fixture.admin, fixture.leagueId, created.id)
      assert.equal(resumed.draft.deadline?.toISOString(), '2026-08-10T12:01:11.000Z')
      await service.makePick(fixture.peachManager, fixture.leagueId, created.id, {
        characterId: 'character-03',
        expectedVersion: resumed.draft.version,
      })

      while (true) {
        let room = await service.getDraftRoom(fixture.admin, fixture.leagueId, created.id)
        if (room.draft.status === 'completed') break
        let next = room.characters[0]
        assert.ok(next)
        await service.makePick(fixture.admin, fixture.leagueId, created.id, {
          characterId: next.characterId,
          expectedVersion: room.draft.version,
          reason: 'Commissioner test completion',
        })
      }

      let completed = await service.getDraftRoom(fixture.admin, fixture.leagueId, created.id)
      assert.equal(completed.draft.status, 'completed')
      assert.equal(completed.picks.filter((pick) => pick.status === 'active').length, 18)
      assert.equal(completed.picks.filter((pick) => pick.status === 'reversed').length, 1)
      assert.deepEqual(
        completed.events.map((event) => event.sequence),
        Array.from({ length: completed.events.length }, (_, index) => index + 1),
      )

      let rosters = await connection.database
        .select()
        .from(rosterRevisions)
        .where(eq(rosterRevisions.leagueId, fixture.leagueId))
        .orderBy(asc(rosterRevisions.teamId))
      assert.equal(rosters.length, 2)
      assert.ok(rosters.every((roster) => roster.status === 'published'))
      assert.ok(rosters.every((roster) => roster.rosterCharacterIds.length === 9))
      assert.equal(new Set(rosters.flatMap((roster) => roster.rosterCharacterIds)).size, 18)

      await assert.rejects(
        service.makePick(fixture.admin, fixture.leagueId, created.id, { characterId: 'character-19' }),
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
  let profileId = randomUUID()
  let statProfileRevisionId = randomUUID()
  await database.insert(people).values([
    { displayName: 'Draft Admin', id: adminPersonId, isSiteAdmin: true },
    { displayName: 'Mario Manager', id: marioPersonId },
    { displayName: 'Peach Manager', id: peachPersonId },
  ])
  await database.insert(leagues).values({
    createdByPersonId: adminPersonId,
    id: leagueId,
    name: 'Draft Integration League',
    slug: `draft-integration-${leagueId}`,
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
  await database.insert(statProfiles).values({ id: profileId, leagueId, name: 'Draft Stats', slug: 'draft-stats' })
  await database.insert(statProfileRevisions).values({
    characterValues: Array.from({ length: 20 }, (_, index) => ({
      characterId: `character-${String(index).padStart(2, '0')}`,
      values: { batting: 50 + index, pitching: 40 + index },
    })),
    createdByPersonId: adminPersonId,
    definitions: [],
    id: statProfileRevisionId,
    leagueId,
    name: 'Draft Stats v1',
    profileId,
    publishedAt: new Date('2026-08-10T11:00:00Z'),
    revisionNumber: 1,
    status: 'published',
  })
  await database.insert(gameCharacters).values([
    { characterId: 'character-00', displayName: 'Mario', gameId: 'RMBE01', isCaptain: true },
    { characterId: 'character-01', displayName: 'Luigi', gameId: 'RMBE01', isCaptain: true },
    { characterId: 'character-02', displayName: 'Peach', gameId: 'RMBE01', isCaptain: true },
  ]).onConflictDoNothing()
  await database.insert(gameCharacterChemistry).values({
    characterAId: 'character-01',
    characterBId: 'character-02',
    gameId: 'RMBE01',
    relationship: 'positive',
    source: 'verified-test-fixture',
  }).onConflictDoNothing()

  let identity = (personId: string, displayName: string): SessionIdentity => ({
    discordUserId: personId,
    discordUsername: displayName.toLowerCase().replaceAll(' ', '-'),
    displayName,
    isSiteAdmin: personId === adminPersonId,
    memberships: personId === adminPersonId ? [] : [{
      leagueId,
      leagueName: 'Draft Integration League',
      leagueSlug: `draft-integration-${leagueId}`,
      roles: ['manager'],
    }],
    personId,
  })
  return {
    admin: identity(adminPersonId, 'Draft Admin'),
    leagueId,
    marioManager: identity(marioPersonId, 'Mario Manager'),
    marioTeamId,
    peachManager: identity(peachPersonId, 'Peach Manager'),
    peachTeamId,
    seasonId,
    statProfileRevisionId,
  }
}

async function cleanupFixture(
  connection: ReturnType<typeof createDatabase>,
  leagueId: string,
): Promise<void> {
  await connection.client.begin(async (transaction) => {
    await transaction`alter table stat_profile_revisions disable trigger user`
    await transaction`alter table roster_revisions disable trigger user`
    await transaction`delete from drafts where league_id = ${leagueId}`
    await transaction`delete from league_teams where league_id = ${leagueId}`
    await transaction`delete from leagues where id = ${leagueId}`
    await transaction`delete from game_character_chemistry where source = 'verified-test-fixture'`
    await transaction`delete from game_characters where game_id = 'RMBE01' and character_id in ('character-00', 'character-01', 'character-02')`
    await transaction`alter table roster_revisions enable trigger user`
    await transaction`alter table stat_profile_revisions enable trigger user`
    await transaction`delete from people where display_name in ('Draft Admin', 'Mario Manager', 'Peach Manager') and not exists (
      select 1 from league_memberships where person_id = people.id
    )`
  })
}
