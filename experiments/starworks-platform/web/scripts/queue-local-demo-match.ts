import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

import { and, desc, eq } from 'drizzle-orm'

import { ConfigurationService } from '../app/configuration/service.ts'
import { demoTeamLineup, parseLocalDemoMatch } from '../app/import/local-demo-match.ts'
import { createDatabase } from '../app/platform/database/connection.ts'
import {
  leagueTeams,
  leagues,
  matchAttempts,
  rulesetRevisions,
  rulesets,
  statProfileRevisions,
  statProfiles,
  venues,
} from '../app/platform/database/schema.ts'
import { PostgresPlatformRepository } from '../app/platform/database/postgres-repository.ts'
import { RunnerAdminService } from '../app/runner/admin-service.ts'

// Exact managed build accepted with the current adapter and pre-roster
// checkpoint. This is an immutable build identity, not a public protocol
// version; refresh it only after the live checkpoint acceptance run.
const DEMO_GAME_BUILD_SHA256 = process.env.STARWORKS_DEFAULT_GAME_BUILD_SHA256
  ?? '5bc0232095a87d64fee0c42110705b14991a73621669ca911fa17c4949f530f5'
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: { innings: { short: 'i', type: 'string' } },
})
if (positionals.length > 1) throw new Error('Expected at most one demo match file')
const configurationPath = path.resolve(
  positionals[0] ?? path.join(repositoryRoot, 'demo/sluggers-match.json'),
)
let configurationDocument: unknown = JSON.parse(await readFile(configurationPath, 'utf8'))
if (values.innings !== undefined) {
  if (!configurationDocument || typeof configurationDocument !== 'object' || Array.isArray(configurationDocument)) {
    throw new Error('Demo match file must contain an object')
  }
  configurationDocument = { ...configurationDocument, innings: Number(values.innings) }
}
const configuration = parseLocalDemoMatch(
  configurationDocument,
)
const databaseUrl = process.env.DATABASE_URL
  ?? 'postgres://starworks:starworks@127.0.0.1:5432/starworks'
const connection = createDatabase(databaseUrl, { max: 1 })

try {
  let repository = new PostgresPlatformRepository(connection.database)
  let identity = await repository.bootstrapSiteAdmin({
    discordUserId: '100000000000000001',
    discordUsername: 'starworks-demo-admin',
    displayName: 'Starworks Demo Commissioner',
  })
  let [league] = await connection.database
    .select({ id: leagues.id })
    .from(leagues)
    .where(eq(leagues.slug, configuration.league))
    .limit(1)
  if (!league) throw new Error(`Demo league ${configuration.league} does not exist; run npm run demo:seed first`)

  let selectedTeams = await connection.database
    .select({ id: leagueTeams.id, seasonId: leagueTeams.seasonId, slug: leagueTeams.slug })
    .from(leagueTeams)
    .where(eq(leagueTeams.leagueId, league.id))
  let homeTeam = selectedTeams.find((team) => team.slug === configuration.home.team)
  let awayTeam = selectedTeams.find((team) => team.slug === configuration.away.team)
  if (!homeTeam || !awayTeam) throw new Error('Demo match references a team that does not exist in the configured league')
  if (homeTeam.seasonId !== awayTeam.seasonId) throw new Error('Demo teams must belong to the same season')

  let [[profile], [ruleset], [venue]] = await Promise.all([
    connection.database
      .select({ revisionId: statProfileRevisions.id })
      .from(statProfileRevisions)
      .innerJoin(statProfiles, and(
        eq(statProfiles.leagueId, statProfileRevisions.leagueId),
        eq(statProfiles.id, statProfileRevisions.profileId),
      ))
      .where(and(
        eq(statProfileRevisions.leagueId, league.id),
        eq(statProfileRevisions.status, 'published'),
        eq(statProfiles.slug, configuration.statProfile),
      ))
      .orderBy(desc(statProfileRevisions.revisionNumber))
      .limit(1),
    connection.database
      .select({ revisionId: rulesetRevisions.id })
      .from(rulesetRevisions)
      .innerJoin(rulesets, and(
        eq(rulesets.leagueId, rulesetRevisions.leagueId),
        eq(rulesets.id, rulesetRevisions.rulesetId),
      ))
      .where(and(
        eq(rulesetRevisions.leagueId, league.id),
        eq(rulesetRevisions.status, 'published'),
        eq(rulesets.slug, configuration.ruleset),
      ))
      .orderBy(desc(rulesetRevisions.revisionNumber))
      .limit(1),
    connection.database
      .select({ id: venues.id })
      .from(venues)
      .where(and(
        eq(venues.leagueId, league.id),
        eq(venues.gameVenueId, configuration.stadium),
      ))
      .limit(1),
  ])
  if (!profile) throw new Error(`Published demo stat profile ${configuration.statProfile} was not found`)
  if (!ruleset) throw new Error(`Published demo ruleset ${configuration.ruleset} was not found`)
  if (!venue) throw new Error(`Demo stadium ${configuration.stadium} was not found`)

  let configurations = new ConfigurationService(connection.database)
  let homeDraft = await configurations.createTeamLineupDraft(
    identity,
    league.id,
    homeTeam.id,
    demoTeamLineup(configuration.home),
  )
  let homeLineup = await configurations.publishTeamLineup(
    identity,
    league.id,
    homeTeam.id,
    homeDraft.lineupRevisionId,
  )
  let awayDraft = await configurations.createTeamLineupDraft(
    identity,
    league.id,
    awayTeam.id,
    demoTeamLineup(configuration.away),
  )
  let awayLineup = await configurations.publishTeamLineup(
    identity,
    league.id,
    awayTeam.id,
    awayDraft.lineupRevisionId,
  )

  let runnerAdmin = new RunnerAdminService(connection.database)
  let match = await runnerAdmin.scheduleMatch(identity, league.id, {
    awayTeamId: awayTeam.id,
    homeTeamId: homeTeam.id,
    scheduledAt: null,
    seasonId: homeTeam.seasonId,
    venueId: venue.id,
  })
  let attempt = await runnerAdmin.queueAttempt(identity, league.id, match.id, {
    awayLineupRevisionId: awayLineup.lineupRevisionId,
    contentPackRevisionId: null,
    dynamicRuleOverrides: { 'game.innings': configuration.innings },
    executionMode: 'cpu-vs-cpu',
    gameStadiumId: configuration.stadium,
    homeLineupRevisionId: homeLineup.lineupRevisionId,
    requiredGameBuildSha256: DEMO_GAME_BUILD_SHA256,
    rulesetRevisionId: ruleset.revisionId,
    statProfileRevisionId: profile.revisionId,
  })

  let queuedAttempts = await connection.database
    .select({ id: matchAttempts.id })
    .from(matchAttempts)
    .where(and(
      eq(matchAttempts.leagueId, league.id),
      eq(matchAttempts.status, 'queued'),
    ))

  console.log(JSON.stringify({
    attemptId: attempt.attemptId,
    configuration: configurationPath,
    home: {
      battingOrder: configuration.home.battingOrder,
      captain: configuration.home.captain,
      fielding: configuration.home.fielding,
      team: configuration.home.team,
    },
    away: {
      battingOrder: configuration.away.battingOrder,
      captain: configuration.away.captain,
      fielding: configuration.away.fielding,
      team: configuration.away.team,
    },
    queuedAttemptsInLeague: queuedAttempts.length,
    innings: configuration.innings,
    stadium: configuration.stadium,
  }, null, 2))
} finally {
  await connection.close()
}
