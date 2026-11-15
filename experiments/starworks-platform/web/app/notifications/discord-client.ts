import { PlatformError } from '../platform/errors.ts'

export interface DiscordNotificationClient {
  readonly configured: boolean
  sendChannelMessage(channelId: string, message: string): Promise<void>
}

export class DiscordApiNotificationClient implements DiscordNotificationClient {
  readonly configured = true

  constructor(
    readonly botToken: string,
    readonly fetchImplementation: typeof fetch = fetch,
    readonly timeoutMilliseconds = 10_000,
  ) {
    if (!botToken.trim()) throw new Error('Discord bot token is required')
  }

  async sendChannelMessage(channelId: string, message: string): Promise<void> {
    let response = await this.fetchImplementation(
      `https://discord.com/api/v10/channels/${encodeURIComponent(channelId)}/messages`,
      {
        body: JSON.stringify({
          allowed_mentions: { parse: [] },
          content: message,
        }),
        headers: {
          authorization: `Bot ${this.botToken}`,
          'content-type': 'application/json',
          'user-agent': 'Starworks (https://github.com/jackharrhy/sluggers-super-draft, 0.1.0)',
        },
        method: 'POST',
        signal: AbortSignal.timeout(this.timeoutMilliseconds),
      },
    )
    if (!response.ok) {
      throw new PlatformError(
        `Discord notification returned HTTP ${response.status}`,
        'external_service',
      )
    }
  }
}

export class DisabledDiscordNotificationClient implements DiscordNotificationClient {
  readonly configured = false

  async sendChannelMessage(): Promise<void> {
    throw new PlatformError('Discord bot notifications are not configured', 'external_service')
  }
}

export function createDiscordNotificationClient(
  environment: NodeJS.ProcessEnv,
): DiscordNotificationClient {
  let token = environment.DISCORD_BOT_TOKEN?.trim()
  return token
    ? new DiscordApiNotificationClient(token)
    : new DisabledDiscordNotificationClient()
}
