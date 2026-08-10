import * as assert from 'remix/assert'
import { createCookie } from 'remix/cookie'
import { describe, it } from 'remix/test'

import type { ConfigurationApplication } from '../../../configuration/service.ts'
import type { LeagueOperationsApplication, LeagueOperationsDashboard } from '../../../league-operations/service.ts'
import type { DiscordOAuthClient } from '../../../platform/discord-oauth.ts'
import { IdentityService } from '../../../platform/identity-service.ts'
import type { LeagueDetail, SessionIdentity } from '../../../platform/model.ts'
import type { PlatformRepository } from '../../../platform/repository.ts'
import type { AppRuntime } from '../../../platform/runtime.ts'
import { PlatformService } from '../../../platform/service.ts'
import { createAppRouter } from '../../../router.ts'
import type { RunnerAdminApplication, RunnerOperationsDashboard } from '../../../runner/admin-service.ts'
import type { TelemetryApplication } from '../../../telemetry/service.ts'
import { routes } from '../../../routes.ts'

const identity: SessionIdentity = {
  discordUserId: '123456789012345678',
  discordUsername: 'operations-admin',
  displayName: 'Operations Admin',
  isSiteAdmin: true,
  memberships: [],
  personId: '11111111-1111-4111-8111-111111111111',
}

const league: LeagueDetail = {
  id: '22222222-2222-4222-8222-222222222222',
  name: 'Shell League',
  publication: { draftVisible: false, leagueVisible: false, standingsVisible: false, statsVisible: false },
  roles: ['owner'],
  slug: 'shell-league',
  status: 'active',
}

const dashboard: RunnerOperationsDashboard = {
  matches: [],
  rulesets: [],
  seasons: [],
  stations: [],
  statProfiles: [],
}

const leagueOperationsDashboard: LeagueOperationsDashboard = {
  deadlines: [],
  seasons: [],
  trades: [],
}

describe('league operations controller', () => {
  it('renders the tenant-scoped match and station workspace', async () => {
    let runnerAdmin = createRunnerAdmin()
    let runtime = createRuntime(runnerAdmin)
    let session = await runtime.sessionCookie.serialize('test-session')
    let response = await createAppRouter({ logging: { sink: () => {} }, runtime }).fetch(
      new Request('http://localhost' + routes.leagues.operations.dashboard.href({ leagueSlug: league.slug }), {
        headers: { cookie: session },
      }),
    )

    assert.equal(response.status, 200)
    let html = await response.text()
    assert.match(html, /Shell League operations/)
    assert.match(html, /Schedule a match/)
    assert.match(html, /Enroll a runner station/)
    assert.match(html, /Game telemetry/)
  })

  it('parses a scheduled match form through Remix FormData middleware', async () => {
    let received: unknown
    let runnerAdmin = createRunnerAdmin({
      async scheduleMatch(_identity, leagueId, input) {
        received = { input, leagueId }
        return { id: '33333333-3333-4333-8333-333333333333' }
      },
    })
    let runtime = createRuntime(runnerAdmin)
    let session = await runtime.sessionCookie.serialize('test-session')
    let response = await createAppRouter({ logging: { sink: () => {} }, runtime }).fetch(
      new Request('http://localhost' + routes.leagues.operations.scheduleMatch.href({ leagueSlug: league.slug }), {
        body: new URLSearchParams({
          awayTeamId: '44444444-4444-4444-8444-444444444444',
          homeTeamId: '55555555-5555-4555-8555-555555555555',
          scheduledAt: '2026-08-10T19:30',
          seasonId: '66666666-6666-4666-8666-666666666666',
        }),
        headers: { cookie: session, origin: 'http://localhost' },
        method: 'POST',
      }),
    )

    assert.equal(response.status, 303)
    assert.deepEqual(received, {
      input: {
        awayTeamId: '44444444-4444-4444-8444-444444444444',
        homeTeamId: '55555555-5555-4555-8555-555555555555',
        scheduledAt: new Date('2026-08-10T19:30'),
        seasonId: '66666666-6666-4666-8666-666666666666',
      },
      leagueId: league.id,
    })
  })

  it('parses a roster trade offer into ordered character lists', async () => {
    let received: unknown
    let leagueOperations = createLeagueOperations({
      async proposeTrade(_identity, leagueId, input) {
        received = { input, leagueId }
        return { id: 'trade' }
      },
    })
    let runtime = createRuntime(createRunnerAdmin(), leagueOperations)
    let session = await runtime.sessionCookie.serialize('test-session')
    let response = await createAppRouter({ logging: { sink: () => {} }, runtime }).fetch(
      new Request('http://localhost' + routes.leagues.operations.proposeTrade.href({ leagueSlug: league.slug }), {
        body: new URLSearchParams({
          counterpartyCharacterIds: 'peach\ndaisy',
          counterpartyTeamId: '44444444-4444-4444-8444-444444444444',
          message: 'Captain exchange',
          proposerCharacterIds: 'mario, luigi',
          proposerTeamId: '55555555-5555-4555-8555-555555555555',
          seasonId: '66666666-6666-4666-8666-666666666666',
        }),
        headers: { cookie: session, origin: 'http://localhost' },
        method: 'POST',
      }),
    )

    assert.equal(response.status, 303)
    assert.deepEqual(received, {
      input: {
        counterpartyCharacterIds: ['peach', 'daisy'],
        counterpartyTeamId: '44444444-4444-4444-8444-444444444444',
        message: 'Captain exchange',
        proposerCharacterIds: ['mario', 'luigi'],
        proposerTeamId: '55555555-5555-4555-8555-555555555555',
        seasonId: '66666666-6666-4666-8666-666666666666',
      },
      leagueId: league.id,
    })
  })

  it('parses an audited telemetry correction form', async () => {
    let received: unknown
    let telemetry = createTelemetry({
      async correct(_identity, leagueId, attemptId, input) {
        received = { attemptId, input, leagueId }
        throw new Error('stop after parse')
      },
    })
    let runtime = createRuntime(createRunnerAdmin(), createLeagueOperations(), telemetry)
    let session = await runtime.sessionCookie.serialize('test-session')
    let response = await createAppRouter({ logging: { sink: () => {} }, runtime }).fetch(
      new Request('http://localhost' + routes.leagues.operations.correctTelemetry.href({ leagueSlug: league.slug, attemptId: '33333333-3333-4333-8333-333333333333' }), {
        body: new URLSearchParams({
          afterValue: '3', beforeValue: '2', entityId: 'away-team', entityType: 'team',
          reason: 'Official scorer ruling', statPath: 'hits',
        }),
        headers: { cookie: session, origin: 'http://localhost' },
        method: 'POST',
      }),
    )
    assert.equal(response.status, 400)
    assert.deepEqual(received, {
      attemptId: '33333333-3333-4333-8333-333333333333',
      input: { afterValue: 3, beforeValue: 2, entityId: 'away-team', entityType: 'team', reason: 'Official scorer ruling', statPath: 'hits' },
      leagueId: league.id,
    })
  })
})

function createRunnerAdmin(overrides: Partial<RunnerAdminApplication> = {}): RunnerAdminApplication {
  return {
    async dashboard() { return dashboard },
    async queueAttempt() { return { attemptId: 'attempt', attemptNumber: 1 } },
    async revokeStation() {},
    async scheduleMatch() { return { id: 'match' } },
    ...overrides,
  }
}

function createRuntime(
  runnerAdmin: RunnerAdminApplication,
  leagueOperations = createLeagueOperations(),
  telemetry = createTelemetry(),
): AppRuntime {
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
    async setPublicationPolicy() {},
  }
  let discord: DiscordOAuthClient = {
    createAuthorizationUrl() { return new URL('https://discord.test/oauth2/authorize') },
    async exchangeCode() { throw new Error('Unexpected Discord exchange') },
  }
  let cookies = { httpOnly: true, path: '/', sameSite: 'Lax' as const, secrets: ['operations-test'] }
  return {
    configuration: {} as ConfigurationApplication,
    content: {} as AppRuntime['content'],
    draft: {} as AppRuntime['draft'],
    identity: new IdentityService(repository, discord),
    leagueOperations,
    oauthCookie: createCookie('test_oauth', cookies),
    platform: new PlatformService(repository),
    runnerAdmin,
    runnerControl: {} as AppRuntime['runnerControl'],
    sessionCookie: createCookie('test_session', cookies),
    telemetry,
  }
}

function createTelemetry(overrides: Partial<TelemetryApplication> = {}): TelemetryApplication {
  return {
    async confirm() {},
    async correct() { throw new Error('Unexpected correction') },
    async dashboard() { return [] },
    async derive() { throw new Error('Unexpected derivation') },
    async ingest() { throw new Error('Unexpected telemetry upload') },
    async rebuildSeason() { return { playerTotals: {}, standings: [] } },
    ...overrides,
  }
}

function createLeagueOperations(
  overrides: Partial<LeagueOperationsApplication> = {},
): LeagueOperationsApplication {
  return {
    async cancelTrade() {},
    async dashboard() { return leagueOperationsDashboard },
    async proposeTrade() { return { id: 'trade' } },
    async reviewTrade() {},
    async setDeadline() {},
    ...overrides,
  }
}
