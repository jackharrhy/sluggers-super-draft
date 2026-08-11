import { TeamLineupRevisionSchema } from '@starworks/contracts'
import * as assert from 'remix/assert'
import { describe, it } from 'remix/test'

import lineupFixture from '../../../../../../../contracts/fixtures/valid/team-lineup-revision.json' with { type: 'json' }
import type { ConfigurationApplication } from '../../../../../configuration/service.ts'
import { battingInputName, fieldingInputName } from '../../../../../configuration/team-lineup-form.ts'
import { createAppRouter } from '../../../../../router.ts'
import { routes } from '../../../../../routes.ts'
import {
  configurationTestLeague as league,
  createConfigurationTestRuntime,
} from '../../test-runtime.ts'

describe('team lineup controller', () => {
  it('renders and updates a portrait-first lineup without exposing IDs as JSON', async () => {
    let revision = TeamLineupRevisionSchema.parse({
      ...lineupFixture,
      basedOnLineupRevisionId: null,
      leagueId: league.id,
      publishedAt: null,
      status: 'draft',
    })
    let received: unknown
    let configuration = {
      async dashboard() {
        return { profiles: [], rulesets: [], teams: [{ id: revision.teamId, lineups: [], name: 'Mario Fireballs' }] }
      },
      async getTeamLineupRevision() {
        return { basedOnRevision: null, history: [], issues: [], revision, teamName: 'Mario Fireballs' }
      },
      async updateTeamLineupDraft(_identity: unknown, _leagueId: string, _teamId: string, _revisionId: string, input: unknown) {
        received = input
        return revision
      },
    } as unknown as ConfigurationApplication
    let runtime = createConfigurationTestRuntime(configuration)
    let router = createAppRouter({ logging: { sink: () => {} }, runtime })
    let session = await runtime.sessionCookie.serialize('test-session')
    let href = routes.leagues.configuration.teams.lineup.show.href({
      leagueSlug: league.slug,
      revisionId: revision.lineupRevisionId,
      teamId: revision.teamId,
    })

    let page = await router.fetch(new Request('http://localhost' + href, { headers: { cookie: session } }))
    assert.equal(page.status, 200)
    let html = await page.text()
    assert.match(html, /Mario Fireballs/)
    assert.match(html, /player-headshots\/mario\.png/)
    assert.match(html, /Batting/)
    assert.match(html, /Fielding/)
    assert.doesNotMatch(html, /rosterCharacterIds|captainCharacterId|<pre|textarea/)

    let form = new FormData()
    form.set('captain', revision.lineup.captainCharacterId)
    revision.rosterCharacterIds.forEach((characterId, index) => {
      let batting = revision.lineup.battingOrder.indexOf(characterId)
      let fielding = revision.lineup.fielding.find((assignment) => assignment.characterId === characterId)
      form.set(battingInputName(index), batting === -1 ? 'bench' : String(batting + 1))
      form.set(fieldingInputName(index), fielding?.position ?? 'bench')
    })
    let response = await router.fetch(new Request('http://localhost' + href, {
      body: form,
      headers: { cookie: session, origin: 'http://localhost' },
      method: 'POST',
    }))

    assert.equal(response.status, 303)
    assert.deepEqual((received as { rosterCharacterIds: string[] }).rosterCharacterIds, revision.rosterCharacterIds)
    let receivedLineup = (received as { lineup: typeof revision.lineup }).lineup
    assert.deepEqual(receivedLineup.battingOrder, revision.lineup.battingOrder)
    assert.deepEqual(receivedLineup.bench, revision.lineup.bench)
    assert.equal(receivedLineup.captainCharacterId, revision.lineup.captainCharacterId)
    assert.equal(receivedLineup.pitcherCharacterId, revision.lineup.pitcherCharacterId)
    assert.deepEqual(
      receivedLineup.fielding.toSorted((left, right) => left.position.localeCompare(right.position)),
      revision.lineup.fielding.toSorted((left, right) => left.position.localeCompare(right.position)),
    )
  })
})
