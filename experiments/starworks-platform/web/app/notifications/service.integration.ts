import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'

import { eq } from 'drizzle-orm'

import { createDatabase } from '../platform/database/connection.ts'
import {
  discordNotificationOutbox,
  leagueMembershipRoles,
  leagueMemberships,
  leagues,
  people,
} from '../platform/database/schema.ts'
import type { SessionIdentity } from '../platform/model.ts'
import type { DiscordNotificationClient } from './discord-client.ts'
import { NotificationService } from './service.ts'

let databaseUrl = process.env.STARWORKS_TEST_DATABASE_URL

test(
  'Discord notifications are tenant configured, durable, retryable, and deduplicated',
  { skip: databaseUrl ? false : 'STARWORKS_TEST_DATABASE_URL is not set' },
  async () => {
    let connection = createDatabase(databaseUrl!, { max: 1 })
    let personId = randomUUID()
    let leagueId = randomUUID()
    let client = new RecordingDiscordClient()
    let identity: SessionIdentity = {
      discordUserId: String(Date.now()),
      discordUsername: 'notification-admin',
      displayName: 'Notification Admin',
      isSiteAdmin: false,
      memberships: [{
        leagueId,
        leagueName: 'Notification League',
        leagueSlug: `notification-${leagueId}`,
        roles: ['league_admin'],
      }],
      personId,
    }
    try {
      await connection.database.insert(people).values({
        displayName: identity.displayName,
        id: personId,
      })
      await connection.database.insert(leagues).values({
        createdByPersonId: personId,
        id: leagueId,
        name: 'Notification League',
        slug: `notification-${leagueId}`,
      })
      await connection.database.insert(leagueMemberships).values({ leagueId, personId })
      await connection.database.insert(leagueMembershipRoles).values({
        grantedByPersonId: personId,
        leagueId,
        personId,
        role: 'league_admin',
      })
      let service = new NotificationService(
        connection.database,
        client,
        () => new Date('2026-08-10T12:00:00Z'),
      )

      assert.deepEqual(
        await service.publish(leagueId, event()),
        { status: 'disabled' },
      )
      await service.configure(identity, leagueId, { channelId: '123456789012345678' })
      client.failNext = true
      let failed = await service.publish(leagueId, event())
      assert.equal(failed.status, 'failed')
      assert.equal((await service.dashboard(identity, leagueId)).failed, 1)

      assert.equal(await service.retry(identity, leagueId), 1)
      assert.deepEqual(await service.dashboard(identity, leagueId), {
        botConfigured: true,
        channelId: '123456789012345678',
        failed: 0,
        pending: 0,
        sent: 1,
      })
      assert.deepEqual(await service.publish(leagueId, event()), { status: 'sent' })
      assert.equal(client.messages.length, 2)
      let outbox = await connection.database
        .select()
        .from(discordNotificationOutbox)
        .where(eq(discordNotificationOutbox.leagueId, leagueId))
      assert.equal(outbox.length, 1)
      assert.equal(outbox[0]?.attempts, 2)

      await service.configure(identity, leagueId, { channelId: null })
      assert.equal((await service.dashboard(identity, leagueId)).channelId, null)
    } finally {
      await connection.database.delete(leagues).where(eq(leagues.id, leagueId))
      await connection.database.delete(people).where(eq(people.id, personId))
      await connection.close()
    }
  },
)

function event() {
  return {
    dedupeKey: 'match-attempt:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    eventType: 'match.attempt_queued',
    message: 'A match is ready.',
  }
}

class RecordingDiscordClient implements DiscordNotificationClient {
  readonly configured = true
  failNext = false
  messages: Array<{ channelId: string; message: string }> = []

  async sendChannelMessage(channelId: string, message: string): Promise<void> {
    this.messages.push({ channelId, message })
    if (this.failNext) {
      this.failNext = false
      throw new Error('temporary Discord outage')
    }
  }
}
