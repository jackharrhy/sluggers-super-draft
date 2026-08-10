import * as assert from 'remix/assert'
import { describe, it } from 'remix/test'

import { createAppRouter } from '../router.ts'
import { routes } from '../routes.ts'

const CORRELATION_ID = '11111111-1111-4111-8111-111111111111'

describe('root controller', () => {
  it('renders Starworks and emits a correlated structured request log', async () => {
    let lines: string[] = []
    let router = createAppRouter({
      logging: {
        clock: () => new Date('2026-08-10T12:00:00Z'),
        sink: (line) => lines.push(line),
      },
    })
    let response = await router.fetch(
      new Request('http://localhost' + routes.home.href(), {
        headers: { 'x-correlation-id': CORRELATION_ID },
      }),
    )

    assert.equal(response.status, 200)
    assert.equal(response.headers.get('x-correlation-id'), CORRELATION_ID)
    assert.match(await response.text(), /Starworks/)
    assert.equal(lines.length, 1)

    let record = JSON.parse(lines[0]!)
    assert.equal(record.event, 'http.request.completed')
    assert.equal(record.correlationId, CORRELATION_ID)
    assert.equal(record.actorId, null)
    assert.equal(record.leagueId, null)
    assert.equal(record.matchAttemptId, null)
    assert.equal(record.runnerId, null)
    assert.equal(record.method, 'GET')
    assert.equal(record.path, '/')
    assert.equal(record.status, 200)
  })

  it('replaces an invalid inbound correlation ID', async () => {
    let router = createAppRouter({
      logging: {
        createCorrelationId: () => CORRELATION_ID,
        sink: () => {},
      },
    })
    let response = await router.fetch(
      new Request('http://localhost' + routes.home.href(), {
        headers: { 'x-correlation-id': 'not-a-uuid' },
      }),
    )

    assert.equal(response.headers.get('x-correlation-id'), CORRELATION_ID)
  })
})
