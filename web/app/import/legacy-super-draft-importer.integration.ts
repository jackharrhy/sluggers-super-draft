import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'

import { and, count, eq } from 'drizzle-orm'

import { createDatabase } from '../platform/database/connection.ts'
import { PostgresPlatformRepository } from '../platform/database/postgres-repository.ts'
import {
  auditRecords,
  conferences,
  discordIdentities,
  importReferences,
  leagueTeams,
  leagues,
  people,
  seasons,
  venues,
} from '../platform/database/schema.ts'
import { PlatformService } from '../platform/service.ts'
import { LegacySuperDraftImporter } from './legacy-super-draft-importer.ts'
import type { LegacySuperDraftSnapshot } from './legacy-super-draft-snapshot.ts'

let databaseUrl = process.env.STARWORKS_TEST_DATABASE_URL

test(
  'legacy imports are dry-runnable, tenant scoped, and idempotent',
  { skip: databaseUrl ? false : 'STARWORKS_TEST_DATABASE_URL is not set' },
  async () => {
    let connection = createDatabase(databaseUrl!, { max: 1 })
    let repository = new PostgresPlatformRepository(connection.database)
    let discriminator = randomUUID()
    let admin = await repository.bootstrapSiteAdmin({
      discordUserId: uniqueDiscordId(),
      discordUsername: `import-admin-${discriminator}`,
      displayName: 'Import Admin',
    })
    let service = new PlatformService(repository, {
      createToken: () => `import-invite-${discriminator}`,
    })
    let provisioned = await service.provisionLeague(admin, {
      name: 'Imported League',
      slug: `imported-${discriminator}`,
    })
    let secondDiscordId = uniqueDiscordId()
    let snapshot = fixtureSnapshot(admin.discordUserId, secondDiscordId)
    let importer = new LegacySuperDraftImporter(connection.database)
    let importedPersonId: string | null = null

    try {
      let dryRun = await importer.import({
        actorPersonId: admin.personId,
        apply: false,
        leagueId: provisioned.league.id,
        snapshot,
      })
      assert.equal(dryRun.applied, false)
      assert.deepEqual(dryRun.counts, { create: 6, reuse: 1, skip: 0 })
      assert.equal(await countForLeague(connection.database, seasons, provisioned.league.id), 0)
      assert.equal(await countForLeague(connection.database, importReferences, provisioned.league.id), 0)

      let applied = await importer.import({
        actorPersonId: admin.personId,
        apply: true,
        leagueId: provisioned.league.id,
        snapshot,
      })
      assert.equal(applied.applied, true)
      assert.deepEqual(applied.counts, { create: 6, reuse: 1, skip: 0 })
      assert.equal(await countForLeague(connection.database, seasons, provisioned.league.id), 1)
      assert.equal(await countForLeague(connection.database, conferences, provisioned.league.id), 1)
      assert.equal(await countForLeague(connection.database, venues, provisioned.league.id), 1)
      assert.equal(await countForLeague(connection.database, leagueTeams, provisioned.league.id), 2)
      assert.equal(await countForLeague(connection.database, importReferences, provisioned.league.id), 7)

      let [importedIdentity] = await connection.database
        .select({ personId: discordIdentities.personId })
        .from(discordIdentities)
        .where(eq(discordIdentities.discordUserId, secondDiscordId))
        .limit(1)
      assert.ok(importedIdentity)
      importedPersonId = importedIdentity.personId

      let rerun = await importer.import({
        actorPersonId: admin.personId,
        apply: true,
        leagueId: provisioned.league.id,
        snapshot,
      })
      assert.deepEqual(rerun.counts, { create: 0, reuse: 0, skip: 7 })
      assert.equal(await countForLeague(connection.database, leagueTeams, provisioned.league.id), 2)

      await assert.rejects(
        importer.import({
          actorPersonId: admin.personId,
          apply: false,
          leagueId: provisioned.league.id,
          snapshot: {
            ...snapshot,
            users: snapshot.users.map((user, index) =>
              index === 0 ? { ...user, name: 'Changed after import' } : user,
            ),
          },
        }),
        /explicit reconciliation is required/,
      )
    } finally {
      await connection.database
        .delete(auditRecords)
        .where(eq(auditRecords.targetId, provisioned.league.id))
      await connection.database
        .delete(leagueTeams)
        .where(eq(leagueTeams.leagueId, provisioned.league.id))
      await connection.database.delete(leagues).where(eq(leagues.id, provisioned.league.id))
      if (importedPersonId) {
        await connection.database.delete(people).where(eq(people.id, importedPersonId))
        await connection.database
          .delete(auditRecords)
          .where(eq(auditRecords.targetId, importedPersonId))
      }
      await connection.database.delete(people).where(eq(people.id, admin.personId))
      await connection.database
        .delete(auditRecords)
        .where(eq(auditRecords.targetId, admin.personId))
      await connection.close()
    }
  },
)

function fixtureSnapshot(
  existingDiscordId: string,
  newDiscordId: string,
): LegacySuperDraftSnapshot {
  return {
    conferences: [
      { color: '#ff0000', name: 'Fire', seasonSourceId: '1', sourceId: '10' },
    ],
    format: 'starworks.legacy-super-draft-snapshot.v1',
    season: { sourceId: '1', state: 'playing' },
    teams: [
      {
        abbreviation: 'ADM',
        color: '#ffffff',
        conferenceSourceId: '10',
        managerUserSourceId: '100',
        name: 'Admin Team',
        sourceId: '1000',
      },
      {
        abbreviation: 'NEW',
        color: null,
        conferenceSourceId: null,
        managerUserSourceId: '200',
        name: 'New Team',
        sourceId: '2000',
      },
    ],
    users: [
      {
        discordSnowflake: existingDiscordId,
        name: 'Existing Admin',
        role: 'admin',
        sourceId: '100',
      },
      {
        discordSnowflake: newDiscordId,
        name: 'New Manager',
        role: 'user',
        sourceId: '200',
      },
    ],
    venues: [{ name: 'Mario Stadium', sourceId: '50' }],
  }
}

async function countForLeague(
  database: ReturnType<typeof createDatabase>['database'],
  table: typeof seasons | typeof conferences | typeof venues | typeof leagueTeams | typeof importReferences,
  leagueId: string,
): Promise<number> {
  let [row] = await database
    .select({ count: count() })
    .from(table)
    .where(and(eq(table.leagueId, leagueId)))
  return row?.count ?? 0
}

function uniqueDiscordId(): string {
  let digits = randomUUID().replaceAll(/\D/g, '')
  return (digits + Date.now().toString()).slice(0, 18).padEnd(18, '8')
}
