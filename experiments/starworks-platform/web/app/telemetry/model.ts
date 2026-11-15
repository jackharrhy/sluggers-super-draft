export interface TeamBoxScore {
  teamId: string
  runs: number
  hits: number
  errors: number
  lineScore: Record<string, number>
}

export interface CharacterBoxScore {
  teamId: string
  batting: {
    plateAppearances: number
    atBats: number
    hits: number
    singles: number
    doubles: number
    triples: number
    homeRuns: number
    walks: number
    strikeouts: number
    hitByPitch: number
    sacrifices: number
    runsBattedIn: number
    totalBases: number
  }
  running: { runs: number }
  pitching: {
    battersFaced: number
    outsPitched: number
    hitsAllowed: number
    runsAllowed: number
    walks: number
    strikeouts: number
  }
  fielding: { errors: number }
  positions: string[]
}

export interface MatchBoxScore {
  derivationVersion: 1
  teams: { home: TeamBoxScore; away: TeamBoxScore }
  characters: Record<string, CharacterBoxScore>
  innings: number
  endedReason: 'completed' | 'mercy' | 'forfeit' | 'quit' | null
}

export interface TelemetryCorrectionRecord {
  id: string
  entityType: 'team' | 'character'
  entityId: string
  statPath: string
  beforeValue: number
  afterValue: number
  reason: string
  actorPersonId: string
  createdAt: Date
}

export interface TelemetryHealth {
  eventCount: number
  firstSequence: number
  lastSequence: number
  nextExpectedSequence: number
  issues: string[]
  requiresReview: boolean
}

export interface TelemetryDerivationResult {
  boxScore: MatchBoxScore
  health: TelemetryHealth
  inputDigest: string
  correctionCount: number
}
