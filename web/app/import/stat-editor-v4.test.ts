import * as assert from 'remix/assert'
import { describe, it } from 'remix/test'

import { validateStatProfileRevision } from '@starworks/contracts'

import { PlatformError } from '../platform/errors.ts'
import { buildStatEditorV4Fixture } from './stat-editor-v4.fixture.ts'
import { exportStatEditorV4, importStatEditorV4 } from './stat-editor-v4.ts'

describe('Stat Editor v4 importer', () => {
  it('translates character data into a typed Starworks stat profile draft', () => {
    let result = importStatEditorV4({
      profileName: 'Imported league stats',
      rawText: buildStatEditorV4Fixture(),
      sourceVersion: 'v4',
    })

    assert.equal(result.definitions.length, 49)
    assert.equal(result.characterValues.length, 101)
    assert.equal(result.characterValues[0]?.characterId, 'mario')
    assert.equal(result.characterValues[0]?.values['legacy.stat-editor.stat-12'], 112)
    assert.equal(result.characterValues[0]?.values['legacy.stat-editor.pitching-03'], 0.75)
    assert.equal(result.sluggersTuning.chemistry.length, 101)
    assert.equal(result.sluggersTuning.trajectoryTables.length, 24)
    assert.deepEqual(result.sluggersTuning.trajectoryNames, ['Medium', 'High', 'Low', 'Group 3', 'Group 4', 'Group 5'])
    assert.equal(result.sluggersTuning.globalSpeedCurves.length, 43)
    assert.equal(result.sluggersTuning.teamStarEvents.length, 12)
    assert.equal(result.sluggersTuning.starBoosts.length, 16)
    assert.equal(result.sluggersTuning.starHandicaps.length, 4)
    assert.equal(result.sluggersTuning.handicapParameters.length, 2)
    assert.equal(result.warnings.length, 1)
    assert.deepEqual(validateStatProfileRevision({
      basedOnRevisionId: null,
      characterValues: result.characterValues,
      createdAt: '2026-08-10T00:00:00Z',
      definitions: result.definitions,
      kind: 'stat-profile-revision',
      leagueId: '11111111-1111-4111-8111-111111111111',
      name: result.name,
      profileId: '22222222-2222-4222-8222-222222222222',
      publishedAt: null,
      revisionId: '33333333-3333-4333-8333-333333333333',
      revisionNumber: 1,
      schemaVersion: 1,
      sluggersTuning: result.sluggersTuning,
      status: 'draft',
    }), [])
  })

  it('round-trips every v4 section without dropping relational or global data', () => {
    let source = buildStatEditorV4Fixture()
    let imported = importStatEditorV4({
      profileName: 'Round trip',
      rawText: source,
      sourceVersion: 'v4',
    })
    let exported = exportStatEditorV4(imported)
    let reimported = importStatEditorV4({
      profileName: 'Round trip',
      rawText: exported,
      sourceVersion: 'v4',
    })

    assert.equal(exported, source)
    assert.deepEqual(reimported.characterValues, imported.characterValues)
    assert.deepEqual(reimported.sluggersTuning, imported.sluggersTuning)
  })

  it('refuses a mislabeled v3 snapshot instead of guessing', () => {
    let v3 = Array.from({ length: 228 }, () => '0').join('\n')
    assert.throws(
      () => importStatEditorV4({ profileName: 'Wrong version', rawText: v3, sourceVersion: 'v4' }),
      (error: unknown) => error instanceof PlatformError && /v3/.test(error.message),
    )
  })
})
