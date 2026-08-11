import * as assert from 'remix/assert'
import { describe, it } from 'remix/test'

import type { ConfigurationApplication } from '../../../../configuration/service.ts'
import { createStarterRulesetSettings } from '../../../../configuration/sluggers-rules.ts'
import { createAppRouter } from '../../../../router.ts'
import { routes } from '../../../../routes.ts'
import {
  configurationTestLeague as league,
  createConfigurationTestRuntime,
} from '../test-runtime.ts'

describe('rulesets controller', () => {
  it('creates the supported Sluggers starter rules without accepting rule JSON', async () => {
    let received: unknown
    let configuration = {
      async createRulesetDraft(_identity: unknown, leagueId: string, input: unknown) {
        received = { input, leagueId }
        return { revisionId: '44444444-4444-4444-8444-444444444444' }
      },
      async dashboard() { return { profiles: [], rulesets: [], teams: [] } },
    } as unknown as ConfigurationApplication
    let runtime = createConfigurationTestRuntime(configuration)
    let router = createAppRouter({ logging: { sink: () => {} }, runtime })
    let session = await runtime.sessionCookie.serialize('test-session')

    let page = await router.fetch(new Request(
      'http://localhost' + routes.leagues.configuration.rulesets.index.href({ leagueSlug: league.slug }),
      { headers: { cookie: session } },
    ))
    assert.equal(page.status, 200)
    let html = await page.text()
    assert.match(html, /New ruleset/)
    assert.doesNotMatch(html, /Rule settings|textarea/)

    let form = new FormData()
    form.set('name', 'Season rules')
    form.set('slug', 'season-rules')
    let response = await router.fetch(new Request(
      'http://localhost' + routes.leagues.configuration.rulesets.create.href({ leagueSlug: league.slug }),
      { body: form, headers: { cookie: session, origin: 'http://localhost' }, method: 'POST' },
    ))

    assert.equal(response.status, 303)
    assert.equal((received as { input: { settings: Array<{ key: string }> } }).input.settings.length, 5)
    assert.deepEqual(
      (received as { input: { settings: Array<{ key: string }> } }).input.settings.map((setting) => setting.key),
      createStarterRulesetSettings().map((setting) => setting.key),
    )
  })
})
