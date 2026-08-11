import { and, desc, eq } from 'drizzle-orm'

import type { StarworksDatabase } from '../platform/database/connection.ts'
import {
  leagueTeams,
  matches,
  matchAttempts,
  telemetryDerivations,
} from '../platform/database/schema.ts'
import type { MatchBoxScore } from './model.ts'

export interface SeasonStatistics {
  standings: Array<{
    teamId: string
    teamName: string
    wins: number
    losses: number
    runsFor: number
    runsAgainst: number
  }>
  playerTotals: Record<string, MatchBoxScore['characters'][string]>
}

export interface LeagueOverviewSeason {
  name: string
  seasonId: string
  standings: SeasonStatistics['standings'] | null
  playerTotals: SeasonStatistics['playerTotals'] | null
}

export async function rebuildSeasonStatistics(
  database: StarworksDatabase,
  leagueId: string,
  seasonId: string,
): Promise<SeasonStatistics> {
  let [teamRows, derivationRows] = await Promise.all([
    database
      .select({ id: leagueTeams.id, name: leagueTeams.name })
      .from(leagueTeams)
      .where(and(eq(leagueTeams.leagueId, leagueId), eq(leagueTeams.seasonId, seasonId))),
    database
      .select({
        attemptId: matchAttempts.id,
        boxScore: telemetryDerivations.boxScore,
        derivationStatus: telemetryDerivations.status,
      })
      .from(matchAttempts)
      .innerJoin(matches, and(
        eq(matches.leagueId, matchAttempts.leagueId),
        eq(matches.id, matchAttempts.matchId),
      ))
      .innerJoin(telemetryDerivations, and(
        eq(telemetryDerivations.leagueId, matchAttempts.leagueId),
        eq(telemetryDerivations.matchAttemptId, matchAttempts.id),
      ))
      .where(and(
        eq(matchAttempts.leagueId, leagueId),
        eq(matchAttempts.status, 'confirmed'),
        eq(matches.seasonId, seasonId),
      ))
      .orderBy(desc(telemetryDerivations.createdAt), desc(telemetryDerivations.id)),
  ])
  let standings = new Map(teamRows.map((team) => [team.id, {
    losses: 0,
    runsAgainst: 0,
    runsFor: 0,
    teamId: team.id,
    teamName: team.name,
    wins: 0,
  }]))
  let playerTotals: SeasonStatistics['playerTotals'] = {}
  let seenAttempts = new Set<string>()
  for (let derivation of derivationRows) {
    if (seenAttempts.has(derivation.attemptId)) continue
    seenAttempts.add(derivation.attemptId)
    if (derivation.derivationStatus !== 'ready') continue
    applyBoxScore(derivation.boxScore as unknown as MatchBoxScore, standings, playerTotals)
  }
  return {
    playerTotals,
    standings: [...standings.values()].sort((left, right) =>
      right.wins - left.wins || left.losses - right.losses || left.teamName.localeCompare(right.teamName)),
  }
}

function applyBoxScore(
  boxScore: MatchBoxScore,
  standings: Map<string, SeasonStatistics['standings'][number]>,
  playerTotals: SeasonStatistics['playerTotals'],
): void {
  let home = standings.get(boxScore.teams.home.teamId)
  let away = standings.get(boxScore.teams.away.teamId)
  if (!home || !away) return
  home.runsFor += boxScore.teams.home.runs
  home.runsAgainst += boxScore.teams.away.runs
  away.runsFor += boxScore.teams.away.runs
  away.runsAgainst += boxScore.teams.home.runs
  if (boxScore.teams.home.runs > boxScore.teams.away.runs) { home.wins += 1; away.losses += 1 }
  if (boxScore.teams.away.runs > boxScore.teams.home.runs) { away.wins += 1; home.losses += 1 }
  for (let [characterId, stats] of Object.entries(boxScore.characters)) {
    playerTotals[characterId] = addCharacterTotals(playerTotals[characterId], stats)
  }
}

function addCharacterTotals(
  current: MatchBoxScore['characters'][string] | undefined,
  incoming: MatchBoxScore['characters'][string],
): MatchBoxScore['characters'][string] {
  if (!current) return structuredClone(incoming)
  for (let category of ['batting', 'running', 'pitching', 'fielding'] as const) {
    for (let [stat, value] of Object.entries(incoming[category])) {
      ;(current[category] as unknown as Record<string, number>)[stat] =
        ((current[category] as unknown as Record<string, number>)[stat] ?? 0) + value
    }
  }
  current.positions = [...new Set([...current.positions, ...incoming.positions])]
  return current
}
