import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'

import {
  RulesetRevisionSchema,
  StatProfileRevisionSchema,
  TeamLineupRevisionSchema,
} from '@starworks/contracts'

import rulesetFixture from '../../../contracts/fixtures/valid/ruleset-revision.json' with { type: 'json' }
import statProfileFixture from '../../../contracts/fixtures/valid/stat-profile-revision.json' with { type: 'json' }
import lineupFixture from '../../../contracts/fixtures/valid/team-lineup-revision.json' with { type: 'json' }
import { createDatabase, type StarworksDatabase } from '../platform/database/connection.ts'
import { leagueTeams, leagues, people, seasons } from '../platform/database/schema.ts'
import { PlatformError } from '../platform/errors.ts'
import type { SessionIdentity } from '../platform/model.ts'
import { ConfigurationService } from './service.ts'

let databaseUrl = process.env.STARWORKS_TEST_DATABASE_URL

test(
  'league configuration revisions publish, remain immutable, clone, and compile',
  { skip: databaseUrl ? false : 'STARWORKS_TEST_DATABASE_URL is not set' },
  async () => {
    let connection = createDatabase(databaseUrl!, { max: 1 })

    try {
      await assert.rejects(
        connection.database.transaction(async (transaction) => {
          let fixture = await createLeagueFixture(transaction as unknown as StarworksDatabase)
          let service = new ConfigurationService(transaction as unknown as StarworksDatabase, {
            clock: () => new Date('2026-08-10T12:00:00Z'),
          })
          let profileSource = StatProfileRevisionSchema.parse(statProfileFixture)
          let rulesetSource = RulesetRevisionSchema.parse(rulesetFixture)
          let lineupSource = TeamLineupRevisionSchema.parse(lineupFixture)

          let profileDraft = await service.createStatProfileDraft(fixture.identity, fixture.leagueId, {
            characterValues: profileSource.characterValues,
            definitions: profileSource.definitions,
            name: 'Competitive stats',
            slug: 'competitive-stats',
          })
          let updatedProfile = await service.updateStatProfileDraft(
            fixture.identity,
            fixture.leagueId,
            profileDraft.revisionId,
            { ...profileDraft, name: 'Competitive stats v1' },
          )
          assert.equal(updatedProfile.name, 'Competitive stats v1')
          let publishedProfile = await service.publishStatProfile(
            fixture.identity,
            fixture.leagueId,
            profileDraft.revisionId,
          )
          assert.equal(publishedProfile.status, 'published')
          await assert.rejects(
            service.updateStatProfileDraft(
              fixture.identity,
              fixture.leagueId,
              profileDraft.revisionId,
              { ...profileDraft, name: 'Illegal mutation' },
            ),
            isConflict,
          )
          let nextProfile = await service.cloneStatProfileRevision(
            fixture.identity,
            fixture.leagueId,
            profileDraft.revisionId,
          )
          assert.equal(nextProfile.revisionNumber, 2)
          assert.equal(nextProfile.basedOnRevisionId, profileDraft.revisionId)
          assert.equal(nextProfile.status, 'draft')

          let rulesetDraft = await service.createRulesetDraft(fixture.identity, fixture.leagueId, {
            name: 'League rules',
            settings: rulesetSource.settings,
            slug: 'league-rules',
          })
          let publishedRuleset = await service.publishRuleset(
            fixture.identity,
            fixture.leagueId,
            rulesetDraft.revisionId,
          )
          assert.equal(publishedRuleset.status, 'published')
          let nextRuleset = await service.cloneRulesetRevision(
            fixture.identity,
            fixture.leagueId,
            rulesetDraft.revisionId,
          )
          assert.equal(nextRuleset.revisionNumber, 2)
          assert.equal(nextRuleset.status, 'draft')

          let lineupDraft = await service.createTeamLineupDraft(
            fixture.identity,
            fixture.leagueId,
            fixture.teamId,
            {
              lineup: lineupSource.lineup,
              rosterCharacterIds: lineupSource.rosterCharacterIds,
            },
          )
          let publishedLineup = await service.publishTeamLineup(
            fixture.identity,
            fixture.leagueId,
            fixture.teamId,
            lineupDraft.lineupRevisionId,
          )
          assert.equal(publishedLineup.status, 'published')
          let nextLineup = await service.cloneTeamLineupRevision(
            fixture.identity,
            fixture.leagueId,
            fixture.teamId,
            lineupDraft.lineupRevisionId,
          )
          assert.equal(nextLineup.lineupRevisionNumber, 2)
          assert.equal(nextLineup.rosterRevisionNumber, 2)
          assert.equal(nextLineup.status, 'draft')

          let operationBundle = await service.compilePublishedConfiguration({
            adapterVersion: '0.1.0-test',
            identity: fixture.identity,
            leagueId: fixture.leagueId,
            lineupRevisionId: publishedLineup.lineupRevisionId,
            rulesetRevisionId: publishedRuleset.revisionId,
            statProfileRevisionId: publishedProfile.revisionId,
            teamId: fixture.teamId,
          })
          assert.ok(operationBundle.operations.length > 20)
          assert.equal(
            operationBundle.operations.some(
              (operation) =>
                operation.operation === 'set-game-rule' &&
                operation.ruleKey === 'draft.timer-seconds',
            ),
            false,
          )

          let override = await service.createMatchLineupOverride(
            fixture.identity,
            fixture.leagueId,
            fixture.teamId,
            {
              baseLineupRevisionId: publishedLineup.lineupRevisionId,
              effectiveLineup: publishedLineup.lineup,
              matchId: randomUUID(),
            },
          )
          assert.equal(override.baseLineupRevisionId, publishedLineup.lineupRevisionId)

          throw new RollbackFixture()
        }),
        (error: unknown) => error instanceof RollbackFixture,
      )
    } finally {
      await connection.close()
    }
  },
)

async function createLeagueFixture(database: StarworksDatabase): Promise<{
  identity: SessionIdentity
  leagueId: string
  teamId: string
}> {
  let personId = randomUUID()
  let leagueId = randomUUID()
  let seasonId = randomUUID()
  let teamId = randomUUID()
  await database.insert(people).values({ id: personId, displayName: 'Configuration Admin' })
  await database.insert(leagues).values({
    createdByPersonId: personId,
    id: leagueId,
    name: 'Configuration League',
    slug: `configuration-${leagueId}`,
  })
  await database.insert(seasons).values({
    id: seasonId,
    leagueId,
    name: 'Season One',
    slug: 'season-one',
  })
  await database.insert(leagueTeams).values({
    id: teamId,
    leagueId,
    name: 'Mario Fireballs',
    seasonId,
    slug: 'mario-fireballs',
  })
  return {
    identity: {
      discordUserId: '100000000000000001',
      discordUsername: 'configuration-admin',
      displayName: 'Configuration Admin',
      isSiteAdmin: true,
      memberships: [],
      personId,
    },
    leagueId,
    teamId,
  }
}

function isConflict(error: unknown): boolean {
  return error instanceof PlatformError && error.code === 'conflict'
}

class RollbackFixture extends Error {}
