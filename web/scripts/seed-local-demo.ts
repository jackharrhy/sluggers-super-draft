import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  StatProfileRevisionSchema,
  TeamLineupRevisionSchema,
} from '@starworks/contracts'
import { and, eq, max, ne } from 'drizzle-orm'

import lineupFixture from '../../contracts/fixtures/valid/team-lineup-revision.json' with { type: 'json' }
import statProfileFixture from '../../contracts/fixtures/valid/stat-profile-revision.json' with { type: 'json' }
import demoMatchFixture from '../../demo/sluggers-match.json' with { type: 'json' }
import { DraftService } from '../app/draft/service.ts'
import { createStarterRulesetSettings } from '../app/configuration/sluggers-rules.ts'
import { buildStatEditorV4Fixture } from '../app/import/stat-editor-v4.fixture.ts'
import { importStatEditorV4 } from '../app/import/stat-editor-v4.ts'
import { demoTeamLineup, parseLocalDemoMatch } from '../app/import/local-demo-match.ts'
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
  telemetryDerivations,
  venues,
} from '../app/platform/database/schema.ts'
import { PostgresPlatformRepository } from '../app/platform/database/postgres-repository.ts'
import type { SessionIdentity } from '../app/platform/model.ts'
import { createOpaqueToken, hashSecret } from '../app/platform/security.ts'
import { PlatformService } from '../app/platform/service.ts'
import { displayCharacterName, SLUGGERS_CHARACTER_IDS } from '../app/sluggers/characters.ts'
import type { CharacterBoxScore, MatchBoxScore } from '../app/telemetry/model.ts'

const DEMO_SLUG = 'mushroom-league'
const DEMO_GAME_BUILD_SHA256 = '1016a24051e66c309b6399692acf1c50601d9b3c49c0ec467a55d24d62743d00'
const ids = {
  awayLineup: '10000000-0000-4000-8000-000000000602',
  awayRoster: '10000000-0000-4000-8000-000000000502',
  awayTeam: '10000000-0000-4000-8000-000000000202',
  homeLineup: '10000000-0000-4000-8000-000000000601',
  homeLineupDraft: '10000000-0000-4000-8000-000000000603',
  homeRoster: '10000000-0000-4000-8000-000000000501',
  homeRosterDraft: '10000000-0000-4000-8000-000000000503',
  homeTeam: '10000000-0000-4000-8000-000000000201',
  historicalAttempt: '10000000-0000-4000-8000-000000000902',
  historicalCorrelation: '10000000-0000-4000-8000-000000000904',
  historicalDerivation: '10000000-0000-4000-8000-000000000903',
  historicalMatch: '10000000-0000-4000-8000-000000000901',
  profile: '10000000-0000-4000-8000-000000000301',
  profileRevision: '10000000-0000-4000-8000-000000000302',
  statEditorProfile: '10000000-0000-4000-8000-000000000303',
  statEditorRevision: '10000000-0000-4000-8000-000000000304',
  statEditorPublishedRevision: '10000000-0000-4000-8000-000000000305',
  ruleset: '10000000-0000-4000-8000-000000000401',
  rulesetDraftRevision: '10000000-0000-4000-8000-000000000403',
  rulesetRevision: '10000000-0000-4000-8000-000000000402',
  runnerCredential: '10000000-0000-4000-8000-000000000801',
  season: '10000000-0000-4000-8000-000000000101',
  venue: '10000000-0000-4000-8000-000000000701',
} as const

const demoMatch = parseLocalDemoMatch(demoMatchFixture)
if (demoMatch.league !== DEMO_SLUG || demoMatch.home.team !== 'mario-fireballs' || demoMatch.away.team !== 'wario-muscles') {
  throw new Error('The default demo file must target the seeded Mushroom League teams')
}

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
      SLUGGERS_CHARACTER_IDS.map((characterId) => ({
        characterId,
        displayName: displayCharacterName(characterId),
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

    let statEditorDraft = importStatEditorV4({
      profileName: 'Stat Editor Sandbox',
      rawText: buildStatEditorV4Fixture(),
      sourceVersion: 'v4',
    })
    await database.insert(statProfiles).values({
      id: ids.statEditorProfile,
      leagueId: league.id,
      name: statEditorDraft.name,
      slug: 'stat-editor-sandbox',
    }).onConflictDoNothing()
    await database.update(statProfileRevisions).set({
      revisionNumber: 2,
    }).where(eq(statProfileRevisions.id, ids.statEditorRevision))
    await database.insert(statProfileRevisions).values({
      basedOnRevisionId: null,
      characterValues: statEditorDraft.characterValues,
      createdByPersonId: admin.personId,
      definitions: statEditorDraft.definitions,
      id: ids.statEditorPublishedRevision,
      leagueId: league.id,
      name: 'Summer 2026 Draft Pool',
      profileId: ids.statEditorProfile,
      publishedAt,
      revisionNumber: 1,
      sluggersTuning: statEditorDraft.sluggersTuning,
      status: 'published',
    }).onConflictDoNothing()
    await database.insert(statProfileRevisions).values({
      basedOnRevisionId: ids.statEditorPublishedRevision,
      characterValues: statEditorDraft.characterValues,
      createdByPersonId: admin.personId,
      definitions: statEditorDraft.definitions,
      id: ids.statEditorRevision,
      leagueId: league.id,
      name: statEditorDraft.name,
      profileId: ids.statEditorProfile,
      publishedAt: null,
      revisionNumber: 2,
      sluggersTuning: statEditorDraft.sluggersTuning,
      status: 'draft',
    }).onConflictDoUpdate({
      set: {
        basedOnRevisionId: ids.statEditorPublishedRevision,
        characterValues: statEditorDraft.characterValues,
        definitions: statEditorDraft.definitions,
        name: statEditorDraft.name,
        revisionNumber: 2,
        sluggersTuning: statEditorDraft.sluggersTuning,
      },
      target: statProfileRevisions.id,
    })

    let rulesSettings = createStarterRulesetSettings().map((setting) =>
      setting.key === 'game.innings' ? { ...setting, value: demoMatch.innings } : setting,
    )
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
      settings: rulesSettings,
      status: 'published',
    }).onConflictDoNothing()
    await database.insert(rulesetRevisions).values({
      basedOnRevisionId: ids.rulesetRevision,
      createdByPersonId: admin.personId,
      id: ids.rulesetDraftRevision,
      leagueId: league.id,
      name: 'Seven Inning CPU Rules',
      publishedAt: null,
      revisionNumber: 2,
      rulesetId: ids.ruleset,
      settings: rulesSettings,
      status: 'draft',
    }).onConflictDoNothing()

    for (let team of [
      createTeamFixture(league.id, ids.homeTeam, ids.homeRoster, ids.homeLineup, demoTeamLineup(demoMatch.home)),
      createTeamFixture(league.id, ids.awayTeam, ids.awayRoster, ids.awayLineup, demoTeamLineup(demoMatch.away)),
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
    let [[homeRoster], [homeLineup], [homeRosterDraft], [homeLineupDraft], [homeRosterLatest], [homeLineupLatest]] = await Promise.all([
      database.select().from(rosterRevisions).where(eq(rosterRevisions.id, ids.homeRoster)).limit(1),
      database.select().from(lineupRevisions).where(eq(lineupRevisions.id, ids.homeLineup)).limit(1),
      database.select({ id: rosterRevisions.id }).from(rosterRevisions).where(eq(rosterRevisions.id, ids.homeRosterDraft)).limit(1),
      database.select({ id: lineupRevisions.id }).from(lineupRevisions).where(eq(lineupRevisions.id, ids.homeLineupDraft)).limit(1),
      database.select({ value: max(rosterRevisions.revisionNumber) }).from(rosterRevisions).where(and(eq(rosterRevisions.leagueId, league.id), eq(rosterRevisions.teamId, ids.homeTeam))),
      database.select({ value: max(lineupRevisions.revisionNumber) }).from(lineupRevisions).where(and(eq(lineupRevisions.leagueId, league.id), eq(lineupRevisions.teamId, ids.homeTeam))),
    ])
    if (!homeRoster || !homeLineup) throw new Error('Seeded home lineup was not found')
    if (!homeRosterDraft) {
      await database.insert(rosterRevisions).values({
        basedOnRevisionId: ids.homeRoster,
        createdByPersonId: admin.personId,
        id: ids.homeRosterDraft,
        leagueId: league.id,
        revisionNumber: (homeRosterLatest?.value ?? 0) + 1,
        rosterCharacterIds: homeRoster.rosterCharacterIds,
        status: 'draft',
        teamId: ids.homeTeam,
      })
    }
    if (!homeLineupDraft) {
      await database.insert(lineupRevisions).values({
        basedOnRevisionId: ids.homeLineup,
        createdByPersonId: admin.personId,
        id: ids.homeLineupDraft,
        leagueId: league.id,
        lineup: homeLineup.lineup,
        revisionNumber: (homeLineupLatest?.value ?? 0) + 1,
        rosterRevisionId: ids.homeRosterDraft,
        status: 'draft',
        teamId: ids.homeTeam,
      })
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
      ne(matches.status, 'confirmed'),
    ))
    .limit(1)
  let runnerAdmin = new RunnerAdminService(connection.database)
  let draftService = new DraftService(connection.database)
  let draftDashboard = await draftService.dashboard(demoIdentity, league.id)
  let seededDraftId = draftDashboard.drafts.find((draft) => draft.name === 'Summer 2026 Demo Draft')?.id
  if (!seededDraftId) {
    seededDraftId = (await draftService.createDraft(demoIdentity, league.id, {
      gameId: 'RMBE01',
      name: 'Summer 2026 Demo Draft',
      orderMode: 'snake',
      pickSeconds: 120,
      rounds: 9,
      seasonId: ids.season,
      slotTeamIds: [ids.homeTeam, ids.awayTeam],
      statProfileRevisionId: ids.statEditorPublishedRevision,
    })).id
  }
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
      dynamicRuleOverrides: { 'game.innings': demoMatch.innings },
      executionMode: 'cpu-vs-cpu',
      gameStadiumId: demoMatch.stadium,
      homeLineupRevisionId: ids.homeLineup,
      requiredGameBuildSha256: DEMO_GAME_BUILD_SHA256,
      rulesetRevisionId: ids.rulesetRevision,
      statProfileRevisionId: ids.profileRevision,
    })
  }

  await seedHistoricalResult(connection.database, league.id, admin.personId, now)

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
    draftUrl: `http://127.0.0.1:3000/leagues/${DEMO_SLUG}/drafts/${seededDraftId}`,
    operationsUrl: `http://127.0.0.1:3000/leagues/${DEMO_SLUG}/operations`,
    resultsUrl: `http://127.0.0.1:3000/leagues/${DEMO_SLUG}/operations/results`,
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
  input: ReturnType<typeof demoTeamLineup>,
) {
  return TeamLineupRevisionSchema.parse({
    ...lineupFixture,
    basedOnLineupRevisionId: null,
    createdAt: new Date().toISOString(),
    leagueId,
    lineup: input.lineup,
    lineupRevisionId,
    lineupRevisionNumber: 1,
    publishedAt: new Date().toISOString(),
    rosterCharacterIds: input.rosterCharacterIds,
    rosterRevisionId,
    rosterRevisionNumber: 1,
    teamId,
  })
}

async function seedHistoricalResult(
  database: ReturnType<typeof createDatabase>['database'],
  leagueId: string,
  personId: string,
  now: Date,
) {
  let completedAt = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1_000)
  await database.transaction(async (transaction) => {
    await transaction.insert(matches).values({
      awayTeamId: ids.awayTeam,
      createdByPersonId: personId,
      id: ids.historicalMatch,
      leagueId,
      homeTeamId: ids.homeTeam,
      scheduledAt: completedAt,
      seasonId: ids.season,
      status: 'confirmed',
      venueId: ids.venue,
    }).onConflictDoNothing()
    await transaction.insert(matchAttempts).values({
      attemptNonce: 'starworks_demo_historical_attempt_01',
      attemptNumber: 1,
      awayLineupRevisionId: ids.awayLineup,
      awayRosterRevisionId: ids.awayRoster,
      completedAt,
      confirmedAt: completedAt,
      confirmationSource: 'system',
      correlationId: ids.historicalCorrelation,
      createdAt: completedAt,
      createdByPersonId: personId,
      dynamicRuleOverrides: {},
      gameStadiumId: 'mario-stadium',
      homeLineupRevisionId: ids.homeLineup,
      homeRosterRevisionId: ids.homeRoster,
      id: ids.historicalAttempt,
      leagueId,
      matchId: ids.historicalMatch,
      requiredGameBuildSha256: DEMO_GAME_BUILD_SHA256,
      rulesetRevisionId: ids.rulesetRevision,
      statProfileRevisionId: ids.profileRevision,
      status: 'confirmed',
    }).onConflictDoNothing()
    await transaction.insert(telemetryDerivations).values({
      boxScore: historicalBoxScore() as unknown as Record<string, unknown>,
      correctionCount: 0,
      createdAt: completedAt,
      derivationVersion: 1,
      eventCount: 42,
      id: ids.historicalDerivation,
      inputDigest: '2'.repeat(64),
      issues: [],
      leagueId,
      matchAttemptId: ids.historicalAttempt,
      matchId: ids.historicalMatch,
      sourceFirstSequence: 1,
      sourceLastSequence: 42,
      status: 'ready',
    }).onConflictDoNothing()
  })
}

function historicalBoxScore(): MatchBoxScore {
  return {
    characters: {
      mario: characterResult(ids.homeTeam, { hits: 3, homeRuns: 1, runs: 2, runsBattedIn: 3 }),
      luigi: characterResult(ids.homeTeam, { hits: 2, runs: 1, runsBattedIn: 1 }),
      wario: characterResult(ids.awayTeam, { hits: 2, homeRuns: 1, runs: 1, runsBattedIn: 2 }),
      waluigi: characterResult(ids.awayTeam, { hits: 1, runs: 1 }),
    },
    derivationVersion: 1,
    endedReason: 'completed',
    innings: 7,
    teams: {
      away: { errors: 1, hits: 6, lineScore: { '1': 1, '2': 0, '3': 0, '4': 1, '5': 0, '6': 0, '7': 0 }, runs: 2, teamId: ids.awayTeam },
      home: { errors: 0, hits: 9, lineScore: { '1': 0, '2': 2, '3': 0, '4': 1, '5': 0, '6': 2, '7': 0 }, runs: 5, teamId: ids.homeTeam },
    },
  }
}

function characterResult(
  teamId: string,
  values: { hits: number; homeRuns?: number; runs?: number; runsBattedIn?: number },
): CharacterBoxScore {
  let homeRuns = values.homeRuns ?? 0
  return {
    batting: {
      atBats: 4,
      doubles: 0,
      hitByPitch: 0,
      hits: values.hits,
      homeRuns,
      plateAppearances: 4,
      runsBattedIn: values.runsBattedIn ?? 0,
      sacrifices: 0,
      singles: values.hits - homeRuns,
      strikeouts: 0,
      totalBases: values.hits + homeRuns * 3,
      triples: 0,
      walks: 0,
    },
    fielding: { errors: 0 },
    pitching: { battersFaced: 0, hitsAllowed: 0, outsPitched: 0, runsAllowed: 0, strikeouts: 0, walks: 0 },
    positions: [],
    running: { runs: values.runs ?? 0 },
    teamId,
  }
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
