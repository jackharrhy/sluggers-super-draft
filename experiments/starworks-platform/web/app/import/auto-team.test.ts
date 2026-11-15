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

    assert.equal(result.lineup.captainCharacterId, 'mario')
    assert.equal(result.lineup.pitcherCharacterId, 'luigi')
    assert.equal(result.lineup.battingOrder[0], 'luigi')
    assert.deepEqual(result.lineup.fielding[0], {
      characterId: 'luigi',
      position: 'P',
    })
    assert.equal(result.rosterCharacterIds.length, 9)
  })

  it('refuses unused and machine-local Mii indices', () => {
    assert.throws(
      () => importAutoTeamSnapshot({
        team_names: ['Mii Team'],
        teams: [[
          [77, 0, 0], [1, 1, 1], [2, 2, 2], [3, 3, 3], [4, 4, 4],
          [5, 5, 5], [6, 6, 6], [7, 7, 7], [8, 8, 8],
        ]],
      }, 'Mii Team'),
      (error: unknown) => error instanceof PlatformError && /unused and Mii/.test(error.message),
    )
    assert.throws(
      () => importAutoTeamSnapshot({
        team_names: ['Unused Team'],
        teams: [[
          [71, 0, 0], [1, 1, 1], [2, 2, 2], [3, 3, 3], [4, 4, 4],
          [5, 5, 5], [6, 6, 6], [7, 7, 7], [8, 8, 8],
        ]],
      }, 'Unused Team'),
      (error: unknown) => error instanceof PlatformError && /unused and Mii/.test(error.message),
    )
  })
})
