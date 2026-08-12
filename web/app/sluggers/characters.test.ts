import * as assert from 'remix/assert'
import { describe, it } from 'remix/test'

import {
  characterHeadshotPath,
  displayCharacterName,
  SLUGGERS_CHARACTER_IDS,
  sluggersCharacterIdAt,
  sluggersCharacterIndex,
  sluggersCharacterKind,
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

  it('classifies playable, Mii, and unused Stat Editor slots', () => {
    assert.equal(sluggersCharacterKind('mario'), 'playable')
    assert.equal(sluggersCharacterKind('rmbe01-character-077'), 'mii')
    assert.equal(sluggersCharacterKind('unused-koopa'), 'unused')
    assert.equal(SLUGGERS_CHARACTER_IDS.filter((id) => sluggersCharacterKind(id) === 'playable').length, 71)
    assert.equal(SLUGGERS_CHARACTER_IDS.filter((id) => sluggersCharacterKind(id) === 'mii').length, 24)
    assert.equal(SLUGGERS_CHARACTER_IDS.filter((id) => sluggersCharacterKind(id) === 'unused').length, 6)
  })
})
