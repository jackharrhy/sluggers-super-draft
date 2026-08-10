import * as assert from 'remix/assert'
import { createCookie } from 'remix/cookie'
import { describe, it } from 'remix/test'

import { MatchConfigurationPackageSchema } from '@starworks/contracts'

import configurationFixture from '../../../../contracts/fixtures/valid/match-configuration-package.json' with { type: 'json' }

import type { ConfigurationApplication } from '../../configuration/service.ts'
import type { DiscordOAuthClient } from '../../platform/discord-oauth.ts'
import { IdentityService } from '../../platform/identity-service.ts'
import type { PlatformRepository } from '../../platform/repository.ts'
import type { AppRuntime } from '../../platform/runtime.ts'
import { PlatformService } from '../../platform/service.ts'
import { createAppRouter } from '../../router.ts'
import type { RunnerControlApplication } from '../../runner/control-service.ts'
import { routes } from '../../routes.ts'

const RUNNER_ID = '11111111-1111-4111-8111-111111111111'
const LEASE_ID = '22222222-2222-4222-8222-222222222222'
const ATTEMPT_ID = '33333333-3333-4333-8333-333333333333'

describe('runner API controller', () => {
  it('passes a JSON registration and bearer credential to the runner service', async () => {
    let received: unknown
    let runnerControl = createRunnerControl({
      async register(credential, input) {
        received = { credential, input }
        return {
          heartbeatSeconds: 15,
          kind: 'runner-registration-response',
          leaseSeconds: 60,
          runnerId: RUNNER_ID,
          schemaVersion: 1,
        }
      },
    })
    let router = createAppRouter({
      logging: { sink: () => {} },
      runtime: createRuntime(runnerControl),
    })
    let body = {
      capabilities: {
        adapterIds: ['sluggers-rmbe01'],
        architecture: 'arm64',
        dolphinVersion: '2603',
        features: ['launch-dolphin'],
        operatingSystem: 'macos',
        runnerVersion: '0.1.0',
      },
      kind: 'runner-registration-request',
      schemaVersion: 1,
      stationName: 'Broadcast desk',
    }
    let response = await router.fetch(new Request(
      'http://localhost' + routes.runnerApi.register.href(),
      {
        body: JSON.stringify(body),
        headers: {
          authorization: 'Bearer runner-secret',
          'content-type': 'application/json',
        },
        method: 'POST',
      },
    ))

    assert.equal(response.status, 201)
    assert.equal(response.headers.get('cache-control'), 'no-store')
    assert.equal((await response.json()).runnerId, RUNNER_ID)
    assert.deepEqual(received, { credential: 'runner-secret', input: body })
  })

  it('returns structured client errors for missing authentication and invalid JSON', async () => {
    let router = createAppRouter({
      logging: { sink: () => {} },
      runtime: createRuntime(createRunnerControl()),
    })
    let missingBearer = await router.fetch(new Request(
      'http://localhost' + routes.runnerApi.claim.href(),
      {
        body: JSON.stringify({ kind: 'runner-claim-request', runnerId: RUNNER_ID, schemaVersion: 1 }),
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      },
    ))
    assert.equal(missingBearer.status, 401)
    assert.match(missingBearer.headers.get('www-authenticate') ?? '', /Bearer/)
    assert.equal((await missingBearer.json()).error.code, 'unauthorized')

    let invalidJson = await router.fetch(new Request(
      'http://localhost' + routes.runnerApi.heartbeat.href(),
      {
        body: '{',
        headers: {
          authorization: 'Bearer runner-secret',
          'content-type': 'application/json',
        },
        method: 'POST',
      },
    ))
    assert.equal(invalidJson.status, 400)
    assert.equal((await invalidJson.json()).error.code, 'invalid_input')
  })

  it('refuses a lease update whose URL and signed message target differ', async () => {
    let called = false
    let runnerControl = createRunnerControl({
      async updateLease() {
        called = true
        return {
          attemptStatus: 'running',
          expiresAt: null,
          kind: 'runner-lease-update-response',
          schemaVersion: 1,
        }
      },
    })
    let router = createAppRouter({
      logging: { sink: () => {} },
      runtime: createRuntime(runnerControl),
    })
    let response = await router.fetch(new Request(
      'http://localhost' + routes.runnerApi.updateLease.href({ leaseId: LEASE_ID }),
      {
        body: JSON.stringify({
          action: 'renew',
          attemptId: ATTEMPT_ID,
          failureKind: null,
          kind: 'runner-lease-update-request',
          leaseId: '44444444-4444-4444-8444-444444444444',
          observedAt: '2026-08-10T12:00:00Z',
          runnerId: RUNNER_ID,
          schemaVersion: 1,
        }),
        headers: {
          authorization: 'Bearer runner-secret',
          'content-type': 'application/json',
        },
        method: 'POST',
      },
    ))

    assert.equal(response.status, 400)
    assert.equal(called, false)
  })

  it('serves the leased attempt configuration without requiring a JSON body', async () => {
    let configuration = MatchConfigurationPackageSchema.parse(configurationFixture)
    let received: unknown
    let router = createAppRouter({
      logging: { sink: () => {} },
      runtime: createRuntime(createRunnerControl({
        async configuration(credential, attemptId) {
          received = { attemptId, credential }
          return configuration
        },
      })),
    })
    let response = await router.fetch(new Request(
      'http://localhost' + routes.runnerApi.configuration.href({ attemptId: configuration.attemptId }),
      { headers: { authorization: 'Bearer runner-secret' } },
    ))

    assert.equal(response.status, 200)
    assert.equal((await response.json()).kind, 'match-configuration-package')
    assert.deepEqual(received, {
      attemptId: configuration.attemptId,
      credential: 'runner-secret',
    })
  })
})

function createRunnerControl(
  overrides: Partial<RunnerControlApplication> = {},
): RunnerControlApplication {
  return {
    async claim() { return { kind: 'runner-claim-response', run: null, schemaVersion: 1 } },
    async heartbeat() {
      return {
        accepted: true,
        kind: 'runner-heartbeat-response',
        schemaVersion: 1,
        serverTime: '2026-08-10T12:00:00Z',
      }
    },
    async configuration() { throw new Error('Unexpected configuration request') },
    async register() {
      return {
        heartbeatSeconds: 15,
        kind: 'runner-registration-response',
        leaseSeconds: 60,
        runnerId: RUNNER_ID,
        schemaVersion: 1,
      }
    },
    async updateLease() {
      return {
        attemptStatus: 'leased',
        expiresAt: '2026-08-10T12:01:00Z',
        kind: 'runner-lease-update-response',
        schemaVersion: 1,
      }
    },
    ...overrides,
  }
}

function createRuntime(runnerControl: RunnerControlApplication): AppRuntime {
  let repository: PlatformRepository = {
    async bootstrapSiteAdmin() { throw new Error('Unexpected bootstrap') },
    async completeDiscordLogin() { throw new Error('Unexpected login') },
    async consumeOAuthAttempt() { return null },
    async createOAuthAttempt() {},
    async createRunnerCredential() { throw new Error('Unexpected credential') },
    async findAccessibleLeague() { return null },
    async findIdentityBySessionHash() { return null },
    async findPendingInvitationId() { return null },
    async listVisibleLeagues() { return [] },
    async provisionLeague() { throw new Error('Unexpected league') },
    async revokeRunnerCredential() { return false },
    async revokeSession() {},
    async setPublicationPolicy() {},
  }
  let discord: DiscordOAuthClient = {
    createAuthorizationUrl() { throw new Error('Unexpected OAuth') },
    async exchangeCode() { throw new Error('Unexpected OAuth') },
  }
  let cookieOptions = {
    httpOnly: true,
    path: '/',
    sameSite: 'Lax' as const,
    secrets: ['runner-controller-test'],
  }
  return {
    configuration: {} as ConfigurationApplication,
    identity: new IdentityService(repository, discord),
    oauthCookie: createCookie('test_oauth', cookieOptions),
    platform: new PlatformService(repository),
    runnerControl,
    runnerAdmin: {} as AppRuntime['runnerAdmin'],
    sessionCookie: createCookie('test_session', cookieOptions),
  }
}
