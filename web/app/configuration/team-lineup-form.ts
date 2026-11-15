import {
  EffectiveLineupSchema,
  FieldingPositionSchema,
  type TeamLineupRevision,
} from '@starworks/contracts'

import { PlatformError } from '../platform/errors.ts'
import { validateSluggersLineup } from '../sluggers/lineups.ts'

type EffectiveLineup = TeamLineupRevision['lineup']
type FieldingPosition = typeof FieldingPositionSchema.options[number]

interface RosterSelection {
  battingSlot: number | null
  characterId: string
  fieldingPosition: FieldingPosition | null
}

export function parseTeamLineupForm(
  data: FormData,
  rosterCharacterIds: string[],
): EffectiveLineup {
  let captainCharacterId = readRosterCharacter(data, 'captain', rosterCharacterIds)
  let selections = rosterCharacterIds.map((characterId, index): RosterSelection => ({
    battingSlot: readBattingSlot(data, index),
    characterId,
    fieldingPosition: readFieldingPosition(data, index),
  }))
  let active = selections.filter((selection) => selection.battingSlot !== null)
  let battingSlots = active.map((selection) => selection.battingSlot!)
  if (active.length !== 9 || new Set(battingSlots).size !== 9 || battingSlots.some((slot) => slot < 1 || slot > 9)) {
    throw new PlatformError('Assign every batting slot from 1 through 9 exactly once', 'invalid_input')
  }
  let fielding = selections.filter((selection) => selection.fieldingPosition !== null)
  let fieldingPositions = fielding.map((selection) => selection.fieldingPosition!)
  if (
    fielding.length !== FieldingPositionSchema.options.length
    || new Set(fieldingPositions).size !== FieldingPositionSchema.options.length
    || FieldingPositionSchema.options.some((position) => !fieldingPositions.includes(position))
  ) {
    throw new PlatformError('Assign every fielding position exactly once', 'invalid_input')
  }
  let activeIds = new Set(active.map((selection) => selection.characterId))
  if (fielding.some((selection) => !activeIds.has(selection.characterId))) {
    throw new PlatformError('Bench players cannot take a fielding position', 'invalid_input')
  }
  if (!activeIds.has(captainCharacterId)) {
    throw new PlatformError('The captain must be in the batting order', 'invalid_input')
  }
  let pitcherCharacterId = fielding.find((selection) => selection.fieldingPosition === 'P')!.characterId
  let lineup = EffectiveLineupSchema.parse({
    battingOrder: active
      .toSorted((left, right) => left.battingSlot! - right.battingSlot!)
      .map((selection) => selection.characterId),
    bench: selections.filter((selection) => selection.battingSlot === null).map((selection) => selection.characterId),
    captainCharacterId,
    fielding: fielding.map((selection) => ({
      characterId: selection.characterId,
      position: selection.fieldingPosition!,
    })),
    pitcherCharacterId,
  })
  let sluggersIssues = validateSluggersLineup(lineup)
  if (sluggersIssues.includes('unsupported-active-character')) {
    throw new PlatformError('Only the 71 ordinary Sluggers characters can be active in this runner', 'invalid_input')
  }
  if (sluggersIssues.includes('unsupported-captain')) {
    throw new PlatformError('Choose one of the twelve Sluggers team captains', 'invalid_input')
  }
  return lineup
}

export function battingInputName(index: number): string {
  return `batting.${index}`
}

export function fieldingInputName(index: number): string {
  return `fielding.${index}`
}

function readBattingSlot(data: FormData, index: number): number | null {
  let raw = readString(data, battingInputName(index))
  if (raw === 'bench') return null
  let slot = Number(raw)
  if (!Number.isInteger(slot)) throw new PlatformError('Batting slots must be whole numbers', 'invalid_input')
  return slot
}

function readFieldingPosition(data: FormData, index: number): FieldingPosition | null {
  let raw = readString(data, fieldingInputName(index))
  if (raw === 'bench') return null
  let parsed = FieldingPositionSchema.safeParse(raw)
  if (!parsed.success) throw new PlatformError('Choose a valid fielding position', 'invalid_input')
  return parsed.data
}

function readRosterCharacter(data: FormData, name: string, roster: string[]): string {
  let value = readString(data, name)
  if (!roster.includes(value)) throw new PlatformError('Choose a captain from this roster', 'invalid_input')
  return value
}

function readString(data: FormData, name: string): string {
  let value = data.get(name)
  if (typeof value !== 'string' || !value) {
    throw new PlatformError('Complete every lineup field before saving', 'invalid_input')
  }
  return value
}
