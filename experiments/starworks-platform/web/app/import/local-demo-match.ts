import { z } from 'zod'

const CharacterIdSchema = z.string().trim().min(1).max(127)
const SlugSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/)

const FieldingSchema = z.strictObject({
  P: CharacterIdSchema,
  C: CharacterIdSchema,
  '1B': CharacterIdSchema,
  '2B': CharacterIdSchema,
  '3B': CharacterIdSchema,
  SS: CharacterIdSchema,
  LF: CharacterIdSchema,
  CF: CharacterIdSchema,
  RF: CharacterIdSchema,
})

const TeamSchema = z.strictObject({
  team: SlugSchema,
  captain: CharacterIdSchema,
  battingOrder: z.array(CharacterIdSchema).length(9),
  fielding: FieldingSchema,
})

export const LocalDemoMatchSchema = z.strictObject({
  league: SlugSchema,
  statProfile: SlugSchema,
  ruleset: SlugSchema,
  stadium: SlugSchema,
  innings: z.number().int().min(1).max(99),
  home: TeamSchema,
  away: TeamSchema,
})

export type LocalDemoMatch = z.infer<typeof LocalDemoMatchSchema>
export type LocalDemoTeam = LocalDemoMatch['home']

const positions = ['P', 'C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF'] as const

export function parseLocalDemoMatch(input: unknown): LocalDemoMatch {
  let match = LocalDemoMatchSchema.parse(input)
  if (match.home.team === match.away.team) {
    throw new Error('Demo home and away teams must be different')
  }
  validateTeam(match.home, 'home')
  validateTeam(match.away, 'away')
  return match
}

export function demoTeamLineup(team: LocalDemoTeam) {
  return {
    rosterCharacterIds: team.battingOrder,
    lineup: {
      battingOrder: team.battingOrder,
      bench: [],
      captainCharacterId: team.captain,
      fielding: positions.map((position) => ({
        characterId: team.fielding[position],
        position,
      })),
      pitcherCharacterId: team.fielding.P,
    },
  }
}

function validateTeam(team: LocalDemoTeam, side: 'home' | 'away'): void {
  let players = new Set(team.battingOrder)
  if (players.size !== 9) {
    throw new Error(`Demo ${side} batting order must contain nine unique players`)
  }
  if (!players.has(team.captain)) {
    throw new Error(`Demo ${side} captain must be in the batting order`)
  }
  let fielders = positions.map((position) => team.fielding[position])
  if (new Set(fielders).size !== 9 || fielders.some((characterId) => !players.has(characterId))) {
    throw new Error(`Demo ${side} fielding must assign every batting player exactly once`)
  }
  let mii = team.battingOrder.find((characterId) => /^mii(?::|-)/i.test(characterId))
  if (mii) {
    throw new Error(
      `Demo ${side} player ${mii} is a Mii. Miis require a runner-local RFL_DB.dat identity and are not supported yet.`,
    )
  }
}
