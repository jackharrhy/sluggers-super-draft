import * as assert from 'remix/assert'
import { describe, it } from 'remix/test'

import { validateSluggersLineup } from './lineups.ts'

let valid = {
  battingOrder: ['mario', 'luigi', 'peach', 'daisy', 'yoshi', 'birdo', 'toad', 'toadette', 'bowser'],
  bench: [],
  captainCharacterId: 'mario',
  fielding: [
    { characterId: 'mario', position: 'P' as const },
    { characterId: 'luigi', position: 'C' as const },
    { characterId: 'peach', position: '1B' as const },
    { characterId: 'daisy', position: '2B' as const },
    { characterId: 'yoshi', position: '3B' as const },
    { characterId: 'birdo', position: 'SS' as const },
    { characterId: 'toad', position: 'LF' as const },
    { characterId: 'toadette', position: 'CF' as const },
    { characterId: 'bowser', position: 'RF' as const },
  ],
  pitcherCharacterId: 'mario',
}

describe('Sluggers lineup support', () => {
  it('accepts ordinary players with one of the twelve captain brands', () => {
    assert.deepEqual(validateSluggersLineup(valid), [])
  })

  it('rejects unused or Mii active slots and non-captain characters', () => {
    assert.deepEqual(validateSluggersLineup({
      ...valid,
      battingOrder: [...valid.battingOrder.slice(0, 8), 'unused-koopa'],
      captainCharacterId: 'toad',
    }), ['unsupported-active-character', 'unsupported-captain'])
    assert.deepEqual(validateSluggersLineup({
      ...valid,
      battingOrder: [...valid.battingOrder.slice(0, 8), 'red-mii-m'],
    }), ['unsupported-active-character'])
  })
})
