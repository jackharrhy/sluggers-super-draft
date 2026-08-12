import { createHash } from 'node:crypto'

import {
  SluggersTuningSchema,
  StatProfileRevisionSchema,
  type SluggersTuning,
  type StatDefinition,
} from '@starworks/contracts'
import { z } from 'zod'

import { STAT_EDITOR_V4_CORE_STAT_BOUNDS } from '../configuration/stat-editor-character-fields.ts'
import { PlatformError } from '../platform/errors.ts'
import { SLUGGERS_CHARACTER_IDS } from '../sluggers/characters.ts'

export const StatEditorV4ImportRequestSchema = z.strictObject({
  characterIdsByIndex: z.array(z.string().min(1).max(127)).length(101).optional(),
  profileName: z.string().trim().min(1).max(100),
  rawText: z.string().min(1),
  sourceVersion: z.literal('v4'),
})

export interface StatEditorImportDraft {
  characterValues: Array<{ characterId: string; values: Record<string, boolean | number | string | null> }>
  definitions: StatDefinition[]
  name: string
  sluggersTuning: SluggersTuning
  sourceVersion: 'v4'
  warnings: string[]
}

const sectionLayout = [
  ['chemistry', 101, 101],
  ['character stats', 101, 30],
  ['trajectory tables', 24, 25],
] as const

const coreStatLabels = [
  'Pitching handedness',
  'Batting handedness',
  'Character class',
  'Unknown stat 3',
  'Weight',
  'Captain flag',
  'Star pitch',
  'Star swing',
  'Fielding ability',
  'Baserunning ability',
  'Slap contact size',
  'Charge contact size',
  'Slap power',
  'Charge power',
  'Bunting',
  'Speed',
  'Outfield throwing',
  'Fielding',
  'Displayed pitching',
  'Displayed batting',
  'Displayed fielding',
  'Displayed speed',
  'Curveball speed',
  'Charge pitch speed',
  'Curve',
  'Stamina legacy complement',
  'Trajectory',
  'Hit curve',
  'Stamina',
  'Star pitch type',
] as const

const sizeLabels = [
  'Gameplay scale',
  'Selection screen scale',
  'Catch range regular',
  'Catch range facing away',
  'Catch range unknown 4',
  'Catch range height',
  'Catch range unknown 6',
  'Catch range unknown 7',
  'Catch range dive',
  'Catch range unknown 9',
  'Catch range jump',
  'Catch range unknown 11',
  'Hitbox width',
  'Hitbox height',
] as const

const pitchingLabels = [
  'Pitch charge duration',
  'Captain star pitch duration',
  'Pitch curve duration',
  'Change-up speed multiplier',
  'Change-up height',
] as const

export function importStatEditorV4(input: unknown): StatEditorImportDraft {
  let request = StatEditorV4ImportRequestSchema.parse(input)
  let lines = request.rawText.replaceAll('\r\n', '\n').replaceAll('\r', '\n').trimEnd().split('\n')
  if (lines.length === 228) {
    throw new PlatformError('Stat Editor v3 snapshots are not accepted as v4; export the file from v4 first', 'invalid_input')
  }
  if (lines.length !== 507) {
    throw new PlatformError(`Stat Editor v4 snapshots must contain 507 lines; received ${lines.length}`, 'invalid_input')
  }

  let normalizedSource = lines.join('\n')
  let cursor = 0
  let parsed = new Map<string, number[][]>()
  for (let [name, rows, columns] of sectionLayout) {
    parsed.set(name, readNumericRows(lines, cursor, rows, columns, name))
    cursor += rows
  }
  let trajectoryNames = readTextRow(lines[cursor++]!, 6, 'trajectory names')
  let trajectoryActivation = readNumericRow(lines[cursor++]!, 6, 'trajectory activation')
  let sizes = readNumericRows(lines, cursor, 101, 14, 'character sizes')
  cursor += 101
  let pitching = readNumericRows(lines, cursor, 101, 5, 'pitching values')
  cursor += 101
  let globalSpeedCurves = readNumericRows(lines, cursor, 43, 2, 'global speed curves')
  cursor += 43
  let teamStarEvents = readNumericRows(lines, cursor, 12, 41, 'team star events')
  cursor += 12
  let starBoosts = readNumericRows(lines, cursor, 16, 4, 'star boosts')
  cursor += 16
  let starHandicaps = readNumericRows(lines, cursor, 4, 2, 'star handicaps')
  cursor += 4
  let handicapParameters = readNumericRows(lines, cursor, 2, 3, 'handicap parameters')

  let characterIds = request.characterIdsByIndex ?? [...SLUGGERS_CHARACTER_IDS]
  let sluggersTuning = SluggersTuningSchema.parse({
    characterIdsByIndex: characterIds,
    chemistry: parsed.get('chemistry'),
    globalSpeedCurves,
    handicapParameters,
    importSource: {
      format: 'stat-editor-v4',
      sha256: createHash('sha256').update(normalizedSource).digest('hex'),
    },
    starBoosts,
    starHandicaps,
    teamStarEvents,
    trajectoryActivation,
    trajectoryNames,
    trajectoryTables: parsed.get('trajectory tables'),
  })

  let stats = parsed.get('character stats')!
  let definitions = [
    ...buildDefinitions('stat', coreStatLabels, stats, 0, STAT_EDITOR_V4_CORE_STAT_BOUNDS),
    ...buildDefinitions('size', sizeLabels, sizes, coreStatLabels.length),
    ...buildDefinitions('pitching', pitchingLabels, pitching, coreStatLabels.length + sizeLabels.length),
  ]
  let characterValues = characterIds.map((characterId, characterIndex) => {
    let values: Record<string, number> = {}
    definitions.forEach((definition, definitionIndex) => {
      if (definitionIndex < coreStatLabels.length) {
        values[definition.key] = stats[characterIndex]![definitionIndex]!
      } else if (definitionIndex < coreStatLabels.length + sizeLabels.length) {
        values[definition.key] = sizes[characterIndex]![definitionIndex - coreStatLabels.length]!
      } else {
        values[definition.key] = pitching[characterIndex]![definitionIndex - coreStatLabels.length - sizeLabels.length]!
      }
    })
    return { characterId, values }
  })

  StatProfileRevisionSchema.shape.definitions.parse(definitions)
  StatProfileRevisionSchema.shape.characterValues.parse(characterValues)
  return {
    characterValues,
    definitions,
    name: request.profileName,
    sluggersTuning,
    sourceVersion: 'v4',
    warnings: [
      'Character slots were translated from the Stat Editor roster order to stable Starworks character IDs.',
    ],
  }
}

function buildDefinitions(
  group: string,
  labels: readonly string[],
  rows: number[][],
  orderOffset: number,
  bounds?: ReadonlyArray<readonly [number, number]>,
): StatDefinition[] {
  return labels.map((label, column) => {
    let values = rows.map((row) => row[column]!)
    let integer = values.every(Number.isSafeInteger)
    let observedMinimum = Math.min(...values)
    let observedMaximum = Math.max(...values)
    let minimum = Math.min(bounds?.[column]?.[0] ?? observedMinimum, observedMinimum)
    let maximum = Math.max(bounds?.[column]?.[1] ?? observedMaximum, observedMaximum)
    let key = `legacy.stat-editor.${group}-${String(column).padStart(2, '0')}`
    let base = {
      definitionId: deterministicUuid(key),
      display: { group: groupLabel(group), label, order: orderOffset + column },
      gameplayMapping: {
        adapterId: 'sluggers-rmbe01' as const,
        loadPhase: 'build-time' as const,
        target: {
          codec: integer ? 'u32-be' as const : 'f32-be' as const,
          field: key,
          resource: 'main-dol' as const,
        },
      },
      key,
      required: true,
    }
    if (integer) {
      return {
        ...base,
        dataType: 'integer' as const,
        maximum,
        minimum,
        step: 1,
      }
    }
    return {
      ...base,
      dataType: 'number' as const,
      maximum,
      minimum,
      step: 0.0001,
    }
  })
}

export function exportStatEditorV4(
  profile: Pick<StatEditorImportDraft, 'characterValues' | 'sluggersTuning'>,
): string {
  let valuesByCharacter = new Map(
    profile.characterValues.map((character) => [character.characterId, character.values]),
  )
  let orderedCharacters = profile.sluggersTuning.characterIdsByIndex
  if (orderedCharacters.some((characterId) => !valuesByCharacter.has(characterId))) {
    throw new PlatformError('Stat Editor v4 export requires all 101 numeric character slots', 'invalid_input')
  }
  let lines: string[] = []
  appendMatrix(lines, profile.sluggersTuning.chemistry)
  appendCharacterGroup(lines, orderedCharacters, valuesByCharacter, 'stat', coreStatLabels.length)
  appendMatrix(lines, profile.sluggersTuning.trajectoryTables)
  lines.push(profile.sluggersTuning.trajectoryNames.join(','))
  lines.push(profile.sluggersTuning.trajectoryActivation.map(formatNumber).join(','))
  appendCharacterGroup(lines, orderedCharacters, valuesByCharacter, 'size', sizeLabels.length)
  appendCharacterGroup(lines, orderedCharacters, valuesByCharacter, 'pitching', pitchingLabels.length)
  appendMatrix(lines, profile.sluggersTuning.globalSpeedCurves)
  appendMatrix(lines, profile.sluggersTuning.teamStarEvents)
  appendMatrix(lines, profile.sluggersTuning.starBoosts)
  appendMatrix(lines, profile.sluggersTuning.starHandicaps)
  appendMatrix(lines, profile.sluggersTuning.handicapParameters)
  if (lines.length !== 507) {
    throw new PlatformError('Stat Editor v4 export did not produce its required 507 rows', 'invalid_input')
  }
  return lines.join('\n')
}

function appendCharacterGroup(
  lines: string[],
  characterIds: string[],
  valuesByCharacter: Map<string, Record<string, boolean | number | string | null>>,
  group: string,
  columns: number,
): void {
  for (let characterId of characterIds) {
    let values = valuesByCharacter.get(characterId)!
    let row = Array.from({ length: columns }, (_, column) => {
      let key = `legacy.stat-editor.${group}-${String(column).padStart(2, '0')}`
      let value = values[key]
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new PlatformError(`Stat Editor v4 export is missing ${key} for ${characterId}`, 'invalid_input')
      }
      return value
    })
    lines.push(row.map(formatNumber).join(','))
  }
}

function appendMatrix(lines: string[], matrix: number[][]): void {
  for (let row of matrix) lines.push(row.map(formatNumber).join(','))
}

function formatNumber(value: number): string {
  if (!Number.isFinite(value)) throw new PlatformError('Stat Editor v4 export contains an invalid number', 'invalid_input')
  return String(value)
}

function readNumericRows(
  lines: string[],
  start: number,
  rows: number,
  columns: number,
  section: string,
): number[][] {
  return Array.from({ length: rows }, (_, row) => readNumericRow(lines[start + row]!, columns, `${section} row ${row + 1}`))
}

function readNumericRow(line: string, columns: number, label: string): number[] {
  let values = line.split(',')
  if (values.length !== columns) {
    throw new PlatformError(`${label} must contain ${columns} values`, 'invalid_input')
  }
  return values.map((value) => {
    if (!/^-?\d+(?:\.\d+)?$/.test(value)) {
      throw new PlatformError(`${label} contains a non-numeric value`, 'invalid_input')
    }
    let number = Number(value)
    if (!Number.isFinite(number)) throw new PlatformError(`${label} contains an invalid number`, 'invalid_input')
    return number
  })
}

function readTextRow(line: string, columns: number, label: string): string[] {
  let values = line.split(',')
  if (values.length !== columns || values.some((value) => !value.trim())) {
    throw new PlatformError(`${label} must contain ${columns} names`, 'invalid_input')
  }
  return values
}

function deterministicUuid(value: string): string {
  let bytes = createHash('sha256').update(`starworks:${value}`).digest().subarray(0, 16)
  bytes[6] = (bytes[6]! & 0x0f) | 0x50
  bytes[8] = (bytes[8]! & 0x3f) | 0x80
  let hex = bytes.toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

function groupLabel(group: string): string {
  if (group === 'stat') return 'Core stats'
  if (group === 'size') return 'Character size'
  return 'Pitching'
}
