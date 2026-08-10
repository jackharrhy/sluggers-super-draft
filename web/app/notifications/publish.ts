import type { NotificationApplication } from './service.ts'

interface NotificationLog {
  error(event: string, error: unknown, fields?: Record<string, unknown>): void
  info(event: string, fields?: Record<string, unknown>): void
}

export async function publishBestEffort(
  notifications: NotificationApplication | null,
  leagueId: string,
  event: { dedupeKey: string; eventType: string; message: string },
  log: NotificationLog,
): Promise<void> {
  if (!notifications) return
  try {
    let result = await notifications.publish(leagueId, event)
    log.info('discord.notification', { notificationStatus: result.status })
  } catch (error) {
    log.error('discord.notification.failed', error)
  }
}
