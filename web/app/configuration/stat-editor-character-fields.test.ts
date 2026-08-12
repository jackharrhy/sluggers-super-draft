import * as assert from 'remix/assert'
import { describe, it } from 'remix/test'

import {
  displayStatEditorCharacterValue,
  statEditorCharacterChoices,
} from './stat-editor-character-fields.ts'

describe('Stat Editor character field presentation', () => {
  it('presents known numeric encodings as named choices', () => {
    assert.deepEqual(
      statEditorCharacterChoices('legacy.stat-editor.stat-00', []),
      [{ label: 'Right', value: 0 }, { label: 'Left', value: 1 }],
    )
    assert.equal(
      displayStatEditorCharacterValue('legacy.stat-editor.stat-08', 11, []),
      'Laser Beam',
    )
  })

  it('uses profile-owned trajectory names without changing stored values', () => {
    let names = ['Medium', 'High', 'Low', 'Custom A', 'Custom B', 'Custom C']
    assert.equal(displayStatEditorCharacterValue('legacy.stat-editor.stat-26', 4, names), 'Custom B')
    assert.deepEqual(
      statEditorCharacterChoices('legacy.stat-editor.stat-26', names, [1, 1, 1, 0, 1, 0]),
      [
        { label: 'Medium', value: 0 },
        { label: 'High', value: 1 },
        { label: 'Low', value: 2 },
        { label: 'Custom B', value: 4 },
      ],
    )
  })

  it('leaves ordinary numeric fields numeric', () => {
    assert.equal(statEditorCharacterChoices('legacy.stat-editor.stat-12', []), null)
    assert.equal(displayStatEditorCharacterValue('legacy.stat-editor.stat-12', 50, []), '50')
  })
})
