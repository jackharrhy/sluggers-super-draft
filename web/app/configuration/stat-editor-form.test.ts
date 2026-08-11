import * as assert from 'remix/assert'
import { describe, it } from 'remix/test'

import type { StatDefinition } from '@starworks/contracts'

import { parseCharacterStatForm } from './stat-editor-form.ts'

const definitions: StatDefinition[] = [
  {
    dataType: 'integer',
    definitionId: '11111111-1111-4111-8111-111111111111',
    display: { group: 'Batting', label: 'Power', order: 1 },
    key: 'batting.power',
    maximum: 100,
    minimum: 0,
    required: true,
    step: 1,
  },
  {
    choices: [{ label: 'High', value: 'high' }, { label: 'Low', value: 'low' }],
    dataType: 'enum',
    definitionId: '22222222-2222-4222-8222-222222222222',
    display: { group: 'Batting', label: 'Trajectory', order: 2 },
    key: 'batting.trajectory',
    required: true,
  },
  {
    dataType: 'boolean',
    definitionId: '33333333-3333-4333-8333-333333333333',
    display: { group: 'Traits', label: 'Captain', order: 3 },
    key: 'traits.captain',
    required: true,
  },
]

describe('character stat form', () => {
  it('parses typed values from ordinary form controls', () => {
    let data = new FormData()
    data.set('stat.batting.power', '87')
    data.set('stat.batting.trajectory', 'high')
    data.set('stat.traits.captain', 'on')

    assert.deepEqual(parseCharacterStatForm(definitions, data), {
      'batting.power': 87,
      'batting.trajectory': 'high',
      'traits.captain': true,
    })
  })

  it('rejects out-of-range values at the form boundary', () => {
    let data = new FormData()
    data.set('stat.batting.power', '101')
    data.set('stat.batting.trajectory', 'low')
    assert.throws(() => parseCharacterStatForm(definitions, data), /between 0 and 100/)
  })
})
