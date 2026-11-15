import * as assert from 'remix/assert'
import { describe, it } from 'remix/test'

import { requirePlayableAlphaCapabilities, runnerVersionStatus } from './control-service.ts'

describe('runner version policy', () => {
  it('distinguishes current, recommended, and required updates', () => {
    assert.equal(runnerVersionStatus('0.3.0', '0.1.0', '0.2.0'), 'current')
    assert.equal(runnerVersionStatus('0.1.5', '0.1.0', '0.2.0'), 'update-available')
    assert.equal(runnerVersionStatus('0.0.9', '0.1.0', '0.2.0'), 'update-required')
  })

  it('allows claims only from the exact playable-alpha station target', () => {
    let supported = {
      adapterIds: ['sluggers-rmbe01'],
      architecture: 'arm64' as const,
      dolphinVersion: '2606',
      features: [
        'build-sluggers' as const,
        'launch-dolphin' as const,
        'runtime-bridge' as const,
        'telemetry-spool' as const,
      ],
      operatingSystem: 'macos' as const,
      runnerVersion: '0.1.0',
    }
    assert.doesNotThrow(() => requirePlayableAlphaCapabilities(supported))
    assert.throws(
      () => requirePlayableAlphaCapabilities({ ...supported, dolphinVersion: '2605' }),
      /Dolphin 2606/,
    )
    assert.throws(
      () => requirePlayableAlphaCapabilities({
        ...supported,
        features: supported.features.filter((feature) => feature !== 'telemetry-spool'),
      }),
      /telemetry-spool/,
    )
  })
})
