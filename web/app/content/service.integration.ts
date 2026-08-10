import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'

import { createDatabase, type StarworksDatabase } from '../platform/database/connection.ts'
import {
  leagues,
  people,
  rulesetRevisions,
  rulesets,
  statProfileRevisions,
  statProfiles,
} from '../platform/database/schema.ts'
import { PlatformError } from '../platform/errors.ts'
import type { SessionIdentity } from '../platform/model.ts'
import type { ContentAssetStore } from './object-store.ts'
import { ContentService } from './service.ts'

let databaseUrl = process.env.STARWORKS_TEST_DATABASE_URL

test(
  'content packs store allowed sources in Garage and publish immutable hash-only manifests',
  { skip: databaseUrl ? false : 'STARWORKS_TEST_DATABASE_URL is not set' },
  async () => {
    let connection = createDatabase(databaseUrl!, { max: 1 })
    try {
      await assert.rejects(
        connection.database.transaction(async (transaction) => {
          let fixture = await createFixture(transaction as unknown as StarworksDatabase)
          let objects = new Map<string, Uint8Array>()
          let store: ContentAssetStore = {
            async ready() {},
            async put(key, bytes) { objects.set(key, bytes) },
          }
          let ids = [randomUUID(), randomUUID(), randomUUID()]
          let service = new ContentService(transaction as unknown as StarworksDatabase, store, {
            clock: () => new Date('2026-08-10T18:00:00Z'),
            createId: () => ids.shift()!,
          })
          let revisionId = await service.createDraft(fixture.identity, fixture.leagueId, {
            adapterVersion: '0.1.0',
            mainDolSha256: 'a'.repeat(64),
            name: 'Meteor Icons and Balance',
            rulesetRevisionId: fixture.rulesetRevisionId,
            slug: 'meteor-icons-balance',
            statCharacterIds: ['mario', 'mario'],
            statProfileRevisionId: fixture.statProfileRevisionId,
          })
          let sourceBytes = Uint8Array.from([
            0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
            ...new TextEncoder().encode('user-created-image-source'),
          ])
          let assetSha256 = await service.uploadAsset(fixture.identity, fixture.leagueId, {
            bytes: sourceBytes,
            displayName: 'Mario league icon.png',
            mediaType: 'image/png',
          })
          assert.equal(objects.size, 1)
          assert.deepEqual(
            objects.get(`leagues/${fixture.leagueId}/content-assets/${assetSha256}`),
            sourceBytes,
          )
          await service.assignAsset(fixture.identity, fixture.leagueId, revisionId, {
            assetSha256,
            characterId: 'mario',
            slot: 'icon',
          })
          let manifest = await service.publish(fixture.identity, fixture.leagueId, revisionId)

          assert.equal(manifest.assets[0]?.sha256, assetSha256)
          assert.equal(manifest.assignments.length, 2)
          assert.equal(JSON.stringify(manifest).includes('user-created-image-source'), false)
          assert.equal(JSON.stringify(manifest).includes('objectKey'), false)
          let dashboard = await service.dashboard(fixture.identity, fixture.leagueId)
          let published = dashboard.packs[0]!.revisions[0]!
          assert.match(published.manifestSha256!, /^[a-f0-9]{64}$/)
          assert.deepEqual(published.statCharacterIds, ['mario'])

          await assert.rejects(
            service.assignAsset(fixture.identity, fixture.leagueId, revisionId, {
              assetSha256,
              characterId: 'luigi',
              slot: 'icon',
            }),
            (error: unknown) => error instanceof PlatformError && error.code === 'not_found',
          )
          let clonedId = await service.clone(fixture.identity, fixture.leagueId, revisionId)
          let afterClone = await service.dashboard(fixture.identity, fixture.leagueId)
          let clone = afterClone.packs[0]!.revisions.find((revision) => revision.id === clonedId)!
          assert.equal(clone.status, 'draft')
          assert.equal(clone.basedOnRevisionId, revisionId)
          assert.equal(clone.assignments[0]?.assetSha256, assetSha256)

          await assert.rejects(
            service.uploadAsset(fixture.identity, fixture.leagueId, {
              bytes: sourceBytes,
              displayName: 'A disc buffer',
              mediaType: 'application/octet-stream',
            }),
            (error: unknown) => error instanceof PlatformError && error.code === 'invalid_input',
          )
          throw new RollbackFixture()
        }),
        (error: unknown) => error instanceof RollbackFixture,
      )
    } finally {
      await connection.close()
    }
  },
)

async function createFixture(database: StarworksDatabase): Promise<{
  identity: SessionIdentity
  leagueId: string
  rulesetRevisionId: string
  statProfileRevisionId: string
}> {
  let personId = randomUUID()
  let leagueId = randomUUID()
  let profileId = randomUUID()
  let statProfileRevisionId = randomUUID()
  let rulesetId = randomUUID()
  let rulesetRevisionId = randomUUID()
  await database.insert(people).values({ id: personId, displayName: 'Content Admin' })
  await database.insert(leagues).values({
    createdByPersonId: personId,
    id: leagueId,
    name: 'Content League',
    slug: `content-${leagueId}`,
  })
  await database.insert(statProfiles).values({ id: profileId, leagueId, name: 'Stats', slug: 'stats' })
  await database.insert(statProfileRevisions).values({
    characterValues: [],
    createdByPersonId: personId,
    definitions: [],
    id: statProfileRevisionId,
    leagueId,
    name: 'Published Stats',
    profileId,
    publishedAt: new Date(),
    revisionNumber: 1,
    status: 'published',
  })
  await database.insert(rulesets).values({ id: rulesetId, leagueId, name: 'Rules', slug: 'rules' })
  await database.insert(rulesetRevisions).values({
    createdByPersonId: personId,
    id: rulesetRevisionId,
    leagueId,
    name: 'Published Rules',
    publishedAt: new Date(),
    revisionNumber: 1,
    rulesetId,
    settings: [],
    status: 'published',
  })
  return {
    identity: {
      discordUserId: '100000000000000009',
      discordUsername: 'content-admin',
      displayName: 'Content Admin',
      isSiteAdmin: true,
      memberships: [],
      personId,
    },
    leagueId,
    rulesetRevisionId,
    statProfileRevisionId,
  }
}

class RollbackFixture extends Error {}
