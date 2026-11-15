import { createCookie } from 'remix/cookie'

import type { ConfigurationApplication } from '../../../configuration/service.ts'
import type { DiscordOAuthClient } from '../../../platform/discord-oauth.ts'
import { IdentityService } from '../../../platform/identity-service.ts'
import type { LeagueDetail, SessionIdentity } from '../../../platform/model.ts'
import type { PlatformRepository } from '../../../platform/repository.ts'
import type { AppRuntime } from '../../../platform/runtime.ts'
import { PlatformService } from '../../../platform/service.ts'

export const configurationTestIdentity: SessionIdentity = {
  discordUserId: '123456789012345678',
  discordUsername: 'league-admin',
  displayName: 'League Admin',
  isSiteAdmin: true,
  memberships: [],
  personId: '11111111-1111-4111-8111-111111111111',
}

export const configurationTestLeague: LeagueDetail = {
  id: '22222222-2222-4222-8222-222222222222',
  name: 'Shell League',
  publication: {
    draftVisible: false,
    leagueVisible: false,
    standingsVisible: false,
    statsVisible: false,
  },
  roles: ['owner'],
  slug: 'shell-league',
  status: 'active',
}

export function createConfigurationTestRuntime(configuration: ConfigurationApplication): AppRuntime {
  let repository: PlatformRepository = {
    async bootstrapSiteAdmin() { return configurationTestIdentity },
    async completeDiscordLogin() { return configurationTestIdentity },
    async consumeOAuthAttempt() { return null },
    async createOAuthAttempt() {},
    async createRunnerCredential() { return 'credential' },
    async findAccessibleLeague() { return configurationTestLeague },
    async findIdentityBySessionHash() { return configurationTestIdentity },
    async findPendingInvitationId() { return null },
    async listVisibleLeagues() { return [configurationTestLeague] },
    async provisionLeague() { return configurationTestLeague },
    async revokeRunnerCredential() { return true },
    async revokeSession() {},
    async setPublicationPolicy() {},
  }
  let discord: DiscordOAuthClient = {
    createAuthorizationUrl() { return new URL('https://discord.test/oauth2/authorize') },
    async exchangeCode() { throw new Error('Unexpected Discord exchange') },
  }
  let cookieOptions = {
    httpOnly: true,
    path: '/',
    sameSite: 'Lax' as const,
    secrets: ['configuration-controller-test'],
  }
  return {
    broadcast: {} as AppRuntime['broadcast'],
    configuration,
    content: {} as AppRuntime['content'],
    draft: {} as AppRuntime['draft'],
    identity: new IdentityService(repository, discord),
    leagueOperations: {} as AppRuntime['leagueOperations'],
    oauthCookie: createCookie('test_oauth', cookieOptions),
    operations: {} as AppRuntime['operations'],
    platform: new PlatformService(repository),
    runnerControl: {} as AppRuntime['runnerControl'],
    runnerAdmin: {} as AppRuntime['runnerAdmin'],
    sessionCookie: createCookie('test_session', cookieOptions),
    telemetry: {} as AppRuntime['telemetry'],
  }
}
