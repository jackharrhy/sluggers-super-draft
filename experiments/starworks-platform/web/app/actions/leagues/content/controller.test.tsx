import * as assert from 'remix/assert'
import { createCookie } from 'remix/cookie'
import { describe, it } from 'remix/test'

import type { ConfigurationApplication } from '../../../configuration/service.ts'
import type { ContentApplication, ContentDashboard } from '../../../content/service.ts'
import type { DiscordOAuthClient } from '../../../platform/discord-oauth.ts'
import { IdentityService } from '../../../platform/identity-service.ts'
import type { LeagueDetail, SessionIdentity } from '../../../platform/model.ts'
import type { PlatformRepository } from '../../../platform/repository.ts'
import type { AppRuntime } from '../../../platform/runtime.ts'
import { PlatformService } from '../../../platform/service.ts'
import { createAppRouter } from '../../../router.ts'
import { routes } from '../../../routes.ts'

const identity: SessionIdentity = {
  discordUserId: '123456789012345670',
  discordUsername: 'content-admin',
  displayName: 'Content Admin',
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

const dashboard: ContentDashboard = {
  assets: [],
  packs: [],
  publishedRulesets: [{ id: '44444444-4444-4444-8444-444444444444', name: 'League Rules', revisionNumber: 1 }],
  publishedStatProfiles: [{ id: '33333333-3333-4333-8333-333333333333', name: 'League Stats', revisionNumber: 1 }],
}

describe('league content controller', () => {
  it('renders the Garage-backed content workspace', async () => {
    let runtime = createRuntime(createContent())
    let response = await request(runtime, routes.leagues.content.dashboard.href({ leagueSlug: league.slug }))

    assert.equal(response.status, 200)
    let html = await response.text()
    assert.match(html, /Shell League content/)
    assert.match(html, /New content-pack draft/)
    assert.match(html, /Upload source art/)
  })

  it('parses a content draft into stable scalar and line inputs', async () => {
    let received: unknown
    let content = createContent({
      async createDraft(_identity, leagueId, input) {
        received = { input, leagueId }
        return 'revision'
      },
    })
    let runtime = createRuntime(content)
    let response = await request(
      runtime,
      routes.leagues.content.create.href({ leagueSlug: league.slug }),
      new URLSearchParams({
        adapterVersion: '0.1.0',
        mainDolSha256: 'a'.repeat(64),
        name: 'League Pack',
        rulesetRevisionId: '44444444-4444-4444-8444-444444444444',
        slug: 'league-pack',
        statCharacterIds: 'mario\nluigi\n',
        statProfileRevisionId: '33333333-3333-4333-8333-333333333333',
      }),
    )

    assert.equal(response.status, 303)
    assert.deepEqual(received, {
      input: {
        adapterVersion: '0.1.0',
        mainDolSha256: 'a'.repeat(64),
        name: 'League Pack',
        rulesetRevisionId: '44444444-4444-4444-8444-444444444444',
        slug: 'league-pack',
        statCharacterIds: ['mario', 'luigi'],
        statProfileRevisionId: '33333333-3333-4333-8333-333333333333',
      },
      leagueId: league.id,
    })
  })

  it('passes uploaded source bytes and media type without inventing a file format', async () => {
    let received: unknown
    let content = createContent({
      async uploadAsset(_identity, leagueId, input) {
        received = { bytes: [...input.bytes], displayName: input.displayName, leagueId, mediaType: input.mediaType }
        return 'asset'
      },
    })
    let body = new FormData()
    body.set('asset', new File([new Uint8Array([1, 2, 3])], 'icon.png', { type: 'image/png' }))
    let response = await request(
      createRuntime(content),
      routes.leagues.content.uploadAsset.href({ leagueSlug: league.slug }),
      body,
    )

    assert.equal(response.status, 303)
    assert.deepEqual(received, {
      bytes: [1, 2, 3],
      displayName: 'icon.png',
      leagueId: league.id,
      mediaType: 'image/png',
    })
  })
})

async function request(runtime: AppRuntime, path: string, body?: BodyInit) {
  let session = await runtime.sessionCookie.serialize('test-session')
  return createAppRouter({ logging: { sink: () => {} }, runtime }).fetch(new Request(
    'http://localhost' + path,
    body ? { body, headers: { cookie: session, origin: 'http://localhost' }, method: 'POST' } : { headers: { cookie: session } },
  ))
}

function createContent(overrides: Partial<ContentApplication> = {}): ContentApplication {
  return {
    async assignAsset() {},
    async clone() { return 'clone' },
    async createDraft() { return 'revision' },
    async dashboard() { return dashboard },
    async publish() { throw new Error('Unexpected publish') },
    async uploadAsset() { return 'asset' },
    ...overrides,
  }
}

function createRuntime(content: ContentApplication): AppRuntime {
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
  let cookies = { httpOnly: true, path: '/', sameSite: 'Lax' as const, secrets: ['content-test'] }
  return {
    broadcast: {} as AppRuntime['broadcast'],
    configuration: {} as ConfigurationApplication,
    content,
    draft: {} as AppRuntime['draft'],
    identity: new IdentityService(repository, discord),
    leagueOperations: {} as AppRuntime['leagueOperations'],
    oauthCookie: createCookie('test_oauth', cookies),
    operations: {} as AppRuntime['operations'],
    platform: new PlatformService(repository),
    runnerAdmin: {} as AppRuntime['runnerAdmin'],
    runnerControl: {} as AppRuntime['runnerControl'],
    sessionCookie: createCookie('test_session', cookies),
    telemetry: {} as AppRuntime['telemetry'],
  }
}
