import * as assert from 'remix/assert'
import { createCookie } from 'remix/cookie'
import { describe, it } from 'remix/test'

import { BroadcastOverlaySchema, type BroadcastOverlay } from '@starworks/contracts'
import broadcastOverlayFixture from '../../../contracts/fixtures/valid/broadcast-overlay.json' with { type: 'json' }

import type { BroadcastApplication } from '../broadcast/service.ts'
import type { DiscordOAuthClient } from '../platform/discord-oauth.ts'
import type { ConfigurationApplication } from '../configuration/service.ts'
import type { OperationsApplication } from '../operations/service.ts'
import { IdentityService } from '../platform/identity-service.ts'
import type { LeagueDetail, SessionIdentity } from '../platform/model.ts'
import type { PlatformRepository } from '../platform/repository.ts'
import type { AppRuntime } from '../platform/runtime.ts'
import { PlatformService } from '../platform/service.ts'
import { createAppRouter } from '../router.ts'
import { routes } from '../routes.ts'
import type { TelemetryApplication } from '../telemetry/service.ts'

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

  it('renders a public league as real standings instead of an advertorial workspace', async () => {
    let publicLeague: LeagueDetail = {
      id: '22222222-2222-4222-8222-222222222222',
      name: 'Shell League',
      publication: { draftVisible: false, leagueVisible: true, standingsVisible: true, statsVisible: false },
      roles: [],
      slug: 'shell-league',
      status: 'active',
    }
    let telemetry = {
      async leagueOverview() {
        return [{
          name: 'Summer 2026',
          playerTotals: null,
          seasonId: '33333333-3333-4333-8333-333333333333',
          standings: [{ losses: 0, runsAgainst: 2, runsFor: 5, teamId: '44444444-4444-4444-8444-444444444444', teamName: 'Mario Fireballs', wins: 1 }],
        }]
      },
    } as unknown as TelemetryApplication
    let runtime = createTestRuntime({
      repository: { async findAccessibleLeague() { return publicLeague } },
      telemetry,
    })
    let response = await createAppRouter({ logging: { sink: () => {} }, runtime }).fetch(
      new Request('http://localhost' + routes.leagues.show.href({ leagueSlug: publicLeague.slug })),
    )

    assert.equal(response.status, 200)
    let html = await response.text()
    assert.match(html, /Top teams/)
    assert.match(html, /Mario Fireballs/)
    assert.match(html, /Summer 2026/)
    assert.doesNotMatch(html, /will live|Open configuration workspace|Publication policy|>Admin</)
    assert.doesNotMatch(html, /Top players/)
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

  it('serves the public broadcast contract and browser-source overlay without a session', async () => {
    let overlay = BroadcastOverlaySchema.parse(broadcastOverlayFixture)
    let runtime = createTestRuntime({
      broadcast: { async publicOverlay() { return overlay } },
    })
    let router = createAppRouter({ logging: { sink: () => {} }, runtime })

    let dataResponse = await router.fetch(new Request('http://localhost' + routes.broadcastData.href({
      leagueSlug: overlay.league.slug,
      matchId: overlay.match.id,
    })))
    assert.equal(dataResponse.status, 200)
    assert.equal(dataResponse.headers.get('cache-control'), 'no-store')
    assert.equal(dataResponse.headers.get('x-content-type-options'), 'nosniff')
    assert.deepEqual(await dataResponse.json(), overlay)

    let pageResponse = await router.fetch(new Request('http://localhost' + routes.broadcastOverlay.href({
      leagueSlug: overlay.league.slug,
      matchId: overlay.match.id,
    })))
    assert.equal(pageResponse.status, 200)
    let html = await pageResponse.text()
    assert.match(html, /Daisy Comets/)
    assert.match(html, /Rosalina Stars/)
    assert.match(html, /data-broadcast-overlay/)
    assert.match(html, /broadcast-overlay\.ts/)
  })

  it('exposes shallow health, dependency readiness, and token-protected aggregate metrics', async () => {
    let operations: OperationsApplication = {
      authorizeMetrics(authorization) {
        return authorization === 'Bearer metrics-secret'
      },
      async metrics() {
        return '# TYPE starworks_runner_stations_stale gauge\nstarworks_runner_stations_stale 0\n'
      },
      async readiness() {
        return { checks: { garage: 'ready', postgres: 'ready' }, status: 'ready' }
      },
    }
    let router = createAppRouter({
      logging: { sink: () => {} },
      runtime: createTestRuntime({ operations }),
    })

    let health = await router.fetch(new Request('http://localhost' + routes.system.health.href()))
    assert.equal(health.status, 200)
    assert.deepEqual(await health.json(), { status: 'ok' })

    let ready = await router.fetch(new Request('http://localhost' + routes.system.ready.href()))
    assert.equal(ready.status, 200)
    assert.equal(ready.headers.get('cache-control'), 'no-store')
    assert.deepEqual(await ready.json(), {
      checks: { garage: 'ready', postgres: 'ready' },
      status: 'ready',
    })

    let hidden = await router.fetch(new Request('http://localhost' + routes.system.metrics.href()))
    assert.equal(hidden.status, 404)

    let metrics = await router.fetch(new Request('http://localhost' + routes.system.metrics.href(), {
      headers: { authorization: 'Bearer metrics-secret' },
    }))
    assert.equal(metrics.status, 200)
    assert.match(metrics.headers.get('content-type') ?? '', /text\/plain/)
    assert.match(await metrics.text(), /starworks_runner_stations_stale 0/)
  })

  it('reports unavailable dependencies as not ready', async () => {
    let operations: OperationsApplication = {
      authorizeMetrics() { return false },
      async metrics() { return '' },
      async readiness() {
        return { checks: { garage: 'unavailable', postgres: 'ready' }, status: 'unavailable' }
      },
    }
    let router = createAppRouter({
      logging: { sink: () => {} },
      runtime: createTestRuntime({ operations }),
    })
    let response = await router.fetch(new Request('http://localhost' + routes.system.ready.href()))

    assert.equal(response.status, 503)
    assert.equal((await response.json()).status, 'unavailable')
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

  it('logs into an explicitly enabled loopback-only demo session', async () => {
    let runtime = createTestRuntime({ identity: siteAdminIdentity() })
    runtime.localDemoLogin = {
      leagueSlug: 'mushroom-league',
      sessionToken: 'local-demo-session-token-0123456789',
    }
    let router = createAppRouter({ logging: { sink: () => {} }, runtime })

    let response = await router.fetch(
      new Request('http://127.0.0.1' + routes.auth.localDemo.href()),
    )
    assert.equal(response.status, 302)
    assert.equal(
      response.headers.get('location'),
      routes.leagues.operations.matches.index.href({ leagueSlug: 'mushroom-league' }),
    )
    let localCookie = response.headers.get('set-cookie') ?? ''
    assert.match(localCookie, /test_session=/)
    assert.doesNotMatch(localCookie, /; Secure/i)

    let external = await router.fetch(
      new Request('https://starworks.example' + routes.auth.localDemo.href()),
    )
    assert.equal(external.status, 404)
  })
})

function createTestRuntime(
  options: {
    broadcast?: BroadcastApplication
    identity?: SessionIdentity | null
    operations?: OperationsApplication
    repository?: Partial<PlatformRepository>
    telemetry?: TelemetryApplication
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
    broadcast: options.broadcast ?? unexpectedBroadcast(),
    configuration: {} as ConfigurationApplication,
    content: {} as AppRuntime['content'],
    draft: {} as AppRuntime['draft'],
    identity: new IdentityService(repository, discord),
    leagueOperations: {} as AppRuntime['leagueOperations'],
    oauthCookie: createCookie('test_oauth', cookieOptions),
    operations: options.operations ?? unexpectedOperations(),
    platform: new PlatformService(repository, { createToken: () => options.token ?? 'test-token' }),
    runnerControl: {} as AppRuntime['runnerControl'],
    runnerAdmin: {} as AppRuntime['runnerAdmin'],
    sessionCookie: createCookie('test_session', cookieOptions),
    telemetry: options.telemetry ?? ({} as AppRuntime['telemetry']),
  }
}

function unexpectedOperations(): OperationsApplication {
  return {
    authorizeMetrics() { return false },
    async metrics() { throw new Error('Unexpected metrics request') },
    async readiness() { throw new Error('Unexpected readiness request') },
  }
}

function unexpectedBroadcast(): BroadcastApplication {
  return {
    async publicOverlay(): Promise<BroadcastOverlay> {
      throw new Error('Unexpected broadcast request')
    },
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
