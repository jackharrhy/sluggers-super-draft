import { eq } from 'drizzle-orm'

import { createDatabase } from '../app/platform/database/connection.ts'
import {
  auditRecords,
  discordNotificationOutbox,
  leagues,
  matchLineupOverrides,
  matches,
  runnerStations,
} from '../app/platform/database/schema.ts'

const demoLeagueSlug = process.env.STARWORKS_DEMO_LEAGUE_SLUG ?? 'mushroom-league'
const databaseUrl = process.env.DATABASE_URL
  ?? 'postgres://starworks:starworks@127.0.0.1:5432/starworks'
const connection = createDatabase(databaseUrl, { max: 1 })

try {
  let [league] = await connection.database
    .select({ id: leagues.id, name: leagues.name })
    .from(leagues)
    .where(eq(leagues.slug, demoLeagueSlug))
    .limit(1)
  if (!league) throw new Error(`Demo league ${demoLeagueSlug} does not exist; run npm run demo:seed first`)

  let removed = await connection.database.transaction(async (database) => {
    let removedOverrides = await database
      .delete(matchLineupOverrides)
      .where(eq(matchLineupOverrides.leagueId, league.id))
      .returning({ id: matchLineupOverrides.id })
    let removedMatches = await database
      .delete(matches)
      .where(eq(matches.leagueId, league.id))
      .returning({ id: matches.id })
    let removedOutbox = await database
      .delete(discordNotificationOutbox)
      .where(eq(discordNotificationOutbox.leagueId, league.id))
      .returning({ id: discordNotificationOutbox.id })
    let removedAudit = await database
      .delete(auditRecords)
      .where(eq(auditRecords.leagueId, league.id))
      .returning({ id: auditRecords.id })
    await database
      .update(runnerStations)
      .set({ componentHealth: {}, lastHeartbeatAt: null, runtimeState: 'idle' })
      .where(eq(runnerStations.leagueId, league.id))
    return {
      auditRecords: removedAudit.length,
      matchLineupOverrides: removedOverrides.length,
      matches: removedMatches.length,
      notificationMessages: removedOutbox.length,
    }
  })

  console.log(JSON.stringify({
    league: league.name,
    preserved: ['league', 'teams', 'lineups', 'stat profiles', 'rulesets', 'runner station'],
    removed,
  }, null, 2))
} finally {
  await connection.close()
}
