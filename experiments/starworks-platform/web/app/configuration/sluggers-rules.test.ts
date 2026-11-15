import * as assert from 'remix/assert'
import { describe, it } from 'remix/test'

import {
  createStarterRulesetSettings,
  parseSupportedRuleValues,
  ruleInputName,
} from './sluggers-rules.ts'

describe('Sluggers rules forms', () => {
  it('creates only the rules supported by the web and live adapter', () => {
    let settings = createStarterRulesetSettings()

    assert.deepEqual(settings.map((setting) => setting.key), [
      'game.innings',
      'game.mercy',
      'game.stars',
      'game.items',
      'draft.timer-seconds',
    ])
    assert.deepEqual(settings.filter((setting) => setting.loadPhase === 'runtime').map((setting) => setting.gameplayTarget), [
      'rules.innings',
      'rules.mercy',
      'rules.stars',
      'rules.items',
    ])
  })

  it('updates supported values without allowing form fields to rewrite metadata', () => {
    let settings = createStarterRulesetSettings()
    let data = new FormData()
    settings.forEach((setting, index) => data.set(
      ruleInputName(index),
      typeof setting.value === 'boolean' ? 'false' : setting.key === 'draft.timer-seconds' ? '180' : '9',
    ))

    let updated = parseSupportedRuleValues(data, settings)

    assert.equal(updated[0]!.value, 9)
    assert.equal(updated[1]!.value, false)
    assert.equal(updated[0]!.gameplayTarget, 'rules.innings')
    assert.equal(updated[0]!.label, 'Innings')
  })

  it('preserves unknown settings and rejects values outside supported limits', () => {
    let settings = [
      ...createStarterRulesetSettings(),
      { key: 'custom.score-label', label: 'Score label', loadPhase: 'web-only' as const, value: 'Runs' },
    ]
    let data = new FormData()
    settings.slice(0, 5).forEach((setting, index) => data.set(
      ruleInputName(index),
      typeof setting.value === 'boolean' ? 'true' : setting.key === 'draft.timer-seconds' ? '120' : '7',
    ))
    data.set(ruleInputName(0), '100')

    assert.throws(() => parseSupportedRuleValues(data, settings))

    data.set(ruleInputName(0), '7')
    let updated = parseSupportedRuleValues(data, settings)
    assert.equal(updated.at(-1)?.value, 'Runs')
  })
})
