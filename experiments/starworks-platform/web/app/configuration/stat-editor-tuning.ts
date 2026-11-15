import { SluggersTuningSchema, type SluggersTuning } from '@starworks/contracts'

import { PlatformError } from '../platform/errors.ts'

export const STAT_EDITOR_TUNING_SECTIONS = [
  'chemistry',
  'trajectories',
  'speed-curves',
  'star-events',
  'star-boosts',
  'handicaps',
] as const

export type StatEditorTuningSection = typeof STAT_EDITOR_TUNING_SECTIONS[number]

export const STAT_EDITOR_TUNING_LABELS: Record<StatEditorTuningSection, string> = {
  chemistry: 'Chemistry',
  trajectories: 'Hit trajectories',
  'speed-curves': 'Real speed curves',
  'star-events': 'Team star gains',
  'star-boosts': 'Star boosts',
  handicaps: 'Star handicaps',
}

// User-facing domain labels follow the trusted Sluggers Stat Editor v4 reference
// (`editorV3.py` lists); Starworks owns the web forms and mutation model below.
export const TRAJECTORY_SWING_LABELS = ['Human slap', 'AI slap', 'Human charge', 'AI charge'] as const
export const TRAJECTORY_CONTACT_LABELS = ['Far inside', 'Inside', 'Sweet spot', 'Outside', 'Far outside'] as const
export const TRAJECTORY_HEIGHT_LABELS = ['Lowest', 'Low', 'Middle', 'High', 'Highest'] as const
export const SPEED_CURVE_LABELS = ['Baserunning', 'Fielding'] as const
export const TEAM_LABELS = [
  'Fireballs', 'Knights', 'Wilds', 'Monkeys', 'Monarchs', 'Flowers',
  'Eggs', 'Monsters', 'Muscles', 'Spitballs', 'Bows', 'Rookies',
] as const
export const STAR_EVENT_LABELS = [
  'Single', 'Double', 'Triple', 'Ground-rule double', 'Unknown event 5',
  'Solo home run', 'Two-run home run', 'Three-run home run', 'Grand slam',
  'Unknown event 10', 'Unknown event 11', 'Unknown event 12', 'Unknown event 13',
  'Unknown event 14', 'Unknown event 15', 'Struck out', 'Any other out',
  'Unknown event 18', 'Unknown event 19', 'Foul', 'Whiffed star hit',
  'Failed stolen base', 'Unknown event 23', 'Unknown event 24', 'Unknown event 25',
  'Unknown event 26', 'Unknown event 27', 'Walk', 'Hit batter', 'Runner allowed to first',
  'Home run allowed', 'Per run allowed', 'Strike', 'Any out', 'Unknown event 35',
  'Unknown event 36', 'Unknown event 37', 'Unknown event 38', 'Unknown event 39',
  'Unknown event 40', 'Unknown event 41',
] as const
export const STAR_BOOST_LABELS = [
  'Displayed pitching', 'Curveball speed', 'Fastball speed', 'Curve', 'Unknown pitching stat',
  'Displayed batting', 'Slap power', 'Charge power', 'Slap contact', 'Charge contact',
  'Bunting', 'Displayed fielding', 'Displayed speed', 'Fielding', 'Throwing arm', 'Speed',
] as const

export function parseStatEditorTuningSection(value: string): StatEditorTuningSection {
  if (!isStatEditorTuningSection(value)) {
    throw new PlatformError('That Stat Editor section does not exist', 'not_found')
  }
  return value
}

function isStatEditorTuningSection(value: string): value is StatEditorTuningSection {
  return STAT_EDITOR_TUNING_SECTIONS.some((section) => section === value)
}

export function selectedTuningRow(
  section: StatEditorTuningSection,
  rawRow: string | null,
): number {
  let maximum = section === 'chemistry' ? 100
    : section === 'trajectories' ? 5
      : section === 'star-events' ? 11
        : 0
  if (rawRow === null) return 0
  let row = Number(rawRow)
  if (!Number.isInteger(row) || row < 0 || row > maximum) {
    throw new PlatformError(`Select a valid ${STAT_EDITOR_TUNING_LABELS[section].toLowerCase()} row`, 'invalid_input')
  }
  return row
}

export function updateStatEditorTuning(
  tuning: SluggersTuning,
  section: StatEditorTuningSection,
  data: FormData,
): SluggersTuning {
  let next: SluggersTuning
  switch (section) {
    case 'chemistry': {
      let row = readRowIndex(data, 100)
      let chemistry = cloneMatrix(tuning.chemistry)
      chemistry[row] = readNumericRow(data, 'value', 101, { integer: true, maximum: 2, minimum: 0 })
      next = { ...tuning, chemistry }
      break
    }
    case 'trajectories': {
      let row = readRowIndex(data, 5)
      let trajectoryTables = cloneMatrix(tuning.trajectoryTables)
      for (let swing = 0; swing < 4; swing++) {
        trajectoryTables[row * 4 + swing] = readNumericRow(data, `value.${swing}`, 25, { integer: true, maximum: 100, minimum: 0 })
      }
      let trajectoryNames = [...tuning.trajectoryNames]
      trajectoryNames[row] = readText(data, 'name', 'Trajectory name')
      let trajectoryActivation = [...tuning.trajectoryActivation]
      trajectoryActivation[row] = readNumber(data, 'activation', 'Use trajectory group', { integer: true, maximum: 1, minimum: 0 })
      next = { ...tuning, trajectoryActivation, trajectoryNames, trajectoryTables }
      break
    }
    case 'speed-curves':
      next = { ...tuning, globalSpeedCurves: readNumericMatrix(data, 43, 2) }
      break
    case 'star-events': {
      let row = readRowIndex(data, 11)
      let teamStarEvents = cloneMatrix(tuning.teamStarEvents)
      teamStarEvents[row] = readNumericRow(data, 'value', 41, { integer: true, maximum: 32_767, minimum: -32_768 })
      next = { ...tuning, teamStarEvents }
      break
    }
    case 'star-boosts': {
      let starBoosts = readNumericMatrix(data, 16, 4)
      for (let [row, values] of starBoosts.entries()) {
        if (values[0] !== 1 && values[0] !== 2) {
          throw new PlatformError(`${STAR_BOOST_LABELS[row]} must add or multiply`, 'invalid_input')
        }
        for (let column of [2, 3]) {
          if (!Number.isInteger(values[column]) || values[column]! < 0 || values[column]! > 65_535) {
            throw new PlatformError(`${STAR_BOOST_LABELS[row]} clamp values must be whole numbers from 0 to 65535`, 'invalid_input')
          }
        }
        if (values[2]! > values[3]!) {
          throw new PlatformError(`${STAR_BOOST_LABELS[row]} minimum cannot exceed its maximum`, 'invalid_input')
        }
      }
      next = { ...tuning, starBoosts }
      break
    }
    case 'handicaps':
      next = {
        ...tuning,
        handicapParameters: readNumericMatrix(data, 2, 3, { integer: true, maximum: 255, minimum: 0 }, 'parameter'),
        starHandicaps: readNumericMatrix(data, 4, 2),
      }
      break
  }
  return SluggersTuningSchema.parse(next)
}

function readRowIndex(data: FormData, maximum: number): number {
  let row = readNumber(data, 'row', 'Selected row', { integer: true, maximum, minimum: 0 })
  return row
}

function readNumericMatrix(
  data: FormData,
  rows: number,
  columns: number,
  constraints: NumberConstraints = {},
  prefix = 'value',
): number[][] {
  return Array.from({ length: rows }, (_, row) =>
    Array.from({ length: columns }, (_, column) =>
      readNumber(data, `${prefix}.${row}.${column}`, `Row ${row + 1}, value ${column + 1}`, constraints)))
}

function readNumericRow(
  data: FormData,
  prefix: string,
  columns: number,
  constraints: NumberConstraints = {},
): number[] {
  return Array.from({ length: columns }, (_, column) =>
    readNumber(data, `${prefix}.${column}`, `Value ${column + 1}`, constraints))
}

interface NumberConstraints {
  integer?: boolean
  maximum?: number
  minimum?: number
}

function readNumber(
  data: FormData,
  name: string,
  label: string,
  constraints: NumberConstraints = {},
): number {
  let raw = data.get(name)
  if (typeof raw !== 'string' || !raw.trim()) {
    throw new PlatformError(`${label} is required`, 'invalid_input')
  }
  let value = Number(raw)
  if (
    !Number.isFinite(value)
    || (constraints.integer && !Number.isInteger(value))
    || (constraints.minimum !== undefined && value < constraints.minimum)
    || (constraints.maximum !== undefined && value > constraints.maximum)
  ) {
    throw new PlatformError(`${label} is invalid`, 'invalid_input')
  }
  return value
}

function readText(data: FormData, name: string, label: string): string {
  let raw = data.get(name)
  if (typeof raw !== 'string' || !raw.trim()) {
    throw new PlatformError(`${label} is required`, 'invalid_input')
  }
  return raw.trim()
}

function cloneMatrix(matrix: number[][]): number[][] {
  return matrix.map((row) => [...row])
}
