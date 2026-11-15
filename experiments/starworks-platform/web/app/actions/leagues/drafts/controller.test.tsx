import * as assert from 'remix/assert'
import { createCookie } from 'remix/cookie'
import { describe, it } from 'remix/test'

import type { ConfigurationApplication } from '../../../configuration/service.ts'
import type { DraftApplication, DraftRoom, DraftSetupOptions } from '../../../draft/service.ts'
import type { DiscordOAuthClient } from '../../../platform/discord-oauth.ts'
import { IdentityService } from '../../../platform/identity-service.ts'
import type { LeagueDetail, SessionIdentity } from '../../../platform/model.ts'
import type { PlatformRepository } from '../../../platform/repository.ts'
import type { AppRuntime } from '../../../platform/runtime.ts'
import { PlatformService } from '../../../platform/service.ts'
import { createAppRouter } from '../../../router.ts'
import { routes } from '../../../routes.ts'

const identity: SessionIdentity = {
  discordUserId: '123456789012345678',
  discordUsername: 'draft-admin',
  displayName: 'Draft Admin',
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

const draftId = '33333333-3333-4333-8333-333333333333'
const marioTeamId = '44444444-4444-4444-8444-444444444444'
const peachTeamId = '55555555-5555-4555-8555-555555555555'
const seasonId = '66666666-6666-4666-8666-666666666666'
const profileId = '77777777-7777-4777-8777-777777777777'

const dashboard: DraftSetupOptions = {
  drafts: [{
    currentPickNumber: 1,
    id: draftId,
    name: 'Season One Draft',
    seasonId,
    seasonName: 'Season One',
    status: 'setup',
    totalPicks: 18,
  }],
  seasons: [{
    id: seasonId,
    name: 'Season One',
    teams: [
      { id: marioTeamId, name: 'Mario Fireballs' },
      { id: peachTeamId, name: 'Peach Monarchs' },
    ],
  }],
  statProfiles: [{ id: profileId, name: 'Competitive Stats', revisionNumber: 1 }],
}

const room: DraftRoom = {
  characters: [{
    characterId: 'mario',
    chemistry: [{ characterId: 'luigi', displayName: 'Luigi', relationship: 'positive' }],
    displayName: 'Mario',
    isCaptain: true,
    values: { batting: 88, pitching: 42 },
  }],
  currentTeamId: marioTeamId,
  draft: {
    cancelledAt: null,
    completedAt: null,
    createdAt: new Date('2026-08-10T12:00:00Z'),
    createdByPersonId: identity.personId,
    currentPickNumber: 1,
    deadline: new Date('2026-08-10T12:02:00Z'),
    gameId: 'RMBE01',
    id: draftId,
    leagueId: league.id,
    name: 'Season One Draft',
    orderMode: 'snake',
    pausedAt: null,
    pickSeconds: 120,
    rounds: 9,
    seasonId,
    startedAt: new Date('2026-08-10T12:00:00Z'),
    statProfileRevisionId: profileId,
    status: 'active',
    totalPicks: 18,
    turnStartedAt: new Date('2026-08-10T12:00:00Z'),
    updatedAt: new Date('2026-08-10T12:00:00Z'),
    version: 1,
  },
  events: [],
  picks: [],
  queue: [],
  slots: [
    { managerPersonId: identity.personId, position: 1, teamId: marioTeamId, teamName: 'Mario Fireballs' },
    { managerPersonId: null, position: 2, teamId: peachTeamId, teamName: 'Peach Monarchs' },
  ],
}

describe('league drafts controller', () => {
  it('renders draft setup and the server-authored room', async () => {
    let runtime = createRuntime(createDraftApplication())
    let router = createAppRouter({ logging: { sink: () => {} }, runtime })
    let session = await runtime.sessionCookie.serialize('test-session')
    let dashboardResponse = await router.fetch(new Request(
      'http://localhost' + routes.leagues.drafts.dashboard.href({ leagueSlug: league.slug }),
      { headers: { cookie: session } },
    ))
    let roomResponse = await router.fetch(new Request(
      'http://localhost' + routes.leagues.drafts.room.href({ draftId, leagueSlug: league.slug }),
      { headers: { cookie: session } },
    ))

    assert.equal(dashboardResponse.status, 200)
    assert.match(await dashboardResponse.text(), /Season One Draft/)
    assert.equal(roomResponse.status, 200)
    let html = await roomResponse.text()
    assert.match(html, /Mario Fireballs owns pick 1/)
    assert.match(html, /Draft Mario/)
    assert.match(html, /\+ Luigi/)
  })

  it('preserves numbered team-slot order when creating a draft', async () => {
    let received: unknown
    let draft = createDraftApplication({
      async createDraft(_identity, leagueId, input) {
        received = { input, leagueId }
        return { id: draftId }
      },
    })
    let runtime = createRuntime(draft)
    let session = await runtime.sessionCookie.serialize('test-session')
    let form = new FormData()
    form.set('gameId', 'RMBE01')
    form.set('name', 'Season One Draft')
    form.set('orderMode', 'snake')
    form.set('pickSeconds', '90')
    form.set('rounds', '9')
    form.set('seasonId', seasonId)
    form.append('slotTeamIds', peachTeamId)
    form.append('slotTeamIds', marioTeamId)
    form.set('statProfileRevisionId', profileId)
    let response = await createAppRouter({ logging: { sink: () => {} }, runtime }).fetch(new Request(
      'http://localhost' + routes.leagues.drafts.create.href({ leagueSlug: league.slug }),
      { body: form, headers: { cookie: session, origin: 'http://localhost' }, method: 'POST' },
    ))

    assert.equal(response.status, 303)
    assert.deepEqual(received, {
      input: {
        gameId: 'RMBE01',
        name: 'Season One Draft',
        orderMode: 'snake',
        pickSeconds: 90,
        rounds: 9,
        seasonId,
        slotTeamIds: [peachTeamId, marioTeamId],
        statProfileRevisionId: profileId,
      },
      leagueId: league.id,
    })
  })

  it('submits a pick with the rendered draft version and redirects back to the room', async () => {
    let received: unknown
    let draft = createDraftApplication({
      async makePick(_identity, leagueId, receivedDraftId, input) {
        received = { input, leagueId, receivedDraftId }
        return {} as Awaited<ReturnType<DraftApplication['makePick']>>
      },
    })
    let runtime = createRuntime(draft)
    let session = await runtime.sessionCookie.serialize('test-session')
    let response = await createAppRouter({ logging: { sink: () => {} }, runtime }).fetch(new Request(
      'http://localhost' + routes.leagues.drafts.pick.href({ draftId, leagueSlug: league.slug }),
      {
        body: new URLSearchParams({ characterId: 'mario', expectedVersion: '1' }),
        headers: { cookie: session, origin: 'http://localhost' },
        method: 'POST',
      },
    ))

    assert.equal(response.status, 303)
    assert.deepEqual(received, {
      input: { characterId: 'mario', expectedVersion: 1, reason: undefined },
      leagueId: league.id,
      receivedDraftId: draftId,
    })
  })
})

function createDraftApplication(overrides: Partial<DraftApplication> = {}): DraftApplication {
  return {
    async automaticPickAfterExpiry() { return {} as Awaited<ReturnType<DraftApplication['automaticPickAfterExpiry']>> },
    async createDraft() { return { id: draftId } },
    async dashboard() { return dashboard },
    async getDraftRoom() { return room },
    async makePick() { return {} as Awaited<ReturnType<DraftApplication['makePick']>> },
    async pauseDraft() {},
    async resumeDraft() {},
    async reverseLatestPick() {},
    async startDraft() {},
    async updateQueue() {},
    ...overrides,
  }
}

function createRuntime(draft: DraftApplication): AppRuntime {
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
  let cookies = { httpOnly: true, path: '/', sameSite: 'Lax' as const, secrets: ['draft-controller-test'] }
  return {
    broadcast: {} as AppRuntime['broadcast'],
    configuration: {} as ConfigurationApplication,
    content: {} as AppRuntime['content'],
    draft,
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
