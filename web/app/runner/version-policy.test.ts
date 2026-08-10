import * as assert from 'remix/assert'
import { describe, it } from 'remix/test'

import { runnerVersionStatus } from './control-service.ts'

describe('runner version policy', () => {
  it('distinguishes current, recommended, and required updates', () => {
    assert.equal(runnerVersionStatus('0.3.0', '0.1.0', '0.2.0'), 'current')
    assert.equal(runnerVersionStatus('0.1.5', '0.1.0', '0.2.0'), 'update-available')
    assert.equal(runnerVersionStatus('0.0.9', '0.1.0', '0.2.0'), 'update-required')
  })
})
