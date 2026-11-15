import { PlatformError } from '../platform/errors.ts'

export const CORRECTABLE_TEAM_STATS = [
  { label: 'Runs', path: 'runs' },
  { label: 'Hits', path: 'hits' },
  { label: 'Errors', path: 'errors' },
] as const

export const CORRECTABLE_CHARACTER_STATS = [
  { label: 'Hits', path: 'batting.hits' },
  { label: 'Home runs', path: 'batting.homeRuns' },
  { label: 'Runs batted in', path: 'batting.runsBattedIn' },
  { label: 'Runs', path: 'running.runs' },
  { label: 'Errors', path: 'fielding.errors' },
] as const

export function parseCorrectionTarget(value: string): {
  beforeValue: number
  entityId: string
  entityType: 'team' | 'character'
  statPath: string
} {
  let [entityType, entityId, statPath, beforeRaw, ...extra] = value.split('|')
  if (entityType !== 'team' && entityType !== 'character') {
    throw new PlatformError('Correction target is invalid', 'invalid_input')
  }
  let allowed = entityType === 'team'
    ? CORRECTABLE_TEAM_STATS.some((stat) => stat.path === statPath)
    : CORRECTABLE_CHARACTER_STATS.some((stat) => stat.path === statPath)
  let beforeValue = Number(beforeRaw)
  if (!allowed || !entityId || extra.length || !Number.isInteger(beforeValue) || beforeValue < 0) {
    throw new PlatformError('Correction target is invalid', 'invalid_input')
  }
  return { beforeValue, entityId, entityType, statPath }
}

export function correctionTargetValue(
  entityType: 'team' | 'character',
  entityId: string,
  statPath: string,
  beforeValue: number,
): string {
  return [entityType, entityId, statPath, beforeValue].join('|')
}
