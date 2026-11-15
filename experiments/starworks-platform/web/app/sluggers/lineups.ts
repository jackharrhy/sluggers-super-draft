import type { TeamLineupRevision } from '@starworks/contracts'

import {
  isSluggersCaptainCharacter,
  isSluggersPlayableCharacter,
} from './characters.ts'

export const sluggersLineupIssueCodes = [
  'unsupported-active-character',
  'unsupported-captain',
] as const

export type SluggersLineupIssue = typeof sluggersLineupIssueCodes[number]

export function validateSluggersLineup(
  lineup: TeamLineupRevision['lineup'],
): SluggersLineupIssue[] {
  let issues: SluggersLineupIssue[] = []
  if (lineup.battingOrder.some((characterId) => !isSluggersPlayableCharacter(characterId))) {
    issues.push('unsupported-active-character')
  }
  if (!isSluggersCaptainCharacter(lineup.captainCharacterId)) {
    issues.push('unsupported-captain')
  }
  return issues
}
