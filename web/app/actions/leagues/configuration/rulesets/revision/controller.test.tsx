import * as assert from 'remix/assert'
import { describe, it } from 'remix/test'

import type { ConfigurationApplication } from '../../../../../configuration/service.ts'
import { createStarterRulesetSettings, ruleInputName } from '../../../../../configuration/sluggers-rules.ts'
import { createAppRouter } from '../../../../../router.ts'
import { routes } from '../../../../../routes.ts'
import {
  configurationTestLeague as league,
  createConfigurationTestRuntime,
} from '../../test-runtime.ts'

describe('ruleset revision controller', () => {
  it('renders and updates supported rules through ordinary controls', async () => {
    let previousSettings = createStarterRulesetSettings()
    let settings = structuredClone(previousSettings)
    settings[0]!.value = 9
    let revision = {
      basedOnRevisionId: '77777777-7777-4777-8777-777777777777',
      createdAt: '2026-08-11T12:00:00.000Z',
      kind: 'ruleset-revision' as const,
      leagueId: league.id,
      name: 'Season rules',
      publishedAt: null,
      revisionId: '44444444-4444-4444-8444-444444444444',
      revisionNumber: 2,
      rulesetId: '66666666-6666-4666-8666-666666666666',
      schemaVersion: 1 as const,
      settings,
      status: 'draft' as const,
    }
    let basedOnRevision = {
      ...revision,
      basedOnRevisionId: null,
      publishedAt: '2026-08-10T12:00:00.000Z',
      revisionId: revision.basedOnRevisionId,
      revisionNumber: 1,
      settings: previousSettings,
      status: 'published' as const,
    }
    let received: unknown
    let configuration = {
      async getRulesetRevision() {
        return { basedOnRevision, history: [], revision }
      },
      async updateRulesetDraft(_identity: unknown, _leagueId: string, _revisionId: string, input: unknown) {
        received = input
        return revision
      },
    } as unknown as ConfigurationApplication
    let runtime = createConfigurationTestRuntime(configuration)
    let router = createAppRouter({ logging: { sink: () => {} }, runtime })
    let session = await runtime.sessionCookie.serialize('test-session')
    let href = routes.leagues.configuration.rulesets.revision.show.href({
      leagueSlug: league.slug,
      revisionId: revision.revisionId,
    })

    let page = await router.fetch(new Request('http://localhost' + href, { headers: { cookie: session } }))
    assert.equal(page.status, 200)
    let html = await page.text()
    assert.match(html, /Innings/)
    assert.match(html, /Mercy rule/)
    assert.match(html, /was 7/)
    assert.doesNotMatch(html, /textarea|gameplayTarget|<pre/)

    let form = new FormData()
    form.set('name', 'October rules')
    settings.forEach((setting, index) => form.set(
      ruleInputName(index),
      typeof setting.value === 'boolean' ? String(setting.value) : String(setting.value),
    ))
    form.set(ruleInputName(0), '5')
    let response = await router.fetch(new Request('http://localhost' + href, {
      body: form,
      headers: { cookie: session, origin: 'http://localhost' },
      method: 'POST',
    }))

    assert.equal(response.status, 303)
    assert.equal((received as { name: string }).name, 'October rules')
    assert.equal((received as { settings: typeof settings }).settings[0]!.value, 5)
  })
})
