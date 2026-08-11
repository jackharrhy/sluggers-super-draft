import * as assert from 'remix/assert'
import { describe, it } from 'remix/test'

import { demoTeamLineup, parseLocalDemoMatch } from './local-demo-match.ts'

const validMatch = {
  league: 'mushroom-league',
  statProfile: 'competitive-demo-stats',
  ruleset: 'seven-inning-cpu-rules',
  stadium: 'mario-stadium',
  innings: 7,
  home: {
    team: 'mario-fireballs',
    captain: 'mario',
    battingOrder: ['mario', 'luigi', 'peach', 'daisy', 'yoshi', 'birdo', 'toad', 'toadette', 'bowser'],
    fielding: { P: 'luigi', C: 'mario', '1B': 'bowser', '2B': 'toad', '3B': 'daisy', SS: 'peach', LF: 'birdo', CF: 'yoshi', RF: 'toadette' },
  },
  away: {
    team: 'wario-muscles',
    captain: 'wario',
    battingOrder: ['wario', 'waluigi', 'donkey-kong', 'diddy-kong', 'bowser-jr', 'boo', 'king-boo', 'petey-piranha', 'dixie-kong'],
    fielding: { P: 'waluigi', C: 'boo', '1B': 'king-boo', '2B': 'diddy-kong', '3B': 'wario', SS: 'bowser-jr', LF: 'dixie-kong', CF: 'donkey-kong', RF: 'petey-piranha' },
  },
}

describe('local demo match configuration', () => {
  it('turns the friendly file into the normal lineup shape', () => {
    let match = parseLocalDemoMatch(validMatch)
    let home = demoTeamLineup(match.home)
    assert.equal(home.lineup.captainCharacterId, 'mario')
    assert.equal(home.lineup.pitcherCharacterId, 'luigi')
    assert.deepEqual(home.rosterCharacterIds, validMatch.home.battingOrder)
    assert.deepEqual(home.lineup.fielding[0], { characterId: 'luigi', position: 'P' })
  })

  it('rejects a runner-local Mii identity explicitly', () => {
    let input = structuredClone(validMatch)
    input.home.battingOrder[8] = 'mii:jack'
    input.home.fielding['1B'] = 'mii:jack'
    assert.throws(() => parseLocalDemoMatch(input), /RFL_DB\.dat/)
  })

  it('rejects fielding that does not match the nine active players', () => {
    let input = structuredClone(validMatch)
    input.home.fielding.RF = 'luigi'
    assert.throws(() => parseLocalDemoMatch(input), /fielding/)
  })
})
