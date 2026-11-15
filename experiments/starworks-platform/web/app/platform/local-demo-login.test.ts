import * as assert from 'remix/assert'
import { describe, it } from 'remix/test'

import {
  isLoopbackHostname,
  readLocalDemoLoginConfiguration,
} from './local-demo-login.ts'

describe('local demo login', () => {
  it('is disabled unless the explicit local-only mode is configured', () => {
    assert.equal(readLocalDemoLoginConfiguration({}), null)
    assert.equal(
      readLocalDemoLoginConfiguration({
        STARWORKS_DEMO_LEAGUE_SLUG: 'mushroom-league',
        STARWORKS_DEMO_SESSION_TOKEN: 'x'.repeat(32),
      }),
      null,
    )
  })

  it('requires a complete configuration and loopback hostname', () => {
    assert.deepEqual(
      readLocalDemoLoginConfiguration({
        STARWORKS_DEMO_LEAGUE_SLUG: 'mushroom-league',
        STARWORKS_DEMO_MODE: 'local-only',
        STARWORKS_DEMO_SESSION_TOKEN: 'x'.repeat(32),
      }),
      { leagueSlug: 'mushroom-league', sessionToken: 'x'.repeat(32) },
    )
    assert.throws(() =>
      readLocalDemoLoginConfiguration({
        STARWORKS_DEMO_MODE: 'local-only',
        STARWORKS_DEMO_SESSION_TOKEN: 'short',
      }),
    )
    assert.equal(isLoopbackHostname('127.0.0.1'), true)
    assert.equal(isLoopbackHostname('localhost'), true)
    assert.equal(isLoopbackHostname('[::1]'), true)
    assert.equal(isLoopbackHostname('starworks.example'), false)
  })
})
