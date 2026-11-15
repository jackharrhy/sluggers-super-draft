import assert from 'node:assert/strict'
import test from 'node:test'

import { currentSlot } from './service.ts'

let slots = [
  { position: 1, teamId: 'mario' },
  { position: 2, teamId: 'peach' },
  { position: 3, teamId: 'yoshi' },
]

test('snake draft order reverses alternate rounds', () => {
  let picks = Array.from({ length: 9 }, (_, index) => currentSlot({
    currentPickNumber: index + 1,
    orderMode: 'snake' as const,
    rounds: 3,
  }, slots)?.teamId)

  assert.deepEqual(picks, [
    'mario', 'peach', 'yoshi',
    'yoshi', 'peach', 'mario',
    'mario', 'peach', 'yoshi',
  ])
})

test('linear draft order stays forward and closes after the configured picks', () => {
  assert.equal(currentSlot({ currentPickNumber: 4, orderMode: 'linear', rounds: 2 }, slots)?.teamId, 'mario')
  assert.equal(currentSlot({ currentPickNumber: 6, orderMode: 'linear', rounds: 2 }, slots)?.teamId, 'yoshi')
  assert.equal(currentSlot({ currentPickNumber: 7, orderMode: 'linear', rounds: 2 }, slots), null)
})
