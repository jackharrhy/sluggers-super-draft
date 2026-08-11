import * as assert from 'remix/assert'
import { createCookie } from 'remix/cookie'
import { describe, it } from 'remix/test'

import type { ConfigurationApplication } from '../../../configuration/service.ts'
import type { DiscordOAuthClient } from '../../../platform/discord-oauth.ts'
import { IdentityService } from '../../../platform/identity-service.ts'
import type { LeagueDetail, SessionIdentity } from '../../../platform/model.ts'
import type { PlatformRepository } from '../../../platform/repository.ts'
import type { AppRuntime } from '../../../platform/runtime.ts'
import { PlatformService } from '../../../platform/service.ts'
import { createAppRouter } from '../../../router.ts'
import { routes } from '../../../routes.ts'
import { buildStatEditorV4Fixture } from '../../../import/stat-editor-v4.fixture.ts'
import { importStatEditorV4 } from '../../../import/stat-editor-v4.ts'

const identity: SessionIdentity = {
  discordUserId: '123456789012345678',
  discordUsername: 'league-admin',
  displayName: 'League Admin',
  isSiteAdmin: true,
  memberships: [],
  personId: '11111111-1111-4111-8111-111111111111',
}

const league: LeagueDetail = {
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

describe('league configuration controller', () => {
  it('renders the configuration workspace through an authenticated Remix request', async () => {
    let configuration = {
      async dashboard() {
        return {
          profiles: [{ id: 'profile', name: 'Competitive stats', slug: 'competitive', revisions: [] }],
          rulesets: [{ id: 'rules', name: 'League rules', slug: 'league-rules', revisions: [] }],
          teams: [{ id: '33333333-3333-4333-8333-333333333333', name: 'Mario Fireballs', lineups: [] }],
        }
      },
    } as unknown as ConfigurationApplication
    let runtime = createRuntime(configuration)
    let router = createAppRouter({ logging: { sink: () => {} }, runtime })
    let session = await runtime.sessionCookie.serialize('test-session')
    let response = await router.fetch(new Request(
      'http://localhost' + routes.leagues.configuration.dashboard.href({ leagueSlug: league.slug }),
      { headers: { cookie: session } },
    ))

    assert.equal(response.status, 200)
    let html = await response.text()
    assert.match(html, />Admin</)
    assert.match(html, /Compile preview/)
    assert.match(html, />Stats</)
    assert.match(html, />Teams</)
    assert.doesNotMatch(html, /Lil Slug Crew/)
  })

  it('parses a stat profile form and redirects to the new revision', async () => {
    let received: unknown
    let configuration = {
      async createStatProfileDraft(_identity: unknown, leagueId: string, input: unknown) {
        received = { input, leagueId }
        return { revisionId: '44444444-4444-4444-8444-444444444444' }
      },
    } as unknown as ConfigurationApplication
    let runtime = createRuntime(configuration)
    let router = createAppRouter({ logging: { sink: () => {} }, runtime })
    let session = await runtime.sessionCookie.serialize('test-session')
    let form = new FormData()
    form.set('name', 'Competitive stats')
    form.set('slug', 'competitive-stats')
    form.set('definitions', JSON.stringify([{
      dataType: 'integer',
      definitionId: '55555555-5555-4555-8555-555555555555',
      display: { group: 'Batting', label: 'Slap Power', order: 1 },
      key: 'batting.slap-power',
      maximum: 200,
      minimum: 0,
      required: true,
      step: 1,
    }]))
    form.set('characterValues', JSON.stringify([{ characterId: 'mario', values: { 'batting.slap-power': 100 } }]))
    let response = await router.fetch(new Request(
      'http://localhost' + routes.leagues.configuration.createStatProfile.href({ leagueSlug: league.slug }),
      {
        body: form,
        headers: { cookie: session, origin: 'http://localhost' },
        method: 'POST',
      },
    ))

    assert.equal(response.status, 303)
    assert.equal(
      response.headers.get('location'),
      routes.leagues.configuration.showStatProfile.href({
        leagueSlug: league.slug,
        revisionId: '44444444-4444-4444-8444-444444444444',
      }),
    )
    assert.deepEqual(received, {
      input: {
        characterValues: [{ characterId: 'mario', values: { 'batting.slap-power': 100 } }],
        definitions: [{
          dataType: 'integer',
          definitionId: '55555555-5555-4555-8555-555555555555',
          display: { group: 'Batting', label: 'Slap Power', order: 1 },
          key: 'batting.slap-power',
          maximum: 200,
          minimum: 0,
          required: true,
          step: 1,
        }],
        name: 'Competitive stats',
        slug: 'competitive-stats',
      },
      leagueId: league.id,
    })
  })

  it('renders and updates one character without exposing profile JSON', async () => {
    let received: unknown
    let revision = {
      basedOnRevisionId: null,
      characterValues: [{ characterId: 'mario', values: { 'batting.power': 75 } }],
      createdAt: '2026-08-11T12:00:00.000Z',
      definitions: [{
        dataType: 'integer' as const,
        definitionId: '55555555-5555-4555-8555-555555555555',
        display: { group: 'Batting', label: 'Power', order: 1 },
        key: 'batting.power',
        maximum: 100,
        minimum: 0,
        required: true,
        step: 1,
      }],
      kind: 'stat-profile-revision' as const,
      leagueId: league.id,
      name: 'Competitive stats',
      profileId: '66666666-6666-4666-8666-666666666666',
      publishedAt: null,
      revisionId: '44444444-4444-4444-8444-444444444444',
      revisionNumber: 1,
      schemaVersion: 1 as const,
      status: 'draft' as const,
    }
    let configuration = {
      async getStatProfileRevision() {
        return { basedOnRevision: null, history: [], issues: [], revision }
      },
      async updateStatProfileDraft(_identity: unknown, leagueId: string, revisionId: string, input: unknown) {
        received = { input, leagueId, revisionId }
        return revision
      },
    } as unknown as ConfigurationApplication
    let runtime = createRuntime(configuration)
    let router = createAppRouter({ logging: { sink: () => {} }, runtime })
    let session = await runtime.sessionCookie.serialize('test-session')
    let href = routes.leagues.configuration.editStatProfileCharacter.href({
      characterId: 'mario',
      leagueSlug: league.slug,
      revisionId: revision.revisionId,
    })

    let page = await router.fetch(new Request('http://localhost' + href, { headers: { cookie: session } }))
    assert.equal(page.status, 200)
    let html = await page.text()
    assert.match(html, /Mario/)
    assert.match(html, /Power/)
    assert.doesNotMatch(html, /characterValues/)

    let form = new FormData()
    form.set('stat.batting.power', '88')
    let response = await router.fetch(new Request('http://localhost' + href, {
      body: form,
      headers: { cookie: session, origin: 'http://localhost' },
      method: 'POST',
    }))
    assert.equal(response.status, 303)
    assert.equal(response.headers.get('location'), href)
    assert.deepEqual(received, {
      input: {
        characterValues: [{ characterId: 'mario', values: { 'batting.power': 88 } }],
        definitions: revision.definitions,
        name: revision.name,
        sluggersTuning: undefined,
      },
      leagueId: league.id,
      revisionId: revision.revisionId,
    })
  })

  it('exports a lossless Stat Editor v4 text file', async () => {
    let source = buildStatEditorV4Fixture()
    let imported = importStatEditorV4({ profileName: 'Export me', rawText: source, sourceVersion: 'v4' })
    let configuration = {
      async getStatProfileRevision() {
        return {
          revision: {
            ...imported,
            revisionId: '44444444-4444-4444-8444-444444444444',
            revisionNumber: 3,
          },
        }
      },
    } as unknown as ConfigurationApplication
    let runtime = createRuntime(configuration)
    let router = createAppRouter({ logging: { sink: () => {} }, runtime })
    let session = await runtime.sessionCookie.serialize('test-session')
    let response = await router.fetch(new Request('http://localhost' + routes.leagues.configuration.exportStatProfile.href({
      leagueSlug: league.slug,
      revisionId: '44444444-4444-4444-8444-444444444444',
    }), { headers: { cookie: session } }))

    assert.equal(response.status, 200)
    assert.equal(response.headers.get('content-disposition'), 'attachment; filename="stat-profile-r3.txt"')
    assert.equal(await response.text(), source)
  })
})

function createRuntime(configuration: ConfigurationApplication): AppRuntime {
  let repository: PlatformRepository = {
    async bootstrapSiteAdmin() { return identity },
    async completeDiscordLogin() { return identity },
    async consumeOAuthAttempt() { return null },
    async createOAuthAttempt() {},
    async createRunnerCredential() { return 'credential' },
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
