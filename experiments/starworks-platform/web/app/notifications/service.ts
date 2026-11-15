import { and, asc, eq, inArray } from 'drizzle-orm'
import { z } from 'zod'

import type { StarworksDatabase } from '../platform/database/connection.ts'
import {
  auditRecords,
  discordNotificationOutbox,
  discordNotificationSettings,
} from '../platform/database/schema.ts'
import { PlatformError } from '../platform/errors.ts'
import type { SessionIdentity } from '../platform/model.ts'
import { administrativeRoles } from '../platform/repository.ts'
import type { DiscordNotificationClient } from './discord-client.ts'

const ChannelConfigurationSchema = z.strictObject({
  channelId: z.string().regex(/^\d{17,20}$/).nullable(),
})

const NotificationEventSchema = z.strictObject({
  dedupeKey: z.string().min(3).max(200),
  eventType: z.enum([
    'draft.pick_committed',
    'match.attempt_queued',
    'match.result_confirmed',
    'trade.proposed',
    'trade.applied',
  ]),
  message: z.string().trim().min(1).max(1800),
})

export interface NotificationDashboard {
  botConfigured: boolean
  channelId: string | null
  failed: number
  pending: number
  sent: number
}

export interface NotificationPublishResult {
  status: 'disabled' | 'sent' | 'queued' | 'failed'
  error?: string
}

export interface NotificationApplication {
  configure(
    identity: SessionIdentity | null,
    leagueId: string,
    input: unknown,
  ): Promise<void>
  dashboard(
    identity: SessionIdentity | null,
    leagueId: string,
  ): Promise<NotificationDashboard>
  publish(leagueId: string, input: unknown): Promise<NotificationPublishResult>
  retry(identity: SessionIdentity | null, leagueId: string): Promise<number>
}

export class NotificationService implements NotificationApplication {
  constructor(
    readonly database: StarworksDatabase,
    readonly discord: DiscordNotificationClient,
    readonly clock: () => Date = () => new Date(),
  ) {}

  async configure(
    identity: SessionIdentity | null,
    leagueId: string,
    input: unknown,
  ): Promise<void> {
    this.#requireAdmin(identity, leagueId)
    let parsed = ChannelConfigurationSchema.safeParse(input)
    if (!parsed.success) {
      throw new PlatformError('Discord channel ID must be a 17 to 20 digit snowflake', 'invalid_input')
    }
    let now = this.clock()
    await this.database.transaction(async (transaction) => {
      if (parsed.data.channelId) {
        await transaction.insert(discordNotificationSettings).values({
          channelId: parsed.data.channelId,
          configuredByPersonId: identity.personId,
          createdAt: now,
          leagueId,
          updatedAt: now,
        }).onConflictDoUpdate({
          target: discordNotificationSettings.leagueId,
          set: {
            channelId: parsed.data.channelId,
            configuredByPersonId: identity.personId,
            updatedAt: now,
          },
        })
      } else {
        await transaction
          .delete(discordNotificationSettings)
          .where(eq(discordNotificationSettings.leagueId, leagueId))
      }
      await transaction.insert(auditRecords).values({
        action: parsed.data.channelId
          ? 'discord_notifications.configured'
          : 'discord_notifications.disabled',
        actorPersonId: identity.personId,
        leagueId,
        metadata: parsed.data.channelId
          ? { channelId: parsed.data.channelId }
          : {},
        targetId: leagueId,
        targetType: 'league',
      })
    })
  }

  async dashboard(
    identity: SessionIdentity | null,
    leagueId: string,
  ): Promise<NotificationDashboard> {
    this.#requireMember(identity, leagueId)
    let [[setting], outbox] = await Promise.all([
      this.database
        .select({ channelId: discordNotificationSettings.channelId })
        .from(discordNotificationSettings)
        .where(eq(discordNotificationSettings.leagueId, leagueId))
        .limit(1),
      this.database
        .select({ status: discordNotificationOutbox.status })
        .from(discordNotificationOutbox)
        .where(eq(discordNotificationOutbox.leagueId, leagueId)),
    ])
    return {
      botConfigured: this.discord.configured,
      channelId: setting?.channelId ?? null,
      failed: outbox.filter((item) => item.status === 'failed').length,
      pending: outbox.filter((item) => item.status === 'pending').length,
      sent: outbox.filter((item) => item.status === 'sent').length,
    }
  }

  async publish(leagueId: string, input: unknown): Promise<NotificationPublishResult> {
    let parsed = NotificationEventSchema.safeParse(input)
    if (!parsed.success) return { status: 'failed', error: 'Notification event is invalid' }
    try {
      let [setting] = await this.database
        .select({ channelId: discordNotificationSettings.channelId })
        .from(discordNotificationSettings)
        .where(eq(discordNotificationSettings.leagueId, leagueId))
        .limit(1)
      if (!setting) return { status: 'disabled' }
      let now = this.clock()
      await this.database.insert(discordNotificationOutbox).values({
        createdAt: now,
        dedupeKey: parsed.data.dedupeKey,
        eventType: parsed.data.eventType,
        leagueId,
        message: parsed.data.message,
        updatedAt: now,
      }).onConflictDoNothing()
      if (!this.discord.configured) return { status: 'queued' }
      return await this.#deliver(leagueId, parsed.data.dedupeKey, setting.channelId)
    } catch (error) {
      return { status: 'failed', error: errorMessage(error) }
    }
  }

  async retry(identity: SessionIdentity | null, leagueId: string): Promise<number> {
    this.#requireAdmin(identity, leagueId)
    let [setting] = await this.database
      .select({ channelId: discordNotificationSettings.channelId })
      .from(discordNotificationSettings)
      .where(eq(discordNotificationSettings.leagueId, leagueId))
      .limit(1)
    if (!setting) throw new PlatformError('Discord notifications are not configured', 'conflict')
    if (!this.discord.configured) throw new PlatformError('Discord bot token is not configured', 'external_service')
    let queued = await this.database
      .select({ dedupeKey: discordNotificationOutbox.dedupeKey })
      .from(discordNotificationOutbox)
      .where(and(
        eq(discordNotificationOutbox.leagueId, leagueId),
        inArray(discordNotificationOutbox.status, ['pending', 'failed']),
      ))
      .orderBy(asc(discordNotificationOutbox.createdAt))
      .limit(25)
    let sent = 0
    for (let item of queued) {
      if ((await this.#deliver(leagueId, item.dedupeKey, setting.channelId)).status === 'sent') sent += 1
    }
    return sent
  }

  async #deliver(
    leagueId: string,
    dedupeKey: string,
    channelId: string,
  ): Promise<NotificationPublishResult> {
    let [record] = await this.database
      .select()
      .from(discordNotificationOutbox)
      .where(and(
        eq(discordNotificationOutbox.leagueId, leagueId),
        eq(discordNotificationOutbox.dedupeKey, dedupeKey),
      ))
      .limit(1)
    if (!record) return { status: 'failed', error: 'Notification outbox record disappeared' }
    if (record.status === 'sent') return { status: 'sent' }
    try {
      await this.discord.sendChannelMessage(channelId, record.message)
      await this.database.update(discordNotificationOutbox).set({
        attempts: record.attempts + 1,
        lastError: null,
        sentAt: this.clock(),
        status: 'sent',
        updatedAt: this.clock(),
      }).where(eq(discordNotificationOutbox.id, record.id))
      return { status: 'sent' }
    } catch (error) {
      let message = errorMessage(error).slice(0, 500)
      await this.database.update(discordNotificationOutbox).set({
        attempts: record.attempts + 1,
        lastError: message,
        status: 'failed',
        updatedAt: this.clock(),
      }).where(eq(discordNotificationOutbox.id, record.id))
      return { status: 'failed', error: message }
    }
  }

  #requireMember(
    identity: SessionIdentity | null,
    leagueId: string,
  ): asserts identity is SessionIdentity {
    if (!identity) throw new PlatformError('Sign in is required', 'unauthorized')
    if (!identity.isSiteAdmin && !identity.memberships.some((item) => item.leagueId === leagueId)) {
      throw new PlatformError('League membership is required', 'forbidden')
    }
  }

  #requireAdmin(
    identity: SessionIdentity | null,
    leagueId: string,
  ): asserts identity is SessionIdentity {
    this.#requireMember(identity, leagueId)
    let membership = identity.memberships.find((item) => item.leagueId === leagueId)
    if (!identity.isSiteAdmin && !membership?.roles.some((role) => administrativeRoles.has(role))) {
      throw new PlatformError('League administrator access is required', 'forbidden')
    }
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
