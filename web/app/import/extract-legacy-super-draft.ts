import postgres from 'postgres'

import {
  LegacySuperDraftSnapshotSchema,
  type LegacySuperDraftSnapshot,
} from './legacy-super-draft-snapshot.ts'

interface LegacyConferenceRow {
  color: string | null
  id: number
  name: string
  season_id: number
}

interface LegacySeasonRow {
  id: number
  state: 'pre-season' | 'drafting' | 'playing' | 'finished'
}

interface LegacyTeamRow {
  abbreviation: string
  color: string | null
  conference_id: number | null
  id: number
  name: string
  user_id: number
}

interface LegacyUserRow {
  discord_snowflake: string
  id: number
  name: string
  role: 'admin' | 'user'
}

interface LegacyVenueRow {
  id: number
  name: string
}

export async function extractLegacySuperDraftSnapshot(
  databaseUrl: string,
): Promise<LegacySuperDraftSnapshot> {
  let sql = postgres(databaseUrl, { max: 1, onnotice: () => {} })
  try {
    let seasons = await sql<LegacySeasonRow[]>`
      select id, state from season order by id
    `
    if (seasons.length !== 1) {
      throw new Error(`Expected exactly one legacy season, found ${seasons.length}`)
    }
    let [users, conferences, teams, venues] = await Promise.all([
      sql<LegacyUserRow[]>`
        select id, name, role, discord_snowflake from "user" order by id
      `,
      sql<LegacyConferenceRow[]>`
        select id, name, color, season_id from conferences order by id
      `,
      sql<LegacyTeamRow[]>`
        select id, name, color, user_id, abbreviation, conference_id from team order by id
      `,
      sql<LegacyVenueRow[]>`
        select id, name from match_locations order by id
      `,
    ])
    let season = seasons[0]!
    return LegacySuperDraftSnapshotSchema.parse({
      conferences: conferences.map((conference) => ({
        color: conference.color,
        name: conference.name,
        seasonSourceId: String(conference.season_id),
        sourceId: String(conference.id),
      })),
      format: 'starworks.legacy-super-draft-snapshot.v1',
      season: { sourceId: String(season.id), state: season.state },
      teams: teams.map((team) => ({
        abbreviation: team.abbreviation,
        color: team.color,
        conferenceSourceId: team.conference_id == null ? null : String(team.conference_id),
        managerUserSourceId: String(team.user_id),
        name: team.name,
        sourceId: String(team.id),
      })),
      users: users.map((user) => ({
        discordSnowflake: user.discord_snowflake,
        name: user.name,
        role: user.role,
        sourceId: String(user.id),
      })),
      venues: venues.map((venue) => ({ name: venue.name, sourceId: String(venue.id) })),
    })
  } finally {
    await sql.end()
  }
}
