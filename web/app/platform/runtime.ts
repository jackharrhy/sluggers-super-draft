import type { Cookie } from 'remix/cookie'
import { createCookie } from 'remix/cookie'

import { ConfigurationService, type ConfigurationApplication } from '../configuration/service.ts'
import { BroadcastService, type BroadcastApplication } from '../broadcast/service.ts'
import { createContentAssetStore } from '../content/object-store.ts'
import { ContentService, type ContentApplication } from '../content/service.ts'
import { DraftService, type DraftApplication } from '../draft/service.ts'
import { LeagueOperationsService, type LeagueOperationsApplication } from '../league-operations/service.ts'
import { RunnerControlService, type RunnerControlApplication } from '../runner/control-service.ts'
import { RunnerAdminService, type RunnerAdminApplication } from '../runner/admin-service.ts'
import { TelemetryService, type TelemetryApplication } from '../telemetry/service.ts'
import { OperationsService, type OperationsApplication } from '../operations/service.ts'
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
  broadcast: BroadcastApplication
  configuration: ConfigurationApplication
  content: ContentApplication
  draft: DraftApplication
  identity: IdentityService
  leagueOperations: LeagueOperationsApplication
  oauthCookie: Cookie
  operations: OperationsApplication
  platform: PlatformService
  runnerControl: RunnerControlApplication
  runnerAdmin: RunnerAdminApplication
  sessionCookie: Cookie
  telemetry: TelemetryApplication
}

let runtime: (AppRuntime & { close(): Promise<void> }) | undefined

export function getAppRuntime(): AppRuntime & { close(): Promise<void> } {
  if (runtime) return runtime
  let databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) throw new Error('DATABASE_URL is required')

  let connection = createDatabase(databaseUrl)
  let assets = createContentAssetStore(process.env)
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
    broadcast: new BroadcastService(connection.database),
    configuration: new ConfigurationService(connection.database),
    content: new ContentService(connection.database, assets),
    draft: new DraftService(connection.database),
    identity: new IdentityService(repository, discord),
    leagueOperations: new LeagueOperationsService(connection.database),
    oauthCookie: createCookie('starworks_oauth', { ...cookieOptions, maxAge: 10 * 60 }),
    operations: new OperationsService(connection.database, assets, {
      metricsToken: process.env.METRICS_BEARER_TOKEN,
    }),
    platform: new PlatformService(repository),
    runnerControl: new RunnerControlService(connection.database),
    runnerAdmin: new RunnerAdminService(connection.database),
    sessionCookie: createCookie('starworks_session', {
      ...cookieOptions,
      maxAge: 30 * 24 * 60 * 60,
    }),
    telemetry: new TelemetryService(connection.database),
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
