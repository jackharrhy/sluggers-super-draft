import { TeamLineupRevisionSchema, validateTeamLineupRevision, type TeamLineupRevision } from '@starworks/contracts'
import { z } from 'zod'

import { PlatformError } from '../platform/errors.ts'

const LegacyPlayerSchema = z.tuple([
  z.number().int().nonnegative(),
  z.number().int().min(0).max(8),
  z.number().int().min(0).max(8),
])

export const AutoTeamSnapshotSchema = z.strictObject({
  team_names: z.array(z.string().trim().min(1).max(100)),
  teams: z.array(z.array(LegacyPlayerSchema).length(9)),
})

export interface AutoTeamImportDraft {
  lineup: TeamLineupRevision['lineup']
  name: string
  rosterCharacterIds: string[]
  sourceTeamIndex: number
  warnings: string[]
}

const positions = ['P', 'C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF'] as const

export function importAutoTeamSnapshot(input: unknown, teamName: string): AutoTeamImportDraft {
  let snapshot = AutoTeamSnapshotSchema.parse(input)
  if (snapshot.teams.length !== snapshot.team_names.length) {
    throw new PlatformError('AutoTeam teams and team_names must have the same length', 'invalid_input')
  }
  if (new Set(snapshot.team_names).size !== snapshot.team_names.length) {
    throw new PlatformError('AutoTeam team names must be unique', 'invalid_input')
  }
  let sourceTeamIndex = snapshot.team_names.indexOf(teamName)
  if (sourceTeamIndex === -1) throw new PlatformError(`AutoTeam team ${teamName} was not found`, 'not_found')
  let source = snapshot.teams[sourceTeamIndex]!
  if (source.some(([characterIndex]) => characterIndex >= 77)) {
    throw new PlatformError('AutoTeam Mii slots depend on a local RFL_DB.dat and must be resolved before import', 'invalid_input')
  }
  let battingSlots = source.map(([, battingSlot]) => battingSlot)
  let fieldingSlots = source.map(([, , fieldingSlot]) => fieldingSlot)
  if (new Set(battingSlots).size !== 9 || new Set(fieldingSlots).size !== 9) {
    throw new PlatformError('AutoTeam batting and fielding slots must each contain 0 through 8 exactly once', 'invalid_input')
  }

  let players = source.map(([characterIndex, battingSlot, fieldingSlot]) => ({
    battingSlot,
    characterId: `rmbe01-character-${String(characterIndex).padStart(3, '0')}`,
    fieldingSlot,
  }))
  if (new Set(players.map((player) => player.characterId)).size !== 9) {
    throw new PlatformError('AutoTeam lineups cannot contain duplicate non-Mii characters', 'invalid_input')
  }
  let battingOrder = [...players].sort((left, right) => left.battingSlot - right.battingSlot).map((player) => player.characterId)
  let fielding = [...players].sort((left, right) => left.fieldingSlot - right.fieldingSlot).map((player, index) => ({
    characterId: player.characterId,
    position: positions[index]!,
  }))
  let draft: AutoTeamImportDraft = {
    lineup: {
      battingOrder,
      bench: [],
      captainCharacterId: players[0]!.characterId,
      fielding,
      pitcherCharacterId: fielding[0]!.characterId,
    },
    name: snapshot.team_names[sourceTeamIndex]!,
    rosterCharacterIds: players.map((player) => player.characterId),
    sourceTeamIndex,
    warnings: [
      'AutoTeam keyboard macros, raw Dolphin addresses, and Gecko assembly were intentionally not imported.',
      'Character IDs preserve stable RMBe01 numeric slots and can be remapped independently of this source format.',
    ],
  }
  let semanticFixture = TeamLineupRevisionSchema.parse({
    basedOnLineupRevisionId: null,
    createdAt: '2026-08-10T00:00:00Z',
    kind: 'team-lineup-revision',
    leagueId: '11111111-1111-4111-8111-111111111111',
    lineupRevisionId: '22222222-2222-4222-8222-222222222222',
    lineupRevisionNumber: 1,
    lineup: draft.lineup,
    publishedAt: null,
    rosterCharacterIds: draft.rosterCharacterIds,
    rosterRevisionId: '33333333-3333-4333-8333-333333333333',
    rosterRevisionNumber: 1,
    schemaVersion: 1,
    status: 'draft',
    teamId: '44444444-4444-4444-8444-444444444444',
  })
  let issues = validateTeamLineupRevision(semanticFixture)
  if (issues.length) throw new PlatformError(`AutoTeam lineup is invalid: ${issues.join(', ')}`, 'invalid_input')
  return draft
}
