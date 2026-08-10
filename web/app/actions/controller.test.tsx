import * as assert from 'remix/assert'
import { createCookie } from 'remix/cookie'
import { describe, it } from 'remix/test'

import type { DiscordOAuthClient } from '../platform/discord-oauth.ts'
import type { ConfigurationApplication } from '../configuration/service.ts'
import { IdentityService } from '../platform/identity-service.ts'
import type { LeagueDetail, SessionIdentity } from '../platform/model.ts'
import type { PlatformRepository } from '../platform/repository.ts'
import type { AppRuntime } from '../platform/runtime.ts'
import { PlatformService } from '../platform/service.ts'
import { createAppRouter } from '../router.ts'
import { routes } from '../routes.ts'

const CORRELATION_ID = '11111111-1111-4111-8111-111111111111'

describe('root controller', () => {
  it('renders Starworks and emits a correlated structured request log', async () => {
    let lines: string[] = []
    let router = createAppRouter({
      logging: {
        clock: () => new Date('2026-08-10T12:00:00Z'),
        sink: (line) => lines.push(line),
      },
      runtime: createTestRuntime(),
    })
    let response = await router.fetch(
      new Request('http://localhost' + routes.home.href(), {
        headers: { 'x-correlation-id': CORRELATION_ID },
      }),
    )

    assert.equal(response.status, 200)
    assert.equal(response.headers.get('x-correlation-id'), CORRELATION_ID)
    assert.match(await response.text(), /Starworks/)
    assert.equal(lines.length, 1)

    let record = JSON.parse(lines[0]!)
    assert.equal(record.event, 'http.request.completed')
    assert.equal(record.correlationId, CORRELATION_ID)
    assert.equal(record.actorId, null)
    assert.equal(record.leagueId, null)
    assert.equal(record.matchAttemptId, null)
    assert.equal(record.runnerId, null)
    assert.equal(record.method, 'GET')
    assert.equal(record.path, '/')
    assert.equal(record.status, 200)
  })

  it('replaces an invalid inbound correlation ID', async () => {
    let router = createAppRouter({
      logging: {
        createCorrelationId: () => CORRELATION_ID,
        sink: () => {},
      },
      runtime: createTestRuntime(),
    })
    let response = await router.fetch(
      new Request('http://localhost' + routes.home.href(), {
        headers: { 'x-correlation-id': 'not-a-uuid' },
      }),
    )

    assert.equal(response.headers.get('x-correlation-id'), CORRELATION_ID)
  })

  it('lets a site administrator create a private league and reveals its one-time invitation', async () => {
    let admin = siteAdminIdentity()
    let provisioned: LeagueDetail = {
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
    let runtime = createTestRuntime({
      identity: admin,
      repository: {
        async provisionLeague() {
          return provisioned
        },
      },
      token: 'one-time-invitation',
    })
    let session = await runtime.sessionCookie.serialize('test-session')
    let router = createAppRouter({ logging: { sink: () => {} }, runtime })
    let response = await router.fetch(
      new Request('http://localhost' + routes.admin.createLeague.href(), {
        body: new URLSearchParams({ name: 'Shell League', slug: 'shell-league' }),
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          cookie: session,
          origin: 'http://localhost',
        },
        method: 'POST',
      }),
    )

    assert.equal(response.status, 201)
    let html = await response.text()
    assert.match(html, /Shell League/)
    assert.match(html, /one-time-invitation/)
    assert.match(html, /Private by default/)
  })
})

function createTestRuntime(
  options: {
    identity?: SessionIdentity | null
    repository?: Partial<PlatformRepository>
    token?: string
  } = {},
): AppRuntime {
  let repository: PlatformRepository = Object.assign({
    async bootstrapSiteAdmin() {
      return siteAdminIdentity()
    },
    async completeDiscordLogin() {
      if (!options.identity) throw new Error('No test identity configured')
      return options.identity
    },
    async consumeOAuthAttempt() {
      return null
    },
    async createOAuthAttempt() {},
    async createRunnerCredential() {
      return '22222222-2222-4222-8222-222222222222'
    },
    async findAccessibleLeague() {
      return null
    },
    async findIdentityBySessionHash() {
      return options.identity ?? null
    },
    async findPendingInvitationId() {
      return null
    },
    async listVisibleLeagues() {
      return []
    },
    async provisionLeague() {
      throw new Error('Unexpected league provisioning')
    },
    async revokeSession() {},
    async revokeRunnerCredential() {
      return true
    },
    async setPublicationPolicy() {},
  }, options.repository)
  let discord: DiscordOAuthClient = {
    createAuthorizationUrl() {
      return new URL('https://discord.test/oauth2/authorize')
    },
    async exchangeCode() {
      throw new Error('Unexpected Discord exchange')
    },
  }
  let cookieOptions = {
    httpOnly: true,
    path: '/',
    sameSite: 'Lax' as const,
    secrets: ['controller-test-cookie-secret'],
  }
  return {
    configuration: {} as ConfigurationApplication,
    draft: {} as AppRuntime['draft'],
    identity: new IdentityService(repository, discord),
    leagueOperations: {} as AppRuntime['leagueOperations'],
    oauthCookie: createCookie('test_oauth', cookieOptions),
    platform: new PlatformService(repository, { createToken: () => options.token ?? 'test-token' }),
    runnerControl: {} as AppRuntime['runnerControl'],
    runnerAdmin: {} as AppRuntime['runnerAdmin'],
    sessionCookie: createCookie('test_session', cookieOptions),
    telemetry: {} as AppRuntime['telemetry'],
  }
}

function siteAdminIdentity(): SessionIdentity {
  return {
    discordUserId: '123456789',
    discordUsername: 'site-admin',
    displayName: 'Site Admin',
    isSiteAdmin: true,
    memberships: [],
    personId: '11111111-1111-4111-8111-111111111111',
  }
}
