import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'

import { eq } from 'drizzle-orm'

import { PlatformError } from './errors.ts'
import { createDatabase } from './database/connection.ts'
import { PostgresPlatformRepository } from './database/postgres-repository.ts'
import { auditRecords, discordIdentities, leagues, people, sessions } from './database/schema.ts'
import { hashSecret } from './security.ts'
import { PlatformService } from './service.ts'

let databaseUrl = process.env.STARWORKS_TEST_DATABASE_URL

test(
  'site-admin provisioning is private by default and authorization is tenant scoped',
  { skip: databaseUrl ? false : 'STARWORKS_TEST_DATABASE_URL is not set' },
  async () => {
    let connection = createDatabase(databaseUrl!, { max: 1 })
    let repository = new PostgresPlatformRepository(connection.database)
    let discriminator = randomUUID()
    let slug = `private-${discriminator}`
    let token = `invite-${discriminator}`
    let admin = await repository.bootstrapSiteAdmin({
      discordUserId: uniqueDiscordId(),
      discordUsername: `admin-${discriminator}`,
      displayName: 'Site Admin',
    })
    let service = new PlatformService(repository, {
      clock: () => new Date('2026-08-10T12:00:00Z'),
      createToken: () => token,
    })

    try {
      let provisioned = await service.provisionLeague(admin, { name: 'Private League', slug })
      assert.equal(provisioned.invitationToken, token)
      assert.equal(provisioned.league.publication.leagueVisible, false)
      assert.equal(await service.viewLeague(slug, null), null)
      assert.equal(
        (await service.listVisibleLeagues(null)).some((league) => league.id === provisioned.league.id),
        false,
      )

      let refreshedAdmin = await repository.bootstrapSiteAdmin({
        discordUserId: admin.discordUserId,
        discordUsername: admin.discordUsername,
        displayName: admin.displayName,
      })
      assert.deepEqual(refreshedAdmin.memberships[0]?.roles, ['owner'])

      let [outsider] = await connection.database
        .insert(people)
        .values({ displayName: 'Outsider' })
        .returning({ id: people.id })
      assert.ok(outsider)
      await connection.database.insert(discordIdentities).values({
        discordUserId: uniqueDiscordId(),
        personId: outsider.id,
        username: `outsider-${discriminator}`,
      })
      let rawSession = `session-${discriminator}`
      await connection.database.insert(sessions).values({
        expiresAt: new Date('2026-08-11T12:00:00Z'),
        personId: outsider.id,
        tokenHash: hashSecret(rawSession),
      })
      let outsiderIdentity = await service.resolveSession(rawSession)
      assert.ok(outsiderIdentity)

      await assert.rejects(
        service.setPublicationPolicy(outsiderIdentity, provisioned.league.id, {
          draftVisible: false,
          leagueVisible: true,
          standingsVisible: false,
          statsVisible: false,
        }),
        (error: unknown) => error instanceof PlatformError && error.code === 'forbidden',
      )

      await service.setPublicationPolicy(refreshedAdmin, provisioned.league.id, {
        draftVisible: false,
        leagueVisible: true,
        standingsVisible: false,
        statsVisible: false,
      })
      assert.equal((await service.viewLeague(slug, null))?.id, provisioned.league.id)

      await service.revokeSession(rawSession)
      assert.equal(await service.resolveSession(rawSession), null)
    } finally {
      let [league] = await connection.database
        .select({ createdByPersonId: leagues.createdByPersonId, id: leagues.id })
        .from(leagues)
        .where(eq(leagues.slug, slug))
        .limit(1)
      if (league) await connection.database.delete(leagues).where(eq(leagues.id, league.id))

      let identities = await connection.database
        .select({ personId: discordIdentities.personId })
        .from(discordIdentities)
        .where(eq(discordIdentities.username, `outsider-${discriminator}`))
      for (let identity of identities) {
        await connection.database.delete(people).where(eq(people.id, identity.personId))
      }
      await connection.database.delete(people).where(eq(people.id, admin.personId))
      await connection.database
        .delete(auditRecords)
        .where(eq(auditRecords.targetId, admin.personId))
      await connection.close()
    }
  },
)

function uniqueDiscordId(): string {
  let digits = randomUUID().replaceAll(/\D/g, '')
  return (digits + Date.now().toString()).slice(0, 18).padEnd(18, '7')
}
