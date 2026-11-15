import * as assert from 'remix/assert'
import { describe, it } from 'remix/test'

import type { PlatformRepository } from '../../../../platform/repository.ts'
import { createAppRouter } from '../../../../router.ts'
import { routes } from '../../../../routes.ts'
import { createNotifications, createOperationsRuntime, league } from '../test-runtime.ts'

describe('league admin controller', () => {
  it('renders station and Discord administration without raw audit records', async () => {
    let runtime = createOperationsRuntime({ notifications: createNotifications() })
    let session = await runtime.sessionCookie.serialize('test-session')
    let response = await createAppRouter({ logging: { sink: () => {} }, runtime }).fetch(
      new Request('http://localhost' + routes.leagues.operations.admin.index.href({ leagueSlug: league.slug }), {
        headers: { cookie: session },
      }),
    )

    assert.equal(response.status, 200)
    let html = await response.text()
    assert.match(html, />Admin</)
    assert.match(html, /Discord/)
    assert.match(html, /Public access/)
    assert.match(html, /Player statistics/)
    assert.match(html, /Add a runner/)
    assert.match(html, /Runner stations/)
    assert.match(html, /Recent activity/)
    assert.match(html, /runner station · revoked/)
    assert.match(html, /Commissioner Mario/)
    assert.doesNotMatch(html, /targetId|runner_station\.revoked|\{\}/)
  })

  it('owns publication settings as an admin action', async () => {
    let received: unknown
    let runtime = createOperationsRuntime({
      async setPublicationPolicy(input) { received = input },
    })
    let session = await runtime.sessionCookie.serialize('test-session')
    let data = new FormData()
    data.set('leagueVisible', 'on')
    data.set('standingsVisible', 'on')
    let response = await createAppRouter({ logging: { sink: () => {} }, runtime }).fetch(
      new Request('http://localhost' + routes.leagues.operations.admin.updatePublication.href({ leagueSlug: league.slug }), {
        body: data,
        headers: { cookie: session, origin: 'http://localhost' },
        method: 'POST',
      }),
    )

    assert.equal(response.status, 303)
    assert.equal(response.headers.get('location'), routes.leagues.operations.admin.index.href({ leagueSlug: league.slug }))
    let { now, ...saved } = received as Parameters<PlatformRepository['setPublicationPolicy']>[0]
    assert.ok(now instanceof Date)
    assert.deepEqual(saved, {
      actorPersonId: '11111111-1111-4111-8111-111111111111',
      leagueId: league.id,
      policy: { draftVisible: false, leagueVisible: true, standingsVisible: true, statsVisible: false },
    })
  })
})
