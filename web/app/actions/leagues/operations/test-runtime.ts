import { createCookie } from 'remix/cookie'

import type { ConfigurationApplication } from '../../../configuration/service.ts'
import type { LeagueOperationsApplication, LeagueOperationsDashboard } from '../../../league-operations/service.ts'
import type { NotificationApplication } from '../../../notifications/service.ts'
import type { DiscordOAuthClient } from '../../../platform/discord-oauth.ts'
import { IdentityService } from '../../../platform/identity-service.ts'
import type { LeagueDetail, SessionIdentity } from '../../../platform/model.ts'
import type { PlatformRepository } from '../../../platform/repository.ts'
import type { AppRuntime } from '../../../platform/runtime.ts'
import { PlatformService } from '../../../platform/service.ts'
import type {
  RunnerAdminApplication,
  RunnerMatchDashboard,
  RunnerOperationsDashboard,
  RunnerStationDashboard,
} from '../../../runner/admin-service.ts'
import type { TelemetryApplication } from '../../../telemetry/service.ts'

export const identity: SessionIdentity = {
  discordUserId: '123456789012345678',
  discordUsername: 'operations-admin',
  displayName: 'Operations Admin',
  isSiteAdmin: true,
  memberships: [],
  personId: '11111111-1111-4111-8111-111111111111',
}

export const league: LeagueDetail = {
  id: '22222222-2222-4222-8222-222222222222',
  name: 'Shell League',
  publication: { draftVisible: false, leagueVisible: false, standingsVisible: false, statsVisible: false },
  roles: ['owner'],
  slug: 'shell-league',
  status: 'active',
}

export const runnerDashboard: RunnerOperationsDashboard = {
  audit: [{
    action: 'runner_station.revoked',
    actorDisplayName: 'Commissioner Mario',
    metadata: {},
    occurredAt: new Date('2026-08-10T20:00:00Z'),
    targetId: '33333333-3333-4333-8333-333333333333',
    targetType: 'runner_station',
  }],
  contentPacks: [],
  defaultGameBuildSha256: null,
  matches: [],
  rulesets: [],
  seasons: [],
  stations: [],
  statProfiles: [],
  venues: [],
}

const runnerMatchDashboard: RunnerMatchDashboard = {
  contentPacks: runnerDashboard.contentPacks,
  defaultGameBuildSha256: runnerDashboard.defaultGameBuildSha256,
  matches: runnerDashboard.matches,
  rulesets: runnerDashboard.rulesets,
  seasons: runnerDashboard.seasons,
  statProfiles: runnerDashboard.statProfiles,
  venues: runnerDashboard.venues,
}

const runnerStationDashboard: RunnerStationDashboard = {
  audit: runnerDashboard.audit,
  stations: runnerDashboard.stations,
}

export const leagueOperationsDashboard: LeagueOperationsDashboard = {
  deadlines: [],
  seasons: [],
  trades: [],
}

export function createOperationsRuntime(overrides: {
  leagueOperations?: LeagueOperationsApplication
  notifications?: NotificationApplication
  runnerAdmin?: RunnerAdminApplication
  setPublicationPolicy?: PlatformRepository['setPublicationPolicy']
  telemetry?: TelemetryApplication
} = {}): AppRuntime {
  let repository: PlatformRepository = {
    async bootstrapSiteAdmin() { return identity },
    async completeDiscordLogin() { return identity },
    async consumeOAuthAttempt() { return null },
    async createOAuthAttempt() {},
    async createRunnerCredential() { return '77777777-7777-4777-8777-777777777777' },
    async findAccessibleLeague() { return league },
    async findIdentityBySessionHash() { return identity },
    async findPendingInvitationId() { return null },
    async listVisibleLeagues() { return [league] },
    async provisionLeague() { return league },
    async revokeRunnerCredential() { return true },
    async revokeSession() {},
    setPublicationPolicy: overrides.setPublicationPolicy ?? (async () => {}),
  }
  let discord: DiscordOAuthClient = {
    createAuthorizationUrl() { return new URL('https://discord.test/oauth2/authorize') },
    async exchangeCode() { throw new Error('Unexpected Discord exchange') },
  }
  let cookies = { httpOnly: true, path: '/', sameSite: 'Lax' as const, secrets: ['operations-test'] }
  return {
    broadcast: {} as AppRuntime['broadcast'],
    configuration: {} as ConfigurationApplication,
    content: {} as AppRuntime['content'],
    draft: {} as AppRuntime['draft'],
    identity: new IdentityService(repository, discord),
    leagueOperations: overrides.leagueOperations ?? createLeagueOperations(),
    notifications: overrides.notifications,
    oauthCookie: createCookie('test_oauth', cookies),
    operations: {} as AppRuntime['operations'],
    platform: new PlatformService(repository),
    runnerAdmin: overrides.runnerAdmin ?? createRunnerAdmin(),
    runnerControl: {} as AppRuntime['runnerControl'],
    sessionCookie: createCookie('test_session', cookies),
    telemetry: overrides.telemetry ?? createTelemetry(),
  }
}

export function createRunnerAdmin(overrides: Partial<RunnerAdminApplication> = {}): RunnerAdminApplication {
  return {
    async matchDashboard() { return runnerMatchDashboard },
    async queueAttempt() { return { attemptId: 'attempt', attemptNumber: 1 } },
    async revokeStation() {},
    async scheduleMatch() { return { id: 'match' } },
    async stationDashboard() { return runnerStationDashboard },
    ...overrides,
  }
}

export function createNotifications(overrides: Partial<NotificationApplication> = {}): NotificationApplication {
  return {
    async configure() {},
    async dashboard() { return { botConfigured: true, channelId: null, failed: 0, pending: 0, sent: 0 } },
    async publish() { return { status: 'disabled' } },
    async retry() { return 0 },
    ...overrides,
  }
}

export function createTelemetry(overrides: Partial<TelemetryApplication> = {}): TelemetryApplication {
  return {
    async confirm() {},
    async correct() { throw new Error('Unexpected correction') },
    async dashboard() { return [] },
    async derive() { throw new Error('Unexpected derivation') },
    async finalizeHealthyAttempt() { throw new Error('Unexpected automatic finalization') },
    async ingest() { throw new Error('Unexpected telemetry upload') },
    async leagueOverview() { return [] },
    async leagueStatistics() { return [{ name: 'Summer 2026', seasonId: 'season', statistics: { playerTotals: {}, standings: [] } }] },
    async rebuildSeason() { return { playerTotals: {}, standings: [] } },
    ...overrides,
  }
}

export function createLeagueOperations(overrides: Partial<LeagueOperationsApplication> = {}): LeagueOperationsApplication {
  return {
    async cancelTrade() {},
    async dashboard() { return leagueOperationsDashboard },
    async proposeTrade() { return { id: 'trade' } },
    async reviewTrade() {},
    async setDeadline() {},
    ...overrides,
  }
}
