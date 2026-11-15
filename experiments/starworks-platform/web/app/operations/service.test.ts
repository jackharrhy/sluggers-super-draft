import * as assert from 'remix/assert'
import { describe, it } from 'remix/test'

import type { StarworksDatabase } from '../platform/database/connection.ts'
import { OperationsService } from './service.ts'

describe('operations service', () => {
  it('compares the metrics credential without exposing whether one is configured', () => {
    let database = {} as StarworksDatabase
    let assets = { async ready() {} }

    let configured = new OperationsService(database, assets, { metricsToken: 'metrics-secret' })
    assert.equal(configured.authorizeMetrics(null), false)
    assert.equal(configured.authorizeMetrics('Basic metrics-secret'), false)
    assert.equal(configured.authorizeMetrics('Bearer wrong'), false)
    assert.equal(configured.authorizeMetrics('Bearer metrics-secret'), true)

    let disabled = new OperationsService(database, assets)
    assert.equal(disabled.authorizeMetrics('Bearer metrics-secret'), false)
  })

  it('checks PostgreSQL and Garage independently', async () => {
    let database = { async execute() {} } as unknown as StarworksDatabase
    let ready = new OperationsService(database, { async ready() {} })
    assert.deepEqual(await ready.readiness(), {
      checks: { garage: 'ready', postgres: 'ready' },
      status: 'ready',
    })

    let unavailable = new OperationsService(database, {
      async ready() { throw new Error('Garage offline') },
    })
    assert.deepEqual(await unavailable.readiness(), {
      checks: { garage: 'unavailable', postgres: 'ready' },
      status: 'unavailable',
    })
  })

  it('exports aggregate failure, runner, stream, and telemetry metrics without identifiers', async () => {
    let responses = [
      [{ failureKind: 'build-failure', status: 'failed', value: 2 }],
      [{
        componentHealth: { bridge: 'healthy', publishing: 'degraded' },
        lastHeartbeatAt: new Date(0),
        runtimeState: 'degraded',
        status: 'active',
      }],
      [{ status: 'review', value: 3 }],
      [{ value: 1 }],
    ]
    let selected = 0
    let database = {
      select() {
        let value = responses[selected++]!
        return {
          from() {
            return {
              groupBy: async () => value,
              then(resolve: (rows: unknown[]) => void) { resolve(value) },
              where: async () => value,
            }
          },
        }
      },
    } as unknown as StarworksDatabase
    let service = new OperationsService(database, { async ready() {} })

    let metrics = await service.metrics()

    assert.match(metrics, /failure_kind="build-failure",status="failed"} 2/)
    assert.match(metrics, /component="publishing",state="degraded"} 1/)
    assert.match(metrics, /starworks_runner_stations_stale 1/)
    assert.match(metrics, /starworks_runner_leases_active 1/)
    assert.match(metrics, /starworks_telemetry_derivations_total\{status="review"} 3/)
    assert.doesNotMatch(metrics, /league|runnerId|matchId|stationId/)
  })
})
