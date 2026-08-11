import * as assert from 'remix/assert'
import { describe, it } from 'remix/test'

import { PlatformError } from '../platform/errors.ts'
import { correctionTargetValue, parseCorrectionTarget } from './corrections.ts'

describe('scorer correction targets', () => {
  it('round-trips a supported target without exposing a JSON form', () => {
    assert.deepEqual(
      parseCorrectionTarget(correctionTargetValue('character', 'mario', 'batting.homeRuns', 2)),
      { beforeValue: 2, entityId: 'mario', entityType: 'character', statPath: 'batting.homeRuns' },
    )
  })

  it('rejects unknown paths and malformed current values', () => {
    for (let value of ['team|club|lineScore.1|2', 'character|mario|batting.hits|-1', 'bogus|mario|hits|2']) {
      assert.throws(
        () => parseCorrectionTarget(value),
        (error: unknown) => error instanceof PlatformError && error.code === 'invalid_input',
      )
    }
  })
})
