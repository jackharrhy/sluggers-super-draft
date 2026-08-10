import * as assert from 'remix/assert'
import { describe, it } from 'remix/test'

import { PlatformError } from '../platform/errors.ts'
import { importAutoTeamSnapshot } from './auto-team.ts'

describe('AutoTeam importer', () => {
  it('turns legacy slot triples into a legal declarative lineup', () => {
    let result = importAutoTeamSnapshot({
      team_names: ['Mario Fireballs'],
      teams: [[
        [0, 3, 1],
        [1, 0, 0],
        [2, 1, 2],
        [3, 2, 3],
        [4, 4, 4],
        [5, 5, 5],
        [6, 6, 6],
        [7, 7, 7],
        [8, 8, 8],
      ]],
    }, 'Mario Fireballs')

    assert.equal(result.lineup.captainCharacterId, 'rmbe01-character-000')
    assert.equal(result.lineup.pitcherCharacterId, 'rmbe01-character-001')
    assert.equal(result.lineup.battingOrder[0], 'rmbe01-character-001')
    assert.deepEqual(result.lineup.fielding[0], {
      characterId: 'rmbe01-character-001',
      position: 'P',
    })
    assert.equal(result.rosterCharacterIds.length, 9)
  })

  it('refuses machine-local Mii indices', () => {
    assert.throws(
      () => importAutoTeamSnapshot({
        team_names: ['Mii Team'],
        teams: [[
          [77, 0, 0], [1, 1, 1], [2, 2, 2], [3, 3, 3], [4, 4, 4],
          [5, 5, 5], [6, 6, 6], [7, 7, 7], [8, 8, 8],
        ]],
      }, 'Mii Team'),
      (error: unknown) => error instanceof PlatformError && /RFL_DB/.test(error.message),
    )
  })
})
