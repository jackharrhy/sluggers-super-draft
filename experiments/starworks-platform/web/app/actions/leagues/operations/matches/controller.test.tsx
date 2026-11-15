import * as assert from 'remix/assert'
import { describe, it } from 'remix/test'

import { createAppRouter } from '../../../../router.ts'
import { routes } from '../../../../routes.ts'
import { createOperationsRuntime, createRunnerAdmin, league } from '../test-runtime.ts'

describe('league matches controller', () => {
  it('renders a focused schedule without results or admin controls', async () => {
    let runtime = createOperationsRuntime()
    let session = await runtime.sessionCookie.serialize('test-session')
    let response = await createAppRouter({ logging: { sink: () => {} }, runtime }).fetch(
      new Request('http://localhost' + routes.leagues.operations.matches.index.href({ leagueSlug: league.slug }), {
        headers: { cookie: session },
      }),
    )

    assert.equal(response.status, 200)
    let html = await response.text()
    assert.match(html, />Matches</)
    assert.match(html, /Schedule a match/)
    assert.doesNotMatch(html, /Standings/)
    assert.doesNotMatch(html, /Discord/)
  })

  it('parses a scheduled match form through Remix FormData middleware', async () => {
    let received: unknown
    let runtime = createOperationsRuntime({
      runnerAdmin: createRunnerAdmin({
        async scheduleMatch(_identity, leagueId, input) {
          received = { input, leagueId }
          return { id: '33333333-3333-4333-8333-333333333333' }
        },
      }),
    })
    let session = await runtime.sessionCookie.serialize('test-session')
    let response = await createAppRouter({ logging: { sink: () => {} }, runtime }).fetch(
      new Request('http://localhost' + routes.leagues.operations.matches.schedule.href({ leagueSlug: league.slug }), {
        body: new URLSearchParams({
          awayTeamId: '44444444-4444-4444-8444-444444444444',
          homeTeamId: '55555555-5555-4555-8555-555555555555',
          scheduledAt: '2026-08-10T19:30',
          scheduleTiming: 'later',
          seasonId: '66666666-6666-4666-8666-666666666666',
        }),
        headers: { cookie: session, origin: 'http://localhost' },
        method: 'POST',
      }),
    )

    assert.equal(response.status, 303)
    assert.deepEqual(received, {
      input: {
        awayTeamId: '44444444-4444-4444-8444-444444444444',
        homeTeamId: '55555555-5555-4555-8555-555555555555',
        scheduledAt: new Date('2026-08-10T19:30'),
        seasonId: '66666666-6666-4666-8666-666666666666',
        venueId: null,
      },
      leagueId: league.id,
    })
  })

  it('schedules a match for the current time without a datetime value', async () => {
    let received: { input: { scheduledAt: Date } } | undefined
    let runtime = createOperationsRuntime({
      runnerAdmin: createRunnerAdmin({
        async scheduleMatch(_identity, _leagueId, input) {
          received = { input: input as { scheduledAt: Date } }
          return { id: '33333333-3333-4333-8333-333333333333' }
        },
      }),
    })
    let session = await runtime.sessionCookie.serialize('test-session')
    let before = Date.now()
    let response = await createAppRouter({ logging: { sink: () => {} }, runtime }).fetch(
      new Request('http://localhost' + routes.leagues.operations.matches.schedule.href({ leagueSlug: league.slug }), {
        body: new URLSearchParams({
          awayTeamId: '44444444-4444-4444-8444-444444444444',
          homeTeamId: '55555555-5555-4555-8555-555555555555',
          scheduleTiming: 'now',
          seasonId: '66666666-6666-4666-8666-666666666666',
        }),
        headers: { cookie: session, origin: 'http://localhost' },
        method: 'POST',
      }),
    )

    assert.equal(response.status, 303)
    assert.ok(received)
    assert.ok(received.input.scheduledAt.getTime() >= before)
    assert.ok(received.input.scheduledAt.getTime() <= Date.now())
  })
})
