import * as assert from 'remix/assert'
import { createCookie } from 'remix/cookie'
import { createTestServer } from 'remix/node-fetch-server/test'
import { describe, it } from 'remix/test'

import { TeamLineupRevisionSchema, type TeamLineupRevision } from '@starworks/contracts'

import lineupFixture from '../../contracts/fixtures/valid/team-lineup-revision.json' with { type: 'json' }
import type { ConfigurationApplication, TeamLineupRevisionDetail } from './configuration/service.ts'
import type { DraftApplication, DraftRoom } from './draft/service.ts'
import type { LeagueOperationsApplication } from './league-operations/service.ts'
import type { DiscordOAuthClient } from './platform/discord-oauth.ts'
import { IdentityService } from './platform/identity-service.ts'
import type { LeagueDetail, SessionIdentity } from './platform/model.ts'
import type { PlatformRepository } from './platform/repository.ts'
import type { AppRuntime } from './platform/runtime.ts'
import { PlatformService } from './platform/service.ts'
import { createAppRouter } from './router.ts'
import type { RunnerAdminApplication, RunnerOperationsDashboard } from './runner/admin-service.ts'
import { routes } from './routes.ts'
import type { TelemetryApplication, TelemetryAttemptSummary } from './telemetry/service.ts'

const PERSON_ID = '11111111-1111-4111-8111-111111111111'
const LEAGUE_ID = '22222222-2222-4222-8222-222222222222'
const DRAFT_ID = '33333333-3333-4333-8333-333333333333'
const HOME_TEAM_ID = '44444444-4444-4444-8444-444444444444'
const AWAY_TEAM_ID = '55555555-5555-4555-8555-555555555555'
const SEASON_ID = '66666666-6666-4666-8666-666666666666'
const PROFILE_ID = '77777777-7777-4777-8777-777777777777'
const RULESET_ID = '88888888-8888-4888-8888-888888888888'
const MATCH_ID = '99999999-9999-4999-8999-999999999999'
const ATTEMPT_ID = 'aaaaaaaa-1111-4111-8111-111111111111'

const identity: SessionIdentity = {
  discordUserId: '123456789012345678',
  discordUsername: 'site-admin',
  displayName: 'Site Admin',
  isSiteAdmin: true,
  memberships: [],
  personId: PERSON_ID,
}

const league: LeagueDetail = {
  id: LEAGUE_ID,
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

describe('critical Starworks browser workflows', () => {
  it('provisions a private league and displays its one-time Discord invitation', async (t) => {
    let runtime = createRuntime()
    let router = createAppRouter({ logging: { sink: () => {} }, runtime })
    let server = await createTestServer((request) => router.fetch(request))
    let page = await t.serve(server)
    await authenticate(page, server.baseUrl, runtime)

    await page.goto(routes.admin.newLeague.href())
    await page.getByLabel('League name').fill('Shell League')
    await page.getByLabel('URL slug').fill('shell-league')
    await page.getByRole('button', { name: 'Create private league' }).click()

    await page.getByRole('heading', { name: 'Shell League' }).waitFor()
    assert.match(
      await page.getByLabel('One-time Discord invitation').inputValue(),
      /invite=test-invitation-token/,
    )
    await page.getByText('Private by default.').waitFor()
  })

  it('commits a server-authoritative draft pick and publishes an immutable lineup', async (t) => {
    let room = draftRoom()
    let picked: unknown
    let lineup = draftLineup()
    let runtime = createRuntime({
      configuration: configurationApplication(() => lineup, (published) => {
        lineup = published
      }),
      draft: draftApplication(room, (input) => {
        picked = input
        room.characters = []
        room.currentTeamId = AWAY_TEAM_ID
        room.draft.currentPickNumber = 2
        room.draft.version = 2
        room.picks.push({
          characterId: 'mario',
          characterName: 'Mario',
          draftId: DRAFT_ID,
          id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
          leagueId: LEAGUE_ID,
          pickedByPersonId: PERSON_ID,
          pickNumber: 1,
          reason: null,
          reversedAt: null,
          roundNumber: 1,
          selectedAt: new Date('2026-08-10T12:00:10Z'),
          slotPosition: 1,
          source: 'manager',
          status: 'active',
          teamId: HOME_TEAM_ID,
          teamName: 'Mario Fireballs',
        })
      }),
    })
    let router = createAppRouter({ logging: { sink: () => {} }, runtime })
    let server = await createTestServer((request) => router.fetch(request))
    let page = await t.serve(server)
    await authenticate(page, server.baseUrl, runtime)

    await page.goto(routes.leagues.drafts.room.href({ draftId: DRAFT_ID, leagueSlug: league.slug }))
    await page.getByRole('button', { name: 'Draft Mario' }).click()
    await page.getByText('Every eligible character has been selected.').waitFor()
    assert.deepEqual(picked, { characterId: 'mario', expectedVersion: 1, reason: undefined })
    await page.getByLabel('Pick history').getByText('Mario Fireballs').waitFor()

    await page.goto(routes.leagues.configuration.showLineup.href({
      leagueSlug: league.slug,
      revisionId: lineup.lineupRevisionId,
      teamId: lineup.teamId,
    }))
    await page.getByRole('button', { name: 'Publish and lock revision' }).click()
    await page.getByRole('button', { name: 'Clone into new draft' }).waitFor()
    await page.getByText('Published revision', { exact: true }).waitFor()
    assert.equal(lineup.status, 'published')
  })

  it('queues a runner attempt and records an audited result correction', async (t) => {
    let runnerDashboard = operationsDashboard()
    let queued: unknown
    let corrected: unknown
    let correctionRecorded = false
    let runtime = createRuntime({
      leagueOperations: leagueOperationsApplication(),
      runnerAdmin: runnerAdminApplication(runnerDashboard, (input) => {
        queued = input
        runnerDashboard.matches[0]!.attempts.push({
          attemptNumber: 1,
          failureKind: null,
          id: ATTEMPT_ID,
          requiredGameBuildSha256: 'a'.repeat(64),
          status: 'queued',
        })
      }),
      telemetry: telemetryApplication(
        () => correctionRecorded,
        (input) => {
          corrected = input
          correctionRecorded = true
        },
      ),
    })
    let router = createAppRouter({ logging: { sink: () => {} }, runtime })
    let server = await createTestServer((request) => router.fetch(request))
    let page = await t.serve(server)
    await authenticate(page, server.baseUrl, runtime)

    await page.goto(routes.leagues.operations.dashboard.href({ leagueSlug: league.slug }))
    await page.getByLabel('Required game-build SHA-256').fill('a'.repeat(64))
    await page.getByRole('button', { name: 'Queue immutable attempt' }).click()
    await page.getByText('#1 · queued').waitFor()
    assert.deepEqual(queued, {
      awayLineupRevisionId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      contentPackRevisionId: null,
      dynamicRuleOverrides: {},
      executionMode: 'cpu-vs-cpu',
      gameStadiumId: 'mario-stadium',
      homeLineupRevisionId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      requiredGameBuildSha256: 'a'.repeat(64),
      rulesetRevisionId: RULESET_ID,
      statProfileRevisionId: PROFILE_ID,
    })

    await page.getByText('Add an audited scorer correction').click()
    await page.getByLabel('Team or character ID').fill(HOME_TEAM_ID)
    await page.getByLabel('Stat path').fill('hits')
    await page.getByLabel('Current value').fill('4')
    await page.getByLabel('Corrected value').fill('5')
    await page.getByLabel('Reason').fill('Official scorer ruling')
    await page.getByRole('button', { name: 'Record correction and rebuild' }).click()
    await page.getByText('1 correction receipt').click()
    await page.getByText(/Official scorer ruling/).waitFor()
    assert.deepEqual(corrected, {
      afterValue: 5,
      beforeValue: 4,
      entityId: HOME_TEAM_ID,
      entityType: 'team',
      reason: 'Official scorer ruling',
      statPath: 'hits',
    })
  })
})

async function authenticate(
  page: { context(): { addCookies(cookies: Array<{ name: string; value: string; url: string }>): Promise<void> } },
  baseUrl: string,
  runtime: AppRuntime,
) {
  let serialized = await runtime.sessionCookie.serialize('test-session')
  let [nameValue] = serialized.split(';', 1)
  let separator = nameValue!.indexOf('=')
  await page.context().addCookies([{
    name: nameValue!.slice(0, separator),
    url: baseUrl,
    value: nameValue!.slice(separator + 1),
  }])
}

function createRuntime(overrides: Partial<AppRuntime> = {}): AppRuntime {
  let repository: PlatformRepository = {
    async bootstrapSiteAdmin() { return identity },
    async completeDiscordLogin() { return identity },
    async consumeOAuthAttempt() { return null },
    async createOAuthAttempt() {},
    async createRunnerCredential() { return 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' },
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
    secrets: ['browser-workflow-test-secret'],
  }
  let runtime: AppRuntime = {
    broadcast: {} as AppRuntime['broadcast'],
    configuration: configurationApplication(() => draftLineup(), () => {}),
    content: {} as AppRuntime['content'],
    draft: draftApplication(draftRoom(), () => {}),
    identity: new IdentityService(repository, discord),
    leagueOperations: leagueOperationsApplication(),
    oauthCookie: createCookie('test_oauth', cookieOptions),
    operations: {} as AppRuntime['operations'],
    platform: new PlatformService(repository, {
      clock: () => new Date('2026-08-10T12:00:00Z'),
      createToken: () => 'test-invitation-token',
    }),
    runnerAdmin: runnerAdminApplication(operationsDashboard(), () => {}),
    runnerControl: {} as AppRuntime['runnerControl'],
    sessionCookie: createCookie('test_session', cookieOptions),
    telemetry: telemetryApplication(() => false, () => {}),
  }
  return Object.assign(runtime, overrides)
}

function draftApplication(room: DraftRoom, onPick: (input: unknown) => void): DraftApplication {
  return {
    async automaticPickAfterExpiry() { return {} as never },
    async createDraft() { return { id: DRAFT_ID } },
    async dashboard() { return { drafts: [], seasons: [], statProfiles: [] } },
    async getDraftRoom() { return room },
    async makePick(_identity, _leagueId, _draftId, input) {
      onPick(input)
      return {} as never
    },
    async pauseDraft() {},
    async resumeDraft() {},
    async reverseLatestPick() {},
    async startDraft() {},
    async updateQueue() {},
  }
}

function draftRoom(): DraftRoom {
  return {
    characters: [{
      characterId: 'mario',
      chemistry: [{ characterId: 'luigi', displayName: 'Luigi', relationship: 'positive' }],
      displayName: 'Mario',
      isCaptain: true,
      values: { batting: 88 },
    }],
    currentTeamId: HOME_TEAM_ID,
    draft: {
      cancelledAt: null,
      completedAt: null,
      createdAt: new Date('2026-08-10T12:00:00Z'),
      createdByPersonId: PERSON_ID,
      currentPickNumber: 1,
      deadline: new Date('2026-08-10T12:02:00Z'),
      gameId: 'RMBE01',
      id: DRAFT_ID,
      leagueId: LEAGUE_ID,
      name: 'Season One Draft',
      orderMode: 'snake',
      pausedAt: null,
      pickSeconds: 120,
      rounds: 9,
      seasonId: SEASON_ID,
      startedAt: new Date('2026-08-10T12:00:00Z'),
      statProfileRevisionId: PROFILE_ID,
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
      { managerPersonId: PERSON_ID, position: 1, teamId: HOME_TEAM_ID, teamName: 'Mario Fireballs' },
      { managerPersonId: null, position: 2, teamId: AWAY_TEAM_ID, teamName: 'Peach Monarchs' },
    ],
  }
}

function draftLineup(): TeamLineupRevision {
  return TeamLineupRevisionSchema.parse({
    ...lineupFixture,
    leagueId: LEAGUE_ID,
    lineupRevisionId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    publishedAt: null,
    rosterRevisionId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    status: 'draft',
    teamId: HOME_TEAM_ID,
  })
}

function configurationApplication(
  current: () => TeamLineupRevision,
  save: (lineup: TeamLineupRevision) => void,
): ConfigurationApplication {
  let unexpected = async () => { throw new Error('Unexpected configuration action') }
  return {
    cloneRulesetRevision: unexpected,
    cloneStatProfileRevision: unexpected,
    cloneTeamLineupRevision: unexpected,
    compilePublishedConfiguration: unexpected,
    createMatchLineupOverride: unexpected,
    createRulesetDraft: unexpected,
    createStatProfileDraft: unexpected,
    createTeamLineupDraft: unexpected,
    async dashboard() { return { profiles: [], rulesets: [], teams: [] } },
    getRulesetRevision: unexpected,
    getStatProfileRevision: unexpected,
    async getTeamLineupRevision(): Promise<TeamLineupRevisionDetail> {
      let revision = current()
      return {
        basedOnRevision: null,
        history: [{
          createdAt: new Date(revision.createdAt),
          id: revision.lineupRevisionId,
          publishedAt: revision.publishedAt ? new Date(revision.publishedAt) : null,
          revisionNumber: revision.lineupRevisionNumber,
          status: revision.status,
        }],
        issues: [],
        revision,
      }
    },
    publishRuleset: unexpected,
    publishStatProfile: unexpected,
    async publishTeamLineup() {
      let publishedAt = '2026-08-10T12:05:00.000Z'
      let published = TeamLineupRevisionSchema.parse({
        ...current(),
        publishedAt,
        status: 'published',
      })
      save(published)
      return published
    },
    updateRulesetDraft: unexpected,
    updateStatProfileDraft: unexpected,
    updateTeamLineupDraft: unexpected,
  } as ConfigurationApplication
}

function operationsDashboard(): RunnerOperationsDashboard {
  return {
    audit: [],
    contentPacks: [],
    matches: [{
      attempts: [],
      awayTeamId: AWAY_TEAM_ID,
      awayTeamName: 'Peach Monarchs',
      homeTeamId: HOME_TEAM_ID,
      homeTeamName: 'Mario Fireballs',
      id: MATCH_ID,
      scheduledAt: new Date('2026-08-10T12:30:00Z'),
      status: 'scheduled',
    }],
    rulesets: [{ id: RULESET_ID, name: 'League rules', revisionNumber: 1 }],
    seasons: [{
      id: SEASON_ID,
      name: 'Season One',
      teams: [
        {
          id: HOME_TEAM_ID,
          lineups: [{ id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', revisionNumber: 1 }],
          name: 'Mario Fireballs',
        },
        {
          id: AWAY_TEAM_ID,
          lineups: [{ id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', revisionNumber: 1 }],
          name: 'Peach Monarchs',
        },
      ],
    }],
    stations: [],
    statProfiles: [{ id: PROFILE_ID, name: 'Competitive stats', revisionNumber: 1 }],
    venues: [],
  }
}

function runnerAdminApplication(
  dashboard: RunnerOperationsDashboard,
  onQueue: (input: unknown) => void,
): RunnerAdminApplication {
  return {
    async dashboard() { return dashboard },
    async queueAttempt(_identity, _leagueId, _matchId, input) {
      onQueue(input)
      return { attemptId: ATTEMPT_ID, attemptNumber: 1 }
    },
    async revokeStation() {},
    async scheduleMatch() { return {} as never },
  }
}

function leagueOperationsApplication(): LeagueOperationsApplication {
  return {
    async cancelTrade() {},
    async dashboard() {
      return {
        deadlines: [],
        seasons: [{
          id: SEASON_ID,
          name: 'Season One',
          teams: [
            { id: HOME_TEAM_ID, managerPersonId: PERSON_ID, name: 'Mario Fireballs', roster: null },
            { id: AWAY_TEAM_ID, managerPersonId: null, name: 'Peach Monarchs', roster: null },
          ],
        }],
        trades: [],
      }
    },
    async proposeTrade() { return {} as never },
    async reviewTrade() {},
    async setDeadline() { return {} as never },
  }
}

function telemetryApplication(
  corrected: () => boolean,
  onCorrect: (input: unknown) => void,
): TelemetryApplication {
  let attempt = (): TelemetryAttemptSummary => ({
    attemptId: ATTEMPT_ID,
    attemptNumber: 1,
    attemptStatus: 'provisional',
    awayTeamId: AWAY_TEAM_ID,
    awayTeamName: 'Peach Monarchs',
    corrections: corrected() ? [{
      actorPersonId: PERSON_ID,
      afterValue: 5,
      beforeValue: 4,
      createdAt: new Date('2026-08-10T12:10:00Z'),
      entityId: HOME_TEAM_ID,
      entityType: 'team',
      id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      reason: 'Official scorer ruling',
      statPath: 'hits',
    }] : [],
    derivation: {
      boxScore: {
        characters: {},
        derivationVersion: 1,
        endedReason: 'completed',
        innings: 1,
        teams: {
          away: { errors: 0, hits: 3, lineScore: { '1': 1 }, runs: 1, teamId: AWAY_TEAM_ID },
          home: { errors: 0, hits: corrected() ? 5 : 4, lineScore: { '1': 2 }, runs: 2, teamId: HOME_TEAM_ID },
        },
      },
      correctionCount: corrected() ? 1 : 0,
      createdAt: new Date('2026-08-10T12:09:00Z'),
      id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      inputDigest: 'f'.repeat(64),
      status: 'ready',
    },
    health: {
      eventCount: 8,
      firstSequence: 1,
      issues: [],
      lastSequence: 8,
      nextExpectedSequence: 9,
      requiresReview: false,
    },
    homeTeamId: HOME_TEAM_ID,
    homeTeamName: 'Mario Fireballs',
    matchId: MATCH_ID,
    matchStatus: 'provisional',
    seasonId: SEASON_ID,
  })
  return {
    async confirm() {},
    async correct(_identity, _leagueId, _attemptId, input) {
      onCorrect(input)
      return {} as never
    },
    async dashboard() { return [attempt()] },
    async derive() { return {} as never },
    async finalizeHealthyAttempt() { throw new Error('Unexpected automatic finalization') },
    async ingest() { return {} as never },
    async rebuildSeason() { return { playerTotals: {}, standings: [] } },
  }
}
