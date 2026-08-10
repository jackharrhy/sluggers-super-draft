import { createHash, timingSafeEqual } from 'node:crypto'

import { count, eq, sql } from 'drizzle-orm'

import type { ContentAssetStore } from '../content/object-store.ts'
import type { StarworksDatabase } from '../platform/database/connection.ts'
import {
  matchAttempts,
  runnerLeases,
  runnerStations,
  telemetryDerivations,
} from '../platform/database/schema.ts'

export interface ReadinessReport {
  checks: {
    garage: 'ready' | 'unavailable'
    postgres: 'ready' | 'unavailable'
  }
  status: 'ready' | 'unavailable'
}

export interface OperationsApplication {
  authorizeMetrics(authorization: string | null): boolean
  metrics(): Promise<string>
  readiness(): Promise<ReadinessReport>
}

type ComponentHealth = Record<string, string>

export class OperationsService implements OperationsApplication {
  readonly #metricsToken: string | undefined

  constructor(
    readonly database: StarworksDatabase,
    readonly assets: Pick<ContentAssetStore, 'ready'>,
    options: { metricsToken?: string } = {},
  ) {
    this.#metricsToken = options.metricsToken?.trim() || undefined
  }

  authorizeMetrics(authorization: string | null): boolean {
    if (!this.#metricsToken || !authorization?.startsWith('Bearer ')) return false
    let supplied = digest(authorization.slice('Bearer '.length))
    let expected = digest(this.#metricsToken)
    return timingSafeEqual(supplied, expected)
  }

  async readiness(): Promise<ReadinessReport> {
    let [postgresResult, garageResult] = await Promise.allSettled([
      this.database.execute(sql`select 1`),
      this.assets.ready(),
    ])
    let checks: ReadinessReport['checks'] = {
      garage: garageResult.status === 'fulfilled' ? 'ready' : 'unavailable',
      postgres: postgresResult.status === 'fulfilled' ? 'ready' : 'unavailable',
    }
    return {
      checks,
      status: checks.garage === 'ready' && checks.postgres === 'ready' ? 'ready' : 'unavailable',
    }
  }

  async metrics(): Promise<string> {
    let [attemptRows, stationRows, derivationRows, activeLeaseRows] = await Promise.all([
      this.database
        .select({
          failureKind: matchAttempts.failureKind,
          status: matchAttempts.status,
          value: count(),
        })
        .from(matchAttempts)
        .groupBy(matchAttempts.status, matchAttempts.failureKind),
      this.database
        .select({
          componentHealth: runnerStations.componentHealth,
          lastHeartbeatAt: runnerStations.lastHeartbeatAt,
          runtimeState: runnerStations.runtimeState,
          status: runnerStations.status,
        })
        .from(runnerStations),
      this.database
        .select({ status: telemetryDerivations.status, value: count() })
        .from(telemetryDerivations)
        .groupBy(telemetryDerivations.status),
      this.database
        .select({ value: count() })
        .from(runnerLeases)
        .where(eq(runnerLeases.status, 'active')),
    ])

    let stationCounts = new Map<string, number>()
    let componentCounts = new Map<string, number>()
    let staleStations = 0
    let staleBefore = Date.now() - 5 * 60 * 1000
    for (let station of stationRows) {
      increment(stationCounts, `${station.status}\0${station.runtimeState}`)
      if (
        station.status === 'active'
        && (!station.lastHeartbeatAt || station.lastHeartbeatAt.getTime() < staleBefore)
      ) {
        staleStations++
      }
      for (let [component, state] of Object.entries(
        (station.componentHealth ?? {}) as ComponentHealth,
      )) {
        increment(componentCounts, `${component}\0${state}`)
      }
    }

    let lines = [
      '# HELP starworks_match_attempts_total Persisted match attempts by lifecycle outcome.',
      '# TYPE starworks_match_attempts_total counter',
      ...attemptRows.map((row) => metric(
        'starworks_match_attempts_total',
        row.value,
        { failure_kind: row.failureKind ?? 'none', status: row.status },
      )),
      '# HELP starworks_runner_stations Current runner stations by enrollment and runtime state.',
      '# TYPE starworks_runner_stations gauge',
      ...[...stationCounts].sort().map(([key, value]) => {
        let [status, runtimeState] = key.split('\0')
        return metric('starworks_runner_stations', value, { runtime_state: runtimeState, status })
      }),
      '# HELP starworks_runner_components Current runner-reported component health.',
      '# TYPE starworks_runner_components gauge',
      ...[...componentCounts].sort().map(([key, value]) => {
        let [component, state] = key.split('\0')
        return metric('starworks_runner_components', value, { component, state })
      }),
      '# HELP starworks_runner_stations_stale Active stations without a heartbeat in five minutes.',
      '# TYPE starworks_runner_stations_stale gauge',
      metric('starworks_runner_stations_stale', staleStations),
      '# HELP starworks_runner_leases_active Current active runner leases.',
      '# TYPE starworks_runner_leases_active gauge',
      metric('starworks_runner_leases_active', activeLeaseRows[0]?.value ?? 0),
      '# HELP starworks_telemetry_derivations_total Persisted telemetry derivations by review status.',
      '# TYPE starworks_telemetry_derivations_total counter',
      ...derivationRows.map((row) => metric(
        'starworks_telemetry_derivations_total',
        row.value,
        { status: row.status },
      )),
    ]
    return `${lines.join('\n')}\n`
  }
}

function digest(value: string): Buffer {
  return createHash('sha256').update(value).digest()
}

function increment(counts: Map<string, number>, key: string): void {
  counts.set(key, (counts.get(key) ?? 0) + 1)
}

function metric(
  name: string,
  value: number,
  labels: Record<string, string | undefined> = {},
): string {
  let entries = Object.entries(labels).filter((entry): entry is [string, string] => entry[1] !== undefined)
  let suffix = entries.length
    ? `{${entries.map(([key, label]) => `${key}="${escapeLabel(label)}"`).join(',')}}`
    : ''
  return `${name}${suffix} ${value}`
}

function escapeLabel(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('\n', '\\n').replaceAll('"', '\\"')
}
