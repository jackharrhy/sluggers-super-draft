import * as assert from 'remix/assert'
import { it } from 'remix/test'

import { StructuredLogger } from './request-logging.ts'

it('binds trusted domain identifiers without allowing log fields to spoof them', () => {
  let lines: string[] = []
  let log = new StructuredLogger(
    {
      actorId: null,
      correlationId: '11111111-1111-4111-8111-111111111111',
      leagueId: null,
      matchAttemptId: null,
      runnerId: null,
    },
    {
      clock: () => new Date('2026-08-10T12:00:00Z'),
      sink: (line) => lines.push(line),
    },
  )
  log.bind({
    actorId: '22222222-2222-4222-8222-222222222222',
    leagueId: '33333333-3333-4333-8333-333333333333',
    matchAttemptId: '44444444-4444-4444-8444-444444444444',
    runnerId: '55555555-5555-4555-8555-555555555555',
  })

  log.info('match.claimed', { actorId: 'untrusted-field-value' })

  let record = JSON.parse(lines[0]!)
  assert.equal(record.actorId, '22222222-2222-4222-8222-222222222222')
  assert.equal(record.leagueId, '33333333-3333-4333-8333-333333333333')
  assert.equal(record.matchAttemptId, '44444444-4444-4444-8444-444444444444')
  assert.equal(record.runnerId, '55555555-5555-4555-8555-555555555555')
})
