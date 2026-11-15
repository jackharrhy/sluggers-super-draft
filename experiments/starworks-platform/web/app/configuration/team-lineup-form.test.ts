import * as assert from 'remix/assert'
import { describe, it } from 'remix/test'

import {
  battingInputName,
  fieldingInputName,
  parseTeamLineupForm,
} from './team-lineup-form.ts'

const roster = ['mario', 'luigi', 'peach', 'daisy', 'yoshi', 'birdo', 'toad', 'toadette', 'bowser', 'wario']
const positions = ['C', 'P', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF']

describe('team lineup forms', () => {
  it('builds the effective lineup from ordinary roster controls', () => {
    let data = validForm()

    let lineup = parseTeamLineupForm(data, roster)

    assert.deepEqual(lineup.battingOrder, roster.slice(0, 9))
    assert.deepEqual(lineup.bench, ['wario'])
    assert.equal(lineup.captainCharacterId, 'mario')
    assert.equal(lineup.pitcherCharacterId, 'luigi')
    assert.deepEqual(lineup.fielding[1], { characterId: 'luigi', position: 'P' })
  })

  it('rejects duplicate batting and fielding slots at the form boundary', () => {
    let batting = validForm()
    batting.set(battingInputName(1), '1')
    assert.throws(() => parseTeamLineupForm(batting, roster))

    let fielding = validForm()
    fielding.set(fieldingInputName(1), 'C')
    assert.throws(() => parseTeamLineupForm(fielding, roster))
  })

  it('requires the captain and every fielder to be active', () => {
    let captain = validForm()
    captain.set('captain', 'wario')
    assert.throws(() => parseTeamLineupForm(captain, roster))

    let fielder = validForm()
    fielder.set(fieldingInputName(8), 'bench')
    fielder.set(fieldingInputName(9), 'RF')
    assert.throws(() => parseTeamLineupForm(fielder, roster))
  })

  it('rejects game slots and captains the runner cannot execute', () => {
    let unsupportedCaptain = validForm()
    unsupportedCaptain.set('captain', 'toad')
    assert.throws(() => parseTeamLineupForm(unsupportedCaptain, roster), /twelve/)

    let unsupportedRoster = [...roster]
    unsupportedRoster[8] = 'unused-koopa'
    let unused = validForm()
    assert.throws(() => parseTeamLineupForm(unused, unsupportedRoster), /71 ordinary/)
  })
})

function validForm(): FormData {
  let data = new FormData()
  data.set('captain', 'mario')
  roster.forEach((_, index) => {
    data.set(battingInputName(index), index < 9 ? String(index + 1) : 'bench')
    data.set(fieldingInputName(index), positions[index] ?? 'bench')
  })
  return data
}
