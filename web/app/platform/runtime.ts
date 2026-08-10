import type { Cookie } from 'remix/cookie'
import { createCookie } from 'remix/cookie'

import { ConfigurationService, type ConfigurationApplication } from '../configuration/service.ts'
import { createDatabase } from './database/connection.ts'
import { PostgresPlatformRepository } from './database/postgres-repository.ts'
import {
  DiscordApiOAuthClient,
  readDiscordOAuthConfiguration,
  type DiscordOAuthClient,
} from './discord-oauth.ts'
import { IdentityService } from './identity-service.ts'
import { PlatformService } from './service.ts'

export interface AppRuntime {
  configuration: ConfigurationApplication
  identity: IdentityService
  oauthCookie: Cookie
  platform: PlatformService
  sessionCookie: Cookie
}

let runtime: (AppRuntime & { close(): Promise<void> }) | undefined

export function getAppRuntime(): AppRuntime & { close(): Promise<void> } {
  if (runtime) return runtime
  let databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) throw new Error('DATABASE_URL is required')

  let connection = createDatabase(databaseUrl)
  let repository = new PostgresPlatformRepository(connection.database)
  let cookieOptions = createCookieOptions(process.env)
  let discord: DiscordOAuthClient
  try {
    discord = new DiscordApiOAuthClient(readDiscordOAuthConfiguration(process.env))
  } catch (error) {
    discord = new UnconfiguredDiscordClient(error)
  }

  runtime = {
    async close() {
      await connection.close()
      runtime = undefined
    },
    configuration: new ConfigurationService(connection.database),
    identity: new IdentityService(repository, discord),
    oauthCookie: createCookie('starworks_oauth', { ...cookieOptions, maxAge: 10 * 60 }),
    platform: new PlatformService(repository),
    sessionCookie: createCookie('starworks_session', {
      ...cookieOptions,
      maxAge: 30 * 24 * 60 * 60,
    }),
  }
  return runtime
}

export async function closeAppRuntime(): Promise<void> {
  await runtime?.close()
}

function createCookieOptions(environment: NodeJS.ProcessEnv) {
  let production = environment.NODE_ENV === 'production'
  let secrets = environment.SESSION_COOKIE_SECRETS?.split(',').map((value) => value.trim()).filter(Boolean)
  if (production && !secrets?.length) {
    throw new Error('SESSION_COOKIE_SECRETS is required in production')
  }
  return {
    httpOnly: true,
    path: '/',
    sameSite: 'Lax' as const,
    secrets: secrets?.length ? secrets : ['starworks-local-development-cookie-secret'],
    secure: production,
  }
}

class UnconfiguredDiscordClient implements DiscordOAuthClient {
  constructor(readonly configurationError: unknown) {}

  createAuthorizationUrl(): URL {
    throw this.configurationError
  }

  async exchangeCode(): Promise<never> {
    throw this.configurationError
  }
}
