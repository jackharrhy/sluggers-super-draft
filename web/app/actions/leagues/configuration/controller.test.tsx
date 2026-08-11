import * as assert from 'remix/assert'
import { describe, it } from 'remix/test'

import type { AdapterOperationBundle } from '@starworks/contracts'

import type { ConfigurationApplication } from '../../../configuration/service.ts'
import { createAppRouter } from '../../../router.ts'
import { routes } from '../../../routes.ts'
import { buildStatEditorV4Fixture } from '../../../import/stat-editor-v4.fixture.ts'
import { importStatEditorV4 } from '../../../import/stat-editor-v4.ts'
import {
  configurationTestLeague as league,
  createConfigurationTestRuntime as createRuntime,
} from './test-runtime.ts'

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

  it('renders a readable game build preview without exposing the adapter bundle JSON', async () => {
    let bundle: AdapterOperationBundle = {
      adapterId: 'sluggers-rmbe01',
      adapterVersion: '0.1.0',
      generatedAt: '2026-08-11T12:00:00.000Z',
      kind: 'adapter-operation-bundle',
      leagueId: league.id,
      lineupRevisionId: '33333333-3333-4333-8333-333333333333',
      matchLineupOverrideId: null,
      operations: [
        { gameplayTarget: 'match.innings', loadPhase: 'runtime', operation: 'set-game-rule', ruleKey: 'innings', value: 7 },
        { characterId: 'mario', operation: 'select-roster-slot', slot: 0 },
        { characterId: 'mario', operation: 'set-captain' },
        { characterId: 'mario', operation: 'set-batting-slot', slot: 1 },
        { characterId: 'mario', operation: 'set-fielding-position', position: 'P' },
      ],
      rosterRevisionId: '44444444-4444-4444-8444-444444444444',
      rulesetRevisionId: '55555555-5555-4555-8555-555555555555',
      schemaVersion: 1,
      statProfileRevisionId: '66666666-6666-4666-8666-666666666666',
    }
    let configuration = {
      async compilePublishedConfiguration() { return bundle },
    } as unknown as ConfigurationApplication
    let runtime = createRuntime(configuration)
    let router = createAppRouter({ logging: { sink: () => {} }, runtime })
    let session = await runtime.sessionCookie.serialize('test-session')
    let data = new FormData()
    data.set('adapterVersion', bundle.adapterVersion)
    data.set('lineupSelection', `77777777-7777-4777-8777-777777777777:${bundle.lineupRevisionId}`)
    data.set('rulesetRevisionId', bundle.rulesetRevisionId)
    data.set('statProfileRevisionId', bundle.statProfileRevisionId)
    let response = await router.fetch(new Request('http://localhost' + routes.leagues.configuration.preview.href({ leagueSlug: league.slug }), {
      body: data,
      headers: { cookie: session, origin: 'http://localhost' },
      method: 'POST',
    }))

    assert.equal(response.status, 200)
    let html = await response.text()
    assert.match(html, /Ready for the runner/)
    assert.match(html, /Mario/)
    assert.match(html, /Captain/)
    assert.match(html, /Innings/)
    assert.doesNotMatch(html, /schemaVersion|lineupRevisionId|\{&quot;/)
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
    let href = routes.leagues.configuration.statProfiles.revision.character.edit.href({
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
    let response = await router.fetch(new Request('http://localhost' + routes.leagues.configuration.statProfiles.revision.export.href({
      leagueSlug: league.slug,
      revisionId: '44444444-4444-4444-8444-444444444444',
    }), { headers: { cookie: session } }))

    assert.equal(response.status, 200)
    assert.equal(response.headers.get('content-disposition'), 'attachment; filename="stat-profile-r3.txt"')
    assert.equal(await response.text(), source)
  })

  it('renders and updates a focused v4 tuning section', async () => {
    let imported = importStatEditorV4({
      profileName: 'Tuning profile',
      rawText: buildStatEditorV4Fixture(),
      sourceVersion: 'v4',
    })
    let previousTuning = structuredClone(imported.sluggersTuning!)
    let revision = {
      ...imported,
      basedOnRevisionId: '77777777-7777-4777-8777-777777777777',
      createdAt: '2026-08-11T12:00:00.000Z',
      kind: 'stat-profile-revision' as const,
      leagueId: league.id,
      profileId: '66666666-6666-4666-8666-666666666666',
      publishedAt: null,
      revisionId: '44444444-4444-4444-8444-444444444444',
      revisionNumber: 2,
      schemaVersion: 1 as const,
      status: 'draft' as const,
    }
    revision.sluggersTuning!.chemistry[1]![0] = (revision.sluggersTuning!.chemistry[1]![0]! + 1) % 3
    let basedOnRevision = {
      ...revision,
      basedOnRevisionId: null,
      publishedAt: '2026-08-10T12:00:00.000Z',
      revisionId: revision.basedOnRevisionId,
      revisionNumber: 1,
      sluggersTuning: previousTuning,
      status: 'published' as const,
    }
    let received: unknown
    let configuration = {
      async getStatProfileRevision() {
        return { basedOnRevision, history: [], issues: [], revision }
      },
      async updateStatProfileDraft(_identity: unknown, _leagueId: string, _revisionId: string, input: unknown) {
        received = input
        return revision
      },
    } as unknown as ConfigurationApplication
    let runtime = createRuntime(configuration)
    let router = createAppRouter({ logging: { sink: () => {} }, runtime })
    let session = await runtime.sessionCookie.serialize('test-session')
    let href = routes.leagues.configuration.statProfiles.revision.tuning.edit.href({
      leagueSlug: league.slug,
      revisionId: revision.revisionId,
      section: 'chemistry',
    })

    let page = await router.fetch(new Request(`http://localhost${href}?row=1`, { headers: { cookie: session } }))
    assert.equal(page.status, 200)
    let html = await page.text()
    assert.match(html, /Chemistry/)
    assert.match(html, /Baby Luigi/)
    assert.match(html, /<option value="[012]" selected(?:="")?>(?:Bad|Neutral|Good)<\/option>/)
    assert.match(html, /was [012]/)
    assert.doesNotMatch(html, /chemistry.*\[\[/)

    let data = new FormData()
    data.set('row', '1')
    revision.sluggersTuning.chemistry[1]!.forEach((value, column) => data.set(`value.${column}`, String((value + 1) % 3)))
    let response = await router.fetch(new Request(`http://localhost${href}`, {
      body: data,
      headers: { cookie: session, origin: 'http://localhost' },
      method: 'POST',
    }))

    assert.equal(response.status, 303)
    assert.equal(response.headers.get('location'), `${href}?row=1`)
    assert.equal((received as { sluggersTuning: typeof revision.sluggersTuning }).sluggersTuning.chemistry[1]![0], (revision.sluggersTuning.chemistry[1]![0]! + 1) % 3)
  })
})
