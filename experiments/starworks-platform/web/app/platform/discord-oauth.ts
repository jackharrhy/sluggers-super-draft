import { z } from 'zod'

import type { DiscordProfile } from './model.ts'
import { PlatformError } from './errors.ts'

const tokenResponseSchema = z.object({
  access_token: z.string().min(1),
  token_type: z.string().min(1),
})

const discordUserSchema = z.object({
  avatar: z.string().nullable().optional(),
  global_name: z.string().nullable().optional(),
  id: z.string().regex(/^\d+$/),
  username: z.string().min(1),
})

export interface DiscordOAuthConfiguration {
  clientId: string
  clientSecret: string
  redirectUri: string
}

export interface DiscordOAuthClient {
  createAuthorizationUrl(input: {
    codeChallenge: string
    state: string
  }): URL
  exchangeCode(input: { code: string; codeVerifier: string }): Promise<DiscordProfile>
}

export class DiscordApiOAuthClient implements DiscordOAuthClient {
  constructor(
    readonly configuration: DiscordOAuthConfiguration,
    readonly fetcher: typeof fetch = fetch,
  ) {}

  createAuthorizationUrl(input: { codeChallenge: string; state: string }): URL {
    let url = new URL('https://discord.com/oauth2/authorize')
    url.search = new URLSearchParams({
      client_id: this.configuration.clientId,
      code_challenge: input.codeChallenge,
      code_challenge_method: 'S256',
      redirect_uri: this.configuration.redirectUri,
      response_type: 'code',
      scope: 'identify',
      state: input.state,
    }).toString()
    return url
  }

  async exchangeCode(input: { code: string; codeVerifier: string }): Promise<DiscordProfile> {
    let tokenResponse = await this.fetcher('https://discord.com/api/v10/oauth2/token', {
      body: new URLSearchParams({
        client_id: this.configuration.clientId,
        client_secret: this.configuration.clientSecret,
        code: input.code,
        code_verifier: input.codeVerifier,
        grant_type: 'authorization_code',
        redirect_uri: this.configuration.redirectUri,
      }),
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      method: 'POST',
    })
    if (!tokenResponse.ok) throw new PlatformError('Discord token exchange failed', 'unauthorized')
    let token = tokenResponseSchema.safeParse(await tokenResponse.json())
    if (!token.success) throw new PlatformError('Discord returned an invalid token', 'unauthorized')

    let profileResponse = await this.fetcher('https://discord.com/api/v10/users/@me', {
      headers: { authorization: `${token.data.token_type} ${token.data.access_token}` },
    })
    if (!profileResponse.ok) throw new PlatformError('Discord profile lookup failed', 'unauthorized')
    let profile = discordUserSchema.safeParse(await profileResponse.json())
    if (!profile.success) throw new PlatformError('Discord returned an invalid profile', 'unauthorized')

    return {
      avatarHash: profile.data.avatar ?? null,
      discordUserId: profile.data.id,
      displayName: profile.data.global_name ?? profile.data.username,
      username: profile.data.username,
    }
  }
}

export function readDiscordOAuthConfiguration(
  environment: NodeJS.ProcessEnv = process.env,
): DiscordOAuthConfiguration {
  let clientId = environment.DISCORD_CLIENT_ID
  let clientSecret = environment.DISCORD_CLIENT_SECRET
  let redirectUri = environment.DISCORD_REDIRECT_URI
  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error('DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET, and DISCORD_REDIRECT_URI are required')
  }
  return { clientId, clientSecret, redirectUri }
}
