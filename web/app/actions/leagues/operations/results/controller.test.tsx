import * as assert from 'remix/assert'
import { describe, it } from 'remix/test'

import { createAppRouter } from '../../../../router.ts'
import { routes } from '../../../../routes.ts'
import type { TelemetryDerivationResult } from '../../../../telemetry/model.ts'
import { createOperationsRuntime, createTelemetry, league } from '../test-runtime.ts'

describe('league results controller', () => {
  it('renders standings and results as their own page', async () => {
    let runtime = createOperationsRuntime()
    let session = await runtime.sessionCookie.serialize('test-session')
    let response = await createAppRouter({ logging: { sink: () => {} }, runtime }).fetch(
      new Request('http://localhost' + routes.leagues.operations.results.index.href({ leagueSlug: league.slug }), {
        headers: { cookie: session },
      }),
    )
    let html = await response.text()
    assert.equal(response.status, 200)
    assert.match(html, />Results</)
    assert.match(html, /Standings/)
    assert.match(html, /Recent results/)
    assert.match(html, /Player leaders/)
    assert.doesNotMatch(html, /Game telemetry|Schedule a match|Discord delivery/)
  })

  it('parses a friendly scorer target into the canonical correction', async () => {
    let received: unknown
    let runtime = createOperationsRuntime({
      telemetry: createTelemetry({
        async correct(_identity, leagueId, attemptId, input) {
          received = { attemptId, input, leagueId }
          return emptyDerivation()
        },
      }),
    })
    let session = await runtime.sessionCookie.serialize('test-session')
    let response = await createAppRouter({ logging: { sink: () => {} }, runtime }).fetch(
      new Request('http://localhost' + routes.leagues.operations.results.correct.href({ leagueSlug: league.slug, attemptId: '33333333-3333-4333-8333-333333333333' }), {
        body: new URLSearchParams({
          afterValue: '3',
          correctionTarget: 'team|away-team|hits|2',
          reason: 'Official scorer ruling',
        }),
        headers: { cookie: session, origin: 'http://localhost' },
        method: 'POST',
      }),
    )
    assert.equal(response.status, 303)
    assert.deepEqual(received, {
      attemptId: '33333333-3333-4333-8333-333333333333',
      input: {
        afterValue: 3,
        beforeValue: 2,
        entityId: 'away-team',
        entityType: 'team',
        reason: 'Official scorer ruling',
        statPath: 'hits',
      },
      leagueId: league.id,
    })
  })
})

function emptyDerivation(): TelemetryDerivationResult {
  return {
    boxScore: {
      characters: {},
      derivationVersion: 1,
      endedReason: 'completed',
      innings: 7,
      teams: {
        away: { errors: 0, hits: 0, lineScore: {}, runs: 0, teamId: 'away-team' },
        home: { errors: 0, hits: 0, lineScore: {}, runs: 0, teamId: 'home-team' },
      },
    },
    correctionCount: 1,
    health: { eventCount: 1, firstSequence: 1, issues: [], lastSequence: 1, nextExpectedSequence: 2, requiresReview: false },
    inputDigest: 'digest',
  }
}
