import * as assert from 'remix/assert'
import { describe, it } from 'remix/test'

import { buildStatEditorV4Fixture } from '../import/stat-editor-v4.fixture.ts'
import { importStatEditorV4 } from '../import/stat-editor-v4.ts'
import {
  parseStatEditorTuningSection,
  selectedTuningRow,
  updateStatEditorTuning,
} from './stat-editor-tuning.ts'

function tuning() {
  return importStatEditorV4({
    profileName: 'Editor fixture',
    rawText: buildStatEditorV4Fixture(),
    sourceVersion: 'v4',
  }).sluggersTuning
}

describe('Stat Editor tuning forms', () => {
  it('updates one chemistry row without changing its neighbors', () => {
    let original = tuning()
    let data = new FormData()
    data.set('row', '2')
    original.chemistry[2]!.forEach((value, column) => data.set(`value.${column}`, String((value + 1) % 3)))

    let updated = updateStatEditorTuning(original, 'chemistry', data)

    assert.deepEqual(updated.chemistry[0], original.chemistry[0])
    assert.equal(updated.chemistry[2]![0], (original.chemistry[2]![0]! + 1) % 3)
    assert.notEqual(updated.chemistry, original.chemistry)
  })

  it('updates a complete trajectory group and its metadata', () => {
    let original = tuning()
    let data = new FormData()
    data.set('row', '1')
    data.set('name', 'Moon shots')
    data.set('activation', '1')
    for (let swing = 0; swing < 4; swing++) {
      for (let column = 0; column < 25; column++) data.set(`value.${swing}.${column}`, String(swing * 20 + column))
    }

    let updated = updateStatEditorTuning(original, 'trajectories', data)

    assert.equal(updated.trajectoryNames[1], 'Moon shots')
    assert.equal(updated.trajectoryTables[4]![24], 24)
    assert.equal(updated.trajectoryTables[7]![24], 84)
    assert.deepEqual(updated.trajectoryTables[0], original.trajectoryTables[0])
  })

  it('validates section names, row bounds, and handicap bytes', () => {
    assert.equal(parseStatEditorTuningSection('star-boosts'), 'star-boosts')
    assert.throws(() => parseStatEditorTuningSection('raw-json'))
    assert.equal(selectedTuningRow('star-events', '11'), 11)
    assert.throws(() => selectedTuningRow('star-events', '12'))

    let data = new FormData()
    for (let row = 0; row < 4; row++) {
      for (let column = 0; column < 2; column++) data.set(`value.${row}.${column}`, '1')
    }
    for (let row = 0; row < 2; row++) {
      for (let column = 0; column < 3; column++) data.set(`parameter.${row}.${column}`, '256')
    }
    assert.throws(() => updateStatEditorTuning(tuning(), 'handicaps', data))
  })

  it('updates every remaining v4 table through typed form fields', () => {
    let original = tuning()

    let speedData = matrixForm('value', 43, 2, (row, column) => row + column / 10)
    let speed = updateStatEditorTuning(original, 'speed-curves', speedData)
    assert.deepEqual(speed.globalSpeedCurves[42], [42, 42.1])
    assert.deepEqual(speed.starBoosts, original.starBoosts)

    let eventData = new FormData()
    eventData.set('row', '7')
    for (let column = 0; column < 41; column++) eventData.set(`value.${column}`, String(column - 20))
    let events = updateStatEditorTuning(original, 'star-events', eventData)
    assert.equal(events.teamStarEvents[7]![40], 20)
    assert.deepEqual(events.teamStarEvents[6], original.teamStarEvents[6])

    let boostData = matrixForm('value', 16, 4, (row, column) => column === 0 ? (row % 2) + 1 : row * 10 + column)
    let boosts = updateStatEditorTuning(original, 'star-boosts', boostData)
    assert.deepEqual(boosts.starBoosts[15], [2, 151, 152, 153])

    let handicapData = matrixForm('value', 4, 2, (row, column) => row - column / 10)
    appendMatrix(handicapData, 'parameter', 2, 3, (row, column) => row * 10 + column)
    let handicaps = updateStatEditorTuning(original, 'handicaps', handicapData)
    assert.deepEqual(handicaps.starHandicaps[3], [3, 2.9])
    assert.deepEqual(handicaps.handicapParameters[1], [10, 11, 12])
  })
})

function matrixForm(
  prefix: string,
  rows: number,
  columns: number,
  value: (row: number, column: number) => number,
): FormData {
  let data = new FormData()
  appendMatrix(data, prefix, rows, columns, value)
  return data
}

function appendMatrix(
  data: FormData,
  prefix: string,
  rows: number,
  columns: number,
  value: (row: number, column: number) => number,
): void {
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      data.set(`${prefix}.${row}.${column}`, String(value(row, column)))
    }
  }
}
