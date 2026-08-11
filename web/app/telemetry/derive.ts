import { createHash } from 'node:crypto'

import {
  parseTelemetryEventPayload,
  type TelemetryEnvelope,
} from '@starworks/contracts'

import type {
  CharacterBoxScore,
  MatchBoxScore,
  TelemetryCorrectionRecord,
  TelemetryDerivationResult,
  TelemetryHealth,
} from './model.ts'

interface DeriveContext {
  homeTeamId: string
  awayTeamId: string
  homeCharacterIds: string[]
  awayCharacterIds: string[]
}

const CHARACTER_STAT_PATHS = new Set([
  'batting.plateAppearances',
  'batting.atBats',
  'batting.hits',
  'batting.singles',
  'batting.doubles',
  'batting.triples',
  'batting.homeRuns',
  'batting.walks',
  'batting.strikeouts',
  'batting.hitByPitch',
  'batting.sacrifices',
  'batting.runsBattedIn',
  'batting.totalBases',
  'running.runs',
  'pitching.battersFaced',
  'pitching.outsPitched',
  'pitching.hitsAllowed',
  'pitching.runsAllowed',
  'pitching.walks',
  'pitching.strikeouts',
  'fielding.errors',
])

const TEAM_STAT_PATHS = new Set(['runs', 'hits', 'errors'])

export function deriveTelemetry(
  events: TelemetryEnvelope[],
  corrections: TelemetryCorrectionRecord[],
  context: DeriveContext,
): TelemetryDerivationResult {
  if (!events.length) throw new Error('Telemetry cannot be derived without events')
  let ordered = [...events].sort((left, right) => left.sequence - right.sequence)
  let issues = structuralIssues(ordered)
  let homeCharacters = new Set(context.homeCharacterIds)
  let awayCharacters = new Set(context.awayCharacterIds)
  let boxScore: MatchBoxScore = {
    characters: {},
    derivationVersion: 1,
    endedReason: null,
    innings: 0,
    teams: {
      away: { errors: 0, hits: 0, lineScore: {}, runs: 0, teamId: context.awayTeamId },
      home: { errors: 0, hits: 0, lineScore: {}, runs: 0, teamId: context.homeTeamId },
    },
  }
  let currentInning: { inning: number; half: 'top' | 'bottom' } | null = null
  let reportedRuns: { home: number; away: number } | null = null

  for (let event of ordered) {
    let payload = parseTelemetryEventPayload(event.eventType, event.payload)
    if (event.eventType === 'game-started') {
      let started = payload as { homeTeamId: string; awayTeamId: string }
      if (started.homeTeamId !== context.homeTeamId || started.awayTeamId !== context.awayTeamId) {
        issues.push('game-started team identity does not match the scheduled match')
      }
    } else if (event.eventType === 'inning-started') {
      currentInning = payload as { inning: number; half: 'top' | 'bottom' }
      boxScore.innings = Math.max(boxScore.innings, currentInning.inning)
    } else if (event.eventType === 'plate-appearance-ended') {
      let appearance = payload as {
        batterCharacterId: string
        battingSide: 'home' | 'away'
        errorByCharacterId: string | null
        outsRecorded: number
        pitcherCharacterId: string
        result: 'single' | 'double' | 'triple' | 'home-run' | 'walk' | 'strikeout' | 'out' | 'error' | 'hit-by-pitch' | 'sacrifice'
        rbi: number
        scorerCharacterIds: string[]
      }
      let battingTeam = appearance.battingSide === 'home' ? boxScore.teams.home : boxScore.teams.away
      let battingRoster = appearance.battingSide === 'home' ? homeCharacters : awayCharacters
      let fieldingRoster = appearance.battingSide === 'home' ? awayCharacters : homeCharacters
      let fieldingTeamId = appearance.battingSide === 'home' ? context.awayTeamId : context.homeTeamId
      if (!battingRoster.has(appearance.batterCharacterId)) {
        issues.push(`unknown batter ${appearance.batterCharacterId} at sequence ${event.sequence}`)
      }
      if (!fieldingRoster.has(appearance.pitcherCharacterId)) {
        issues.push(`unknown pitcher ${appearance.pitcherCharacterId} at sequence ${event.sequence}`)
      }
      let batter = character(boxScore, appearance.batterCharacterId, battingTeam.teamId)
      let pitcher = character(boxScore, appearance.pitcherCharacterId, fieldingTeamId)
      batter.batting.plateAppearances += 1
      pitcher.pitching.battersFaced += 1
      let hitBases = ({ single: 1, double: 2, triple: 3, 'home-run': 4 } as Record<string, number>)[appearance.result] ?? 0
      if (!['walk', 'hit-by-pitch', 'sacrifice'].includes(appearance.result)) batter.batting.atBats += 1
      if (hitBases) {
        batter.batting.hits += 1
        batter.batting.totalBases += hitBases
        pitcher.pitching.hitsAllowed += 1
        battingTeam.hits += 1
        if (appearance.result === 'single') batter.batting.singles += 1
        if (appearance.result === 'double') batter.batting.doubles += 1
        if (appearance.result === 'triple') batter.batting.triples += 1
        if (appearance.result === 'home-run') batter.batting.homeRuns += 1
      }
      if (appearance.result === 'walk') {
        batter.batting.walks += 1
        pitcher.pitching.walks += 1
      }
      if (appearance.result === 'strikeout') {
        batter.batting.strikeouts += 1
        pitcher.pitching.strikeouts += 1
      }
      if (appearance.result === 'hit-by-pitch') batter.batting.hitByPitch += 1
      if (appearance.result === 'sacrifice') batter.batting.sacrifices += 1
      batter.batting.runsBattedIn += appearance.rbi
      pitcher.pitching.outsPitched += appearance.outsRecorded
      pitcher.pitching.runsAllowed += appearance.scorerCharacterIds.length
      battingTeam.runs += appearance.scorerCharacterIds.length
      if (currentInning) {
        let key = `${currentInning.inning}-${currentInning.half}`
        battingTeam.lineScore[key] = (battingTeam.lineScore[key] ?? 0) + appearance.scorerCharacterIds.length
      }
      for (let scorerId of appearance.scorerCharacterIds) {
        if (!battingRoster.has(scorerId)) issues.push(`unknown scorer ${scorerId} at sequence ${event.sequence}`)
        character(boxScore, scorerId, battingTeam.teamId).running.runs += 1
      }
      if (appearance.errorByCharacterId) {
        if (!fieldingRoster.has(appearance.errorByCharacterId)) {
          issues.push(`unknown fielder ${appearance.errorByCharacterId} at sequence ${event.sequence}`)
        }
        character(boxScore, appearance.errorByCharacterId, fieldingTeamId).fielding.errors += 1
        let fieldingTeam = appearance.battingSide === 'home' ? boxScore.teams.away : boxScore.teams.home
        fieldingTeam.errors += 1
      }
    } else if (event.eventType === 'substitution') {
      let substitution = payload as { incomingCharacterId: string; position: string; side: 'home' | 'away' }
      let teamId = substitution.side === 'home' ? context.homeTeamId : context.awayTeamId
      let positions = character(boxScore, substitution.incomingCharacterId, teamId).positions
      if (!positions.includes(substitution.position)) positions.push(substitution.position)
    } else if (event.eventType === 'game-ended') {
      let ended = payload as { homeRuns: number; awayRuns: number; reason: MatchBoxScore['endedReason'] }
      boxScore.endedReason = ended.reason
      reportedRuns = { away: ended.awayRuns, home: ended.homeRuns }
    }
  }

  for (let correction of [...corrections].sort((left, right) =>
    left.createdAt.getTime() - right.createdAt.getTime() || left.id.localeCompare(right.id))) {
    applyCorrection(boxScore, correction, issues)
  }
  if (reportedRuns && (
    reportedRuns.home !== boxScore.teams.home.runs
    || reportedRuns.away !== boxScore.teams.away.runs
  )) {
    issues.push(`derived score ${boxScore.teams.away.runs}-${boxScore.teams.home.runs} does not match game-ended score ${reportedRuns.away}-${reportedRuns.home}`)
  }
  if (boxScore.endedReason === 'forfeit' || boxScore.endedReason === 'quit') {
    issues.push(`game ended by ${boxScore.endedReason} and requires commissioner review`)
  }
  issues = [...new Set(issues)]
  return {
    boxScore,
    correctionCount: corrections.length,
    health: health(ordered, issues),
    inputDigest: digest({ corrections: normalizedCorrections(corrections), events: ordered }),
  }
}

export function correctionValue(
  boxScore: MatchBoxScore,
  entityType: 'team' | 'character',
  entityId: string,
  statPath: string,
): number | null {
  if (entityType === 'team') {
    if (!TEAM_STAT_PATHS.has(statPath)) return null
    let team = [boxScore.teams.home, boxScore.teams.away].find((candidate) => candidate.teamId === entityId)
    return team ? readNumericPath(team, statPath) : null
  }
  if (!CHARACTER_STAT_PATHS.has(statPath)) return null
  let player = boxScore.characters[entityId]
  return player ? readNumericPath(player, statPath) : null
}

function structuralIssues(events: TelemetryEnvelope[]): string[] {
  let issues: string[] = []
  if (events[0]?.sequence !== 1) issues.push(`telemetry begins at sequence ${events[0]?.sequence ?? 0}, expected 1`)
  for (let index = 1; index < events.length; index += 1) {
    if (events[index]!.sequence !== events[index - 1]!.sequence + 1) {
      issues.push(`sequence gap between ${events[index - 1]!.sequence} and ${events[index]!.sequence}`)
    }
    if (events[index]!.frame < events[index - 1]!.frame) {
      issues.push(`game frame moved backwards at sequence ${events[index]!.sequence}`)
    }
  }
  if (!events.some((event) => event.eventType === 'game-started')) issues.push('game-started event is missing')
  if (!events.some((event) => event.eventType === 'game-ended')) issues.push('game-ended event is missing')
  if (!events.some((event) => event.eventType === 'inning-started')) issues.push('inning-started event is missing')
  if (!events.some((event) => event.eventType === 'plate-appearance-ended')) {
    issues.push('plate-appearance-ended event is missing')
  }
  if (events.filter((event) => event.eventType === 'game-started').length > 1) issues.push('multiple game-started events were received')
  if (events.filter((event) => event.eventType === 'game-ended').length > 1) issues.push('multiple game-ended events were received')
  if (events.some((event) => event.observationSource === 'memory-observation')) {
    issues.push('provisional read-only memory observations require review')
  }
  if (events.some((event) => event.observationSource !== 'bridge-hook')) {
    issues.push('automatic confirmation requires bridge-hook telemetry only')
  }
  if (events.some((event) => event.eventType === 'synthetic')) {
    issues.push('synthetic telemetry cannot confirm a match')
  }
  if (events.some((event) => event.eventType === 'bridge-warning'
    && (event.payload.code === 'overflow' || event.payload.code === 'sequence-gap'))) {
    issues.push('bridge reported missing or overflowing telemetry')
  }
  return issues
}

function health(events: TelemetryEnvelope[], issues: string[]): TelemetryHealth {
  let present = new Set(events.map((event) => event.sequence))
  let nextExpectedSequence = 1
  while (present.has(nextExpectedSequence)) nextExpectedSequence += 1
  return {
    eventCount: events.length,
    firstSequence: events[0]!.sequence,
    issues,
    lastSequence: events.at(-1)!.sequence,
    nextExpectedSequence,
    requiresReview: issues.length > 0,
  }
}

function character(boxScore: MatchBoxScore, characterId: string, teamId: string): CharacterBoxScore {
  let existing = boxScore.characters[characterId]
  if (existing) return existing
  let created: CharacterBoxScore = {
    batting: {
      atBats: 0, doubles: 0, hitByPitch: 0, hits: 0, homeRuns: 0,
      plateAppearances: 0, runsBattedIn: 0, sacrifices: 0, singles: 0,
      strikeouts: 0, totalBases: 0, triples: 0, walks: 0,
    },
    fielding: { errors: 0 },
    pitching: {
      battersFaced: 0, hitsAllowed: 0, outsPitched: 0, runsAllowed: 0,
      strikeouts: 0, walks: 0,
    },
    positions: [],
    running: { runs: 0 },
    teamId,
  }
  boxScore.characters[characterId] = created
  return created
}

function applyCorrection(
  boxScore: MatchBoxScore,
  correction: TelemetryCorrectionRecord,
  issues: string[],
): void {
  let current = correctionValue(boxScore, correction.entityType, correction.entityId, correction.statPath)
  if (current === null) {
    issues.push(`correction ${correction.id} targets an unknown stat`)
    return
  }
  if (current !== correction.beforeValue) {
    issues.push(`correction ${correction.id} expected ${correction.beforeValue} but found ${current}`)
  }
  let root: unknown
  if (correction.entityType === 'team') {
    root = [boxScore.teams.home, boxScore.teams.away].find((team) => team.teamId === correction.entityId)
  } else {
    root = boxScore.characters[correction.entityId]
  }
  writeNumericPath(root as Record<string, unknown>, correction.statPath, correction.afterValue)
}

function readNumericPath(root: unknown, path: string): number | null {
  let current = root
  for (let part of path.split('.')) {
    if (!current || typeof current !== 'object' || !(part in current)) return null
    current = (current as Record<string, unknown>)[part]
  }
  return typeof current === 'number' && Number.isInteger(current) ? current : null
}

function writeNumericPath(root: Record<string, unknown>, path: string, value: number): void {
  let parts = path.split('.')
  let current = root
  for (let part of parts.slice(0, -1)) current = current[part] as Record<string, unknown>
  current[parts.at(-1)!] = value
}

function normalizedCorrections(corrections: TelemetryCorrectionRecord[]) {
  return corrections.map(({ actorPersonId, afterValue, beforeValue, createdAt, entityId, entityType, id, reason, statPath }) => ({
    actorPersonId, afterValue, beforeValue, createdAt: createdAt.toISOString(), entityId, entityType, id, reason, statPath,
  }))
}

function digest(value: unknown): string {
  return createHash('sha256').update(stableJson(value)).digest('hex')
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}
