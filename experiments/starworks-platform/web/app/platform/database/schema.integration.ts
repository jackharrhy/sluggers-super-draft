import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'

import postgres from 'postgres'

let databaseUrl = process.env.STARWORKS_TEST_DATABASE_URL

test(
  'tenant-owned records cannot reference another league',
  { skip: databaseUrl ? false : 'STARWORKS_TEST_DATABASE_URL is not set' },
  async () => {
    let sql = postgres(databaseUrl!, { max: 1, onnotice: () => {} })
    let personId = randomUUID()
    let firstLeagueId = randomUUID()
    let secondLeagueId = randomUUID()
    let secondSeasonId = randomUUID()

    try {
      await sql.begin(async (transaction) => {
        await transaction`insert into people (id, display_name) values (${personId}, 'Tester')`
        await transaction`
          insert into leagues (id, slug, name, created_by_person_id)
          values
            (${firstLeagueId}, ${`first-${firstLeagueId}`}, 'First', ${personId}),
            (${secondLeagueId}, ${`second-${secondLeagueId}`}, 'Second', ${personId})
        `
        await transaction`
          insert into seasons (id, league_id, slug, name)
          values (${secondSeasonId}, ${secondLeagueId}, 'season-one', 'Season One')
        `

        await assert.rejects(
          transaction`
            insert into league_teams (league_id, season_id, slug, name)
            values (${firstLeagueId}, ${secondSeasonId}, 'wrong-league', 'Wrong League')
          `,
          (error: unknown) =>
            error instanceof postgres.PostgresError && error.code === '23503',
        )

        throw new RollbackFixture()
      })
    } catch (error) {
      if (!(error instanceof RollbackFixture)) {
        throw error
      }
    } finally {
      await sql.end()
    }
  },
)

test(
  'one person can belong to two isolated leagues',
  { skip: databaseUrl ? false : 'STARWORKS_TEST_DATABASE_URL is not set' },
  async () => {
    let sql = postgres(databaseUrl!, { max: 1, onnotice: () => {} })
    let personId = randomUUID()
    let firstLeagueId = randomUUID()
    let secondLeagueId = randomUUID()

    try {
      await sql.begin(async (transaction) => {
        await transaction`insert into people (id, display_name) values (${personId}, 'Shared Admin')`
        await transaction`
          insert into leagues (id, slug, name, created_by_person_id)
          values
            (${firstLeagueId}, ${`first-${firstLeagueId}`}, 'First', ${personId}),
            (${secondLeagueId}, ${`second-${secondLeagueId}`}, 'Second', ${personId})
        `
        await transaction`
          insert into league_memberships (league_id, person_id)
          values (${firstLeagueId}, ${personId}), (${secondLeagueId}, ${personId})
        `

        let rows = await transaction<{ league_id: string }[]>`
          select league_id from league_memberships where person_id = ${personId}
        `
        assert.deepEqual(
          new Set(rows.map((row) => row.league_id)),
          new Set([firstLeagueId, secondLeagueId]),
        )

        throw new RollbackFixture()
      })
    } catch (error) {
      if (!(error instanceof RollbackFixture)) {
        throw error
      }
    } finally {
      await sql.end()
    }
  },
)

test(
  'published configuration revisions are immutable in PostgreSQL',
  { skip: databaseUrl ? false : 'STARWORKS_TEST_DATABASE_URL is not set' },
  async () => {
    let sql = postgres(databaseUrl!, { max: 1, onnotice: () => {} })
    let personId = randomUUID()
    let leagueId = randomUUID()
    let profileId = randomUUID()
    let revisionId = randomUUID()

    try {
      await sql.begin(async (transaction) => {
        await transaction`insert into people (id, display_name) values (${personId}, 'Publisher')`
        await transaction`
          insert into leagues (id, slug, name, created_by_person_id)
          values (${leagueId}, ${`immutable-${leagueId}`}, 'Immutable League', ${personId})
        `
        await transaction`
          insert into stat_profiles (id, league_id, slug, name)
          values (${profileId}, ${leagueId}, 'competitive', 'Competitive')
        `
        await transaction`
          insert into stat_profile_revisions (
            id, league_id, profile_id, revision_number, name, definitions,
            character_values, created_by_person_id
          ) values (
            ${revisionId}, ${leagueId}, ${profileId}, 1, 'Revision One', '[]'::jsonb,
            '[]'::jsonb, ${personId}
          )
        `
        await transaction`
          update stat_profile_revisions
          set status = 'published', published_at = now()
          where id = ${revisionId}
        `

        await assert.rejects(
          transaction`
            update stat_profile_revisions
            set name = 'Mutated in place'
            where id = ${revisionId}
          `,
          (error: unknown) =>
            error instanceof postgres.PostgresError &&
            error.message.includes('published revisions are immutable'),
        )
        throw new RollbackFixture()
      })
    } catch (error) {
      if (!(error instanceof RollbackFixture)) throw error
    } finally {
      await sql.end()
    }
  },
)

class RollbackFixture extends Error {}
