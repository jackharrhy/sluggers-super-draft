import * as assert from 'remix/assert'
import { describe, it } from 'remix/test'

import {
  characterHeadshotPath,
  displayCharacterName,
  SLUGGERS_CHARACTER_IDS,
  sluggersCharacterIdAt,
  sluggersCharacterIndex,
} from './characters.ts'

describe('Sluggers character catalog', () => {
  it('maps every Stat Editor slot to one readable stable ID', () => {
    assert.equal(SLUGGERS_CHARACTER_IDS.length, 101)
    assert.equal(new Set(SLUGGERS_CHARACTER_IDS).size, 101)
    assert.equal(sluggersCharacterIdAt(0), 'mario')
    assert.equal(sluggersCharacterIdAt(100), 'black-mii-f')
  })

  it('keeps old numeric aliases readable during migration', () => {
    assert.equal(sluggersCharacterIndex('rmbe01-character-019'), 19)
    assert.equal(displayCharacterName('rmbe01-character-019'), 'Bowser Jr.')
    assert.equal(characterHeadshotPath('rmbe01-character-019'), '/player-headshots/bowser-jr.png')
  })
})
