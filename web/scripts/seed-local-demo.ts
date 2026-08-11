import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  RulesetRevisionSchema,
  StatProfileRevisionSchema,
  TeamLineupRevisionSchema,
} from '@starworks/contracts'
import { and, eq } from 'drizzle-orm'

import lineupFixture from '../../contracts/fixtures/valid/team-lineup-revision.json' with { type: 'json' }
import rulesetFixture from '../../contracts/fixtures/valid/ruleset-revision.json' with { type: 'json' }
import statProfileFixture from '../../contracts/fixtures/valid/stat-profile-revision.json' with { type: 'json' }
import { RunnerAdminService } from '../app/runner/admin-service.ts'
import { createDatabase } from '../app/platform/database/connection.ts'
import {
  gameCharacters,
  leagueMembershipRoles,
  leagueMemberships,
  leagueTeams,
  leagues,
  lineupRevisions,
  matches,
  matchAttempts,
  rosterRevisions,
  rulesetRevisions,
  rulesets,
  runnerCredentials,
  seasons,
  sessions,
  statProfileRevisions,
  statProfiles,
  venues,
} from '../app/platform/database/schema.ts'
import { PostgresPlatformRepository } from '../app/platform/database/postgres-repository.ts'
import type { SessionIdentity } from '../app/platform/model.ts'
import { createOpaqueToken, hashSecret } from '../app/platform/security.ts'
import { PlatformService } from '../app/platform/service.ts'

const DEMO_SLUG = 'mushroom-league'
const DEMO_GAME_BUILD_SHA256 = '1016a24051e66c309b6399692acf1c50601d9b3c49c0ec467a55d24d62743d00'
const ids = {
  awayLineup: '10000000-0000-4000-8000-000000000602',
  awayRoster: '10000000-0000-4000-8000-000000000502',
  awayTeam: '10000000-0000-4000-8000-000000000202',
  homeLineup: '10000000-0000-4000-8000-000000000601',
  homeRoster: '10000000-0000-4000-8000-000000000501',
  homeTeam: '10000000-0000-4000-8000-000000000201',
  profile: '10000000-0000-4000-8000-000000000301',
  profileRevision: '10000000-0000-4000-8000-000000000302',
  ruleset: '10000000-0000-4000-8000-000000000401',
  rulesetRevision: '10000000-0000-4000-8000-000000000402',
  runnerCredential: '10000000-0000-4000-8000-000000000801',
  season: '10000000-0000-4000-8000-000000000101',
  venue: '10000000-0000-4000-8000-000000000701',
} as const

const characterNames = new Map([
  ['baby-mario', 'Baby Mario'],
  ['birdo', 'Birdo'],
  ['boo', 'Boo'],
  ['bowser', 'Bowser'],
  ['bowser-jr', 'Bowser Jr.'],
  ['daisy', 'Daisy'],
  ['diddy-kong', 'Diddy Kong'],
  ['dixie-kong', 'Dixie Kong'],
  ['donkey-kong', 'Donkey Kong'],
  ['funky-kong', 'Funky Kong'],
  ['king-boo', 'King Boo'],
  ['luigi', 'Luigi'],
  ['mario', 'Mario'],
  ['peach', 'Peach'],
  ['petey-piranha', 'Petey Piranha'],
  ['toad', 'Toad'],
  ['toadette', 'Toadette'],
  ['waluigi', 'Waluigi'],
  ['wario', 'Wario'],
  ['yoshi', 'Yoshi'],
])

const homeRoster = [
  'mario', 'luigi', 'peach', 'daisy', 'yoshi',
  'birdo', 'toad', 'toadette', 'bowser', 'baby-mario',
]
const awayRoster = [
  'wario', 'waluigi', 'donkey-kong', 'diddy-kong', 'bowser-jr',
  'boo', 'king-boo', 'petey-piranha', 'dixie-kong', 'funky-kong',
]
const positions = ['P', 'C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF'] as const

let repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
let environmentPath = path.join(repositoryRoot, '.starworks/demo.env')
let existingEnvironment = await readEnvironment(environmentPath)
let sessionToken = existingEnvironment.STARWORKS_DEMO_SESSION_TOKEN ?? createOpaqueToken()
let runnerSecret = existingEnvironment.STARWORKS_DEMO_RUNNER_SECRET ?? createOpaqueToken()
let databaseUrl = process.env.DATABASE_URL
  ?? 'postgres://starworks:starworks@127.0.0.1:5432/starworks'
let now = new Date()
let publishedAt = new Date(now.getTime() - 60_000)
let connection = createDatabase(databaseUrl, { max: 1 })

try {
  let repository = new PostgresPlatformRepository(connection.database)
  let platform = new PlatformService(repository)
  let admin = await repository.bootstrapSiteAdmin({
    discordUserId: '100000000000000001',
    discordUsername: 'starworks-demo-admin',
    displayName: 'Starworks Demo Commissioner',
  })

  let [league] = await connection.database
    .select({ id: leagues.id, name: leagues.name, slug: leagues.slug })
    .from(leagues)
    .where(eq(leagues.slug, DEMO_SLUG))
    .limit(1)
  if (!league) {
    let provisioned = await platform.provisionLeague(admin, {
      name: 'Mushroom League',
      slug: DEMO_SLUG,
    })
    league = provisioned.league
  }

  await connection.database.transaction(async (database) => {
    await database.insert(leagueMemberships).values({
      leagueId: league.id,
      personId: admin.personId,
    }).onConflictDoNothing()
    await database.insert(leagueMembershipRoles).values({
      grantedByPersonId: admin.personId,
      leagueId: league.id,
      personId: admin.personId,
      role: 'owner',
    }).onConflictDoNothing()
    await database.insert(gameCharacters).values(
      [...characterNames].map(([characterId, displayName]) => ({
        characterId,
        displayName,
        gameId: 'RMBE01',
        isCaptain: [
          'mario', 'luigi', 'donkey-kong', 'diddy-kong', 'peach', 'daisy',
          'yoshi', 'bowser', 'wario', 'waluigi', 'birdo', 'bowser-jr',
        ].includes(characterId),
      })),
    ).onConflictDoNothing()
    await database.insert(seasons).values({
      id: ids.season,
      leagueId: league.id,
      name: 'Summer 2026',
      slug: 'summer-2026',
      status: 'active',
    }).onConflictDoNothing()
    await database.insert(venues).values({
      gameVenueId: 'mario-stadium',
      id: ids.venue,
      leagueId: league.id,
      name: 'Mario Stadium',
      slug: 'mario-stadium',
    }).onConflictDoNothing()
    await database.insert(leagueTeams).values([
      {
        abbreviation: 'FBL',
        color: '#e83b3b',
        id: ids.homeTeam,
        leagueId: league.id,
        managerPersonId: admin.personId,
        name: 'Mario Fireballs',
        seasonId: ids.season,
        slug: 'mario-fireballs',
      },
      {
        abbreviation: 'MSL',
        color: '#ffd447',
        id: ids.awayTeam,
        leagueId: league.id,
        managerPersonId: admin.personId,
        name: 'Wario Muscles',
        seasonId: ids.season,
        slug: 'wario-muscles',
      },
    ]).onConflictDoNothing()

    let profileSource = StatProfileRevisionSchema.parse(statProfileFixture)
    await database.insert(statProfiles).values({
      id: ids.profile,
      leagueId: league.id,
      name: 'Competitive Demo Stats',
      slug: 'competitive-demo-stats',
    }).onConflictDoNothing()
    await database.insert(statProfileRevisions).values({
      basedOnRevisionId: null,
      characterValues: profileSource.characterValues,
      createdByPersonId: admin.personId,
      definitions: profileSource.definitions,
      id: ids.profileRevision,
      leagueId: league.id,
      name: 'Competitive Demo Stats',
      profileId: ids.profile,
      publishedAt,
      revisionNumber: 1,
      sluggersTuning: profileSource.sluggersTuning ?? null,
      status: 'published',
    }).onConflictDoNothing()

    let rulesSource = RulesetRevisionSchema.parse(rulesetFixture)
    await database.insert(rulesets).values({
      id: ids.ruleset,
      leagueId: league.id,
      name: 'Seven Inning CPU Rules',
      slug: 'seven-inning-cpu-rules',
    }).onConflictDoNothing()
    await database.insert(rulesetRevisions).values({
      basedOnRevisionId: null,
      createdByPersonId: admin.personId,
      id: ids.rulesetRevision,
      leagueId: league.id,
      name: 'Seven Inning CPU Rules',
      publishedAt,
      revisionNumber: 1,
      rulesetId: ids.ruleset,
      settings: rulesSource.settings.map((setting) =>
        setting.key === 'game.innings' ? { ...setting, value: 7 } : setting,
      ),
      status: 'published',
    }).onConflictDoNothing()

    for (let team of [
      createTeamFixture(league.id, ids.homeTeam, ids.homeRoster, ids.homeLineup, homeRoster, 'mario', 'luigi'),
      createTeamFixture(league.id, ids.awayTeam, ids.awayRoster, ids.awayLineup, awayRoster, 'wario', 'waluigi'),
    ]) {
      await database.insert(rosterRevisions).values({
        createdByPersonId: admin.personId,
        id: team.rosterRevisionId,
        leagueId: league.id,
        publishedAt,
        revisionNumber: 1,
        rosterCharacterIds: team.rosterCharacterIds,
        status: 'published',
        teamId: team.teamId,
      }).onConflictDoNothing()
      await database.insert(lineupRevisions).values({
        createdByPersonId: admin.personId,
        id: team.lineupRevisionId,
        leagueId: league.id,
        lineup: team.lineup,
        publishedAt,
        revisionNumber: 1,
        rosterRevisionId: team.rosterRevisionId,
        status: 'published',
        teamId: team.teamId,
      }).onConflictDoNothing()
    }

    await database.insert(sessions).values({
      expiresAt: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1_000),
      personId: admin.personId,
      tokenHash: hashSecret(sessionToken),
    }).onConflictDoUpdate({
      set: {
        expiresAt: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1_000),
        revokedAt: null,
      },
      target: sessions.tokenHash,
    })
    await database.insert(runnerCredentials).values({
      createdByPersonId: admin.personId,
      id: ids.runnerCredential,
      leagueId: league.id,
      name: 'Local demo station',
      scopes: [
        'artifacts:read', 'heartbeat:write', 'runs:claim', 'runs:read',
        'telemetry:write',
      ],
      secretHash: hashSecret(runnerSecret),
    }).onConflictDoUpdate({
      set: {
        expiresAt: null,
        name: 'Local demo station',
        revokedAt: null,
        scopes: [
          'artifacts:read', 'heartbeat:write', 'runs:claim', 'runs:read',
          'telemetry:write',
        ],
        secretHash: hashSecret(runnerSecret),
      },
      target: runnerCredentials.id,
    })
  })

  let demoIdentity: SessionIdentity = {
    ...admin,
    memberships: [{
      leagueId: league.id,
      leagueName: league.name,
      leagueSlug: league.slug,
      roles: ['owner'],
    }],
  }
  let [match] = await connection.database
    .select({ id: matches.id })
    .from(matches)
    .where(and(
      eq(matches.leagueId, league.id),
      eq(matches.homeTeamId, ids.homeTeam),
      eq(matches.awayTeamId, ids.awayTeam),
    ))
    .limit(1)
  let runnerAdmin = new RunnerAdminService(connection.database)
  if (!match) {
    match = await runnerAdmin.scheduleMatch(demoIdentity, league.id, {
      awayTeamId: ids.awayTeam,
      homeTeamId: ids.homeTeam,
      scheduledAt: null,
      seasonId: ids.season,
      venueId: ids.venue,
    })
  }
  let [attempt] = await connection.database
    .select({ id: matchAttempts.id })
    .from(matchAttempts)
    .where(and(
      eq(matchAttempts.leagueId, league.id),
      eq(matchAttempts.matchId, match.id),
    ))
    .limit(1)
  if (!attempt) {
    await runnerAdmin.queueAttempt(demoIdentity, league.id, match.id, {
      awayLineupRevisionId: ids.awayLineup,
      contentPackRevisionId: null,
      dynamicRuleOverrides: { 'game.innings': 7 },
      executionMode: 'cpu-vs-cpu',
      gameStadiumId: 'mario-stadium',
      homeLineupRevisionId: ids.homeLineup,
      requiredGameBuildSha256: DEMO_GAME_BUILD_SHA256,
      rulesetRevisionId: ids.rulesetRevision,
      statProfileRevisionId: ids.profileRevision,
    })
  }

  let runnerCredential = `starworks_runner_${ids.runnerCredential}.${runnerSecret}`
  await mkdir(path.dirname(environmentPath), { recursive: true })
  await writeFile(environmentPath, [
    'STARWORKS_DEMO_MODE=local-only',
    `STARWORKS_DEMO_SESSION_TOKEN=${sessionToken}`,
    `STARWORKS_DEMO_RUNNER_SECRET=${runnerSecret}`,
    `STARWORKS_DEMO_LEAGUE_SLUG=${DEMO_SLUG}`,
    `STARWORKS_RUNNER_CREDENTIAL=${runnerCredential}`,
    'STARWORKS_URL=http://127.0.0.1:3000',
    '',
  ].join('\n'), { encoding: 'utf8', mode: 0o600 })
  await chmod(environmentPath, 0o600)

  console.log(JSON.stringify({
    environmentFile: environmentPath,
    league: league.name,
    loginUrl: 'http://127.0.0.1:3000/auth/local-demo',
    operationsUrl: `http://127.0.0.1:3000/leagues/${DEMO_SLUG}/operations`,
    seededAttempt: true,
  }, null, 2))
} finally {
  await connection.close()
}

function createTeamFixture(
  leagueId: string,
  teamId: string,
  rosterRevisionId: string,
  lineupRevisionId: string,
  rosterCharacterIds: string[],
  captainCharacterId: string,
  pitcherCharacterId: string,
) {
  let battingOrder = rosterCharacterIds.slice(0, 9)
  return TeamLineupRevisionSchema.parse({
    ...lineupFixture,
    basedOnLineupRevisionId: null,
    createdAt: new Date().toISOString(),
    leagueId,
    lineup: {
      battingOrder,
      bench: rosterCharacterIds.slice(9),
      captainCharacterId,
      fielding: positions.map((position, index) => ({
        characterId: index === 0
          ? pitcherCharacterId
          : battingOrder.filter((characterId) => characterId !== pitcherCharacterId)[index - 1],
        position,
      })),
      pitcherCharacterId,
    },
    lineupRevisionId,
    lineupRevisionNumber: 1,
    publishedAt: new Date().toISOString(),
    rosterCharacterIds,
    rosterRevisionId,
    rosterRevisionNumber: 1,
    teamId,
  })
}

async function readEnvironment(filePath: string): Promise<Record<string, string>> {
  let contents: string
  try {
    contents = await readFile(filePath, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {}
    throw error
  }
  return Object.fromEntries(contents.split(/\r?\n/).flatMap((line) => {
    let separator = line.indexOf('=')
    return separator > 0 ? [[line.slice(0, separator), line.slice(separator + 1)]] : []
  }))
}
