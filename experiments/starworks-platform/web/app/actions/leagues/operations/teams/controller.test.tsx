import * as assert from 'remix/assert'
import { describe, it } from 'remix/test'

import { createAppRouter } from '../../../../router.ts'
import { routes } from '../../../../routes.ts'
import {
  createLeagueOperations,
  createNotifications,
  createOperationsRuntime,
  league,
} from '../test-runtime.ts'

describe('league teams controller', () => {
  it('renders rosters and trading without match or admin controls', async () => {
    let runtime = createOperationsRuntime()
    let session = await runtime.sessionCookie.serialize('test-session')
    let response = await createAppRouter({ logging: { sink: () => {} }, runtime }).fetch(
      new Request('http://localhost' + routes.leagues.operations.teams.index.href({ leagueSlug: league.slug }), {
        headers: { cookie: session },
      }),
    )
    let html = await response.text()
    assert.equal(response.status, 200)
    assert.match(html, /Current rosters/)
    assert.match(html, /Offer a trade/)
    assert.doesNotMatch(html, /Schedule a match|Discord/)
  })

  it('parses a roster trade offer into ordered character lists', async () => {
    let received: unknown
    let runtime = createOperationsRuntime({
      leagueOperations: createLeagueOperations({
        async proposeTrade(_identity, leagueId, input) {
          received = { input, leagueId }
          return { id: 'trade' }
        },
      }),
    })
    let session = await runtime.sessionCookie.serialize('test-session')
    let form = new URLSearchParams({
      counterpartyTeamId: '44444444-4444-4444-8444-444444444444',
      message: 'Captain exchange',
      proposerTeamId: '55555555-5555-4555-8555-555555555555',
      seasonId: '66666666-6666-4666-8666-666666666666',
    })
    form.append('counterpartyCharacterIds', 'peach')
    form.append('counterpartyCharacterIds', 'daisy')
    form.append('proposerCharacterIds', 'mario')
    form.append('proposerCharacterIds', 'luigi')
    let response = await createAppRouter({ logging: { sink: () => {} }, runtime }).fetch(
      new Request('http://localhost' + routes.leagues.operations.teams.proposeTrade.href({ leagueSlug: league.slug }), {
        body: form,
        headers: { cookie: session, origin: 'http://localhost' },
        method: 'POST',
      }),
    )

    assert.equal(response.status, 303)
    assert.deepEqual(received, {
      input: {
        counterpartyCharacterIds: ['peach', 'daisy'],
        counterpartyTeamId: '44444444-4444-4444-8444-444444444444',
        message: 'Captain exchange',
        proposerCharacterIds: ['mario', 'luigi'],
        proposerTeamId: '55555555-5555-4555-8555-555555555555',
        seasonId: '66666666-6666-4666-8666-666666666666',
      },
      leagueId: league.id,
    })
  })

  it('commits a trade even when best-effort Discord delivery rejects', async () => {
    let published: unknown
    let runtime = createOperationsRuntime({
      notifications: createNotifications({
        async publish(leagueId, input) {
          published = { input, leagueId }
          throw new Error('Discord is unavailable')
        },
      }),
    })
    let session = await runtime.sessionCookie.serialize('test-session')
    let response = await createAppRouter({ logging: { sink: () => {} }, runtime }).fetch(
      new Request('http://localhost' + routes.leagues.operations.teams.proposeTrade.href({ leagueSlug: league.slug }), {
        body: new URLSearchParams({
          counterpartyCharacterIds: 'peach',
          counterpartyTeamId: '44444444-4444-4444-8444-444444444444',
          message: '',
          proposerCharacterIds: 'mario',
          proposerTeamId: '55555555-5555-4555-8555-555555555555',
          seasonId: '66666666-6666-4666-8666-666666666666',
        }),
        headers: { cookie: session, origin: 'http://localhost' },
        method: 'POST',
      }),
    )

    assert.equal(response.status, 303)
    assert.deepEqual(published, {
      input: {
        dedupeKey: 'trade-proposed:trade',
        eventType: 'trade.proposed',
        message: '🔄 Shell League received a new trade proposal.',
      },
      leagueId: league.id,
    })
  })
})
