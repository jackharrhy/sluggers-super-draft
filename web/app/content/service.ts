import { createHash, randomUUID } from 'node:crypto'

import { ContentPackManifestSchema, type ContentPackManifest } from '@starworks/contracts'
import { and, asc, desc, eq, max } from 'drizzle-orm'
import { z } from 'zod'

import type { StarworksDatabase } from '../platform/database/connection.ts'
import {
  auditRecords,
  contentAssets,
  contentPackAssetAssignments,
  contentPackRevisions,
  contentPacks,
  rulesetRevisions,
  statProfileRevisions,
} from '../platform/database/schema.ts'
import { PlatformError } from '../platform/errors.ts'
import type { SessionIdentity } from '../platform/model.ts'
import { administrativeRoles } from '../platform/repository.ts'
import type { ContentAssetStore } from './object-store.ts'

const CreateDraftSchema = z.strictObject({
  adapterVersion: z.string().regex(/^\d+\.\d+\.\d+$/),
  mainDolSha256: z.string().regex(/^[a-f0-9]{64}$/),
  name: z.string().trim().min(1).max(120),
  rulesetRevisionId: z.uuid(),
  slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(80),
  statCharacterIds: z.array(z.string().min(1).max(127)).max(128),
  statProfileRevisionId: z.uuid(),
})

const AssetAssignmentSchema = z.strictObject({
  assetSha256: z.string().regex(/^[a-f0-9]{64}$/),
  characterId: z.string().min(1).max(127),
  slot: z.enum(['icon', 'portrait']),
})

const ALLOWED_MEDIA_TYPES = new Set(['image/png', 'image/webp'])
const MAX_ASSET_BYTES = 2 * 1024 * 1024
type ContentTransaction = Parameters<Parameters<StarworksDatabase['transaction']>[0]>[0]

export interface ContentDashboard {
  assets: Array<{
    sha256: string
    mediaType: string
    sizeBytes: number
    displayName: string
    createdAt: Date
  }>
  packs: Array<{
    id: string
    name: string
    slug: string
    revisions: ContentRevisionSummary[]
  }>
  publishedRulesets: Array<{ id: string; name: string; revisionNumber: number }>
  publishedStatProfiles: Array<{ id: string; name: string; revisionNumber: number }>
}

export interface ContentRevisionSummary {
  id: string
  revisionNumber: number
  status: 'draft' | 'published'
  adapterVersion: string
  mainDolSha256: string
  statCharacterIds: string[]
  statProfileRevisionId: string
  rulesetRevisionId: string
  manifestSha256: string | null
  basedOnRevisionId: string | null
  createdAt: Date
  publishedAt: Date | null
  assignments: Array<{
    assetSha256: string
    characterId: string
    slot: string
  }>
}

export interface ContentApplication {
  dashboard(identity: SessionIdentity | null, leagueId: string): Promise<ContentDashboard>
  createDraft(identity: SessionIdentity | null, leagueId: string, input: unknown): Promise<string>
  uploadAsset(
    identity: SessionIdentity | null,
    leagueId: string,
    input: { bytes: Uint8Array; displayName: string; mediaType: string },
  ): Promise<string>
  assignAsset(
    identity: SessionIdentity | null,
    leagueId: string,
    revisionId: string,
    input: unknown,
  ): Promise<void>
  publish(
    identity: SessionIdentity | null,
    leagueId: string,
    revisionId: string,
  ): Promise<ContentPackManifest>
  clone(
    identity: SessionIdentity | null,
    leagueId: string,
    revisionId: string,
  ): Promise<string>
}

export class ContentService implements ContentApplication {
  readonly #clock: () => Date
  readonly #createId: () => string

  constructor(
    readonly database: StarworksDatabase,
    readonly assets: ContentAssetStore,
    options: { clock?: () => Date; createId?: () => string } = {},
  ) {
    this.#clock = options.clock ?? (() => new Date())
    this.#createId = options.createId ?? randomUUID
  }

  async dashboard(identity: SessionIdentity | null, leagueId: string): Promise<ContentDashboard> {
    this.#requireAdmin(identity, leagueId)
    let [packRows, revisionRows, assignmentRows, assetRows, profileRows, rulesetRows] =
      await Promise.all([
        this.database.select().from(contentPacks).where(eq(contentPacks.leagueId, leagueId)).orderBy(asc(contentPacks.name)),
        this.database.select().from(contentPackRevisions).where(eq(contentPackRevisions.leagueId, leagueId)).orderBy(desc(contentPackRevisions.revisionNumber)),
        this.database.select().from(contentPackAssetAssignments).where(eq(contentPackAssetAssignments.leagueId, leagueId)),
        this.database.select().from(contentAssets).where(eq(contentAssets.leagueId, leagueId)).orderBy(desc(contentAssets.createdAt)),
        this.database.select({ id: statProfileRevisions.id, name: statProfileRevisions.name, revisionNumber: statProfileRevisions.revisionNumber }).from(statProfileRevisions).where(and(eq(statProfileRevisions.leagueId, leagueId), eq(statProfileRevisions.status, 'published'))).orderBy(asc(statProfileRevisions.name)),
        this.database.select({ id: rulesetRevisions.id, name: rulesetRevisions.name, revisionNumber: rulesetRevisions.revisionNumber }).from(rulesetRevisions).where(and(eq(rulesetRevisions.leagueId, leagueId), eq(rulesetRevisions.status, 'published'))).orderBy(asc(rulesetRevisions.name)),
      ])
    return {
      assets: assetRows.map((asset) => ({
        createdAt: asset.createdAt,
        displayName: asset.displayName,
        mediaType: asset.mediaType,
        sha256: asset.sha256,
        sizeBytes: asset.sizeBytes,
      })),
      packs: packRows.map((pack) => ({
        id: pack.id,
        name: pack.name,
        slug: pack.slug,
        revisions: revisionRows.filter((revision) => revision.contentPackId === pack.id).map((revision) => ({
          adapterVersion: revision.adapterVersion,
          assignments: assignmentRows.filter((assignment) => assignment.contentPackRevisionId === revision.id).map((assignment) => ({
            assetSha256: assignment.assetSha256,
            characterId: assignment.characterId,
            slot: assignment.slot,
          })),
          basedOnRevisionId: revision.basedOnRevisionId,
          createdAt: revision.createdAt,
          id: revision.id,
          mainDolSha256: revision.mainDolSha256,
          manifestSha256: revision.manifestSha256,
          publishedAt: revision.publishedAt,
          revisionNumber: revision.revisionNumber,
          rulesetRevisionId: revision.rulesetRevisionId,
          statCharacterIds: revision.statCharacterIds,
          statProfileRevisionId: revision.statProfileRevisionId,
          status: revision.status,
        })),
      })),
      publishedRulesets: rulesetRows,
      publishedStatProfiles: profileRows,
    }
  }

  async createDraft(
    identity: SessionIdentity | null,
    leagueId: string,
    input: unknown,
  ): Promise<string> {
    this.#requireAdmin(identity, leagueId)
    let parsed = CreateDraftSchema.safeParse(input)
    if (!parsed.success) throw new PlatformError('Content-pack draft is invalid', 'invalid_input')
    let statCharacterIds = [...new Set(parsed.data.statCharacterIds)].sort()
    await this.#requirePublishedDependencies(
      leagueId,
      parsed.data.statProfileRevisionId,
      parsed.data.rulesetRevisionId,
    )
    let packId = this.#createId()
    let revisionId = this.#createId()
    let now = this.#clock()
    await this.database.transaction(async (transaction) => {
      await transaction.insert(contentPacks).values({
        createdAt: now,
        createdByPersonId: identity!.personId,
        id: packId,
        leagueId,
        name: parsed.data.name,
        slug: parsed.data.slug,
        updatedAt: now,
      })
      await transaction.insert(contentPackRevisions).values({
        adapterVersion: parsed.data.adapterVersion,
        contentPackId: packId,
        createdAt: now,
        createdByPersonId: identity!.personId,
        id: revisionId,
        leagueId,
        mainDolSha256: parsed.data.mainDolSha256,
        revisionNumber: 1,
        rulesetRevisionId: parsed.data.rulesetRevisionId,
        statCharacterIds,
        statProfileRevisionId: parsed.data.statProfileRevisionId,
      })
      await writeAudit(transaction, identity!.personId, leagueId, 'content_pack.draft.created', revisionId)
    })
    return revisionId
  }

  async uploadAsset(
    identity: SessionIdentity | null,
    leagueId: string,
    input: { bytes: Uint8Array; displayName: string; mediaType: string },
  ): Promise<string> {
    this.#requireAdmin(identity, leagueId)
    let displayName = input.displayName.trim()
    if (!displayName || displayName.length > 255) {
      throw new PlatformError('Asset name must contain 1 to 255 characters', 'invalid_input')
    }
    if (!ALLOWED_MEDIA_TYPES.has(input.mediaType)) {
      throw new PlatformError('Only PNG and WebP source images are accepted', 'invalid_input')
    }
    if (!input.bytes.byteLength || input.bytes.byteLength > MAX_ASSET_BYTES) {
      throw new PlatformError('Content assets must contain at most 2 MiB', 'invalid_input')
    }
    if (!matchesMediaSignature(input.bytes, input.mediaType)) {
      throw new PlatformError('Source image bytes do not match the declared media type', 'invalid_input')
    }
    let sha256 = createHash('sha256').update(input.bytes).digest('hex')
    let objectKey = `leagues/${leagueId}/content-assets/${sha256}`
    await this.assets.put(objectKey, input.bytes, input.mediaType, sha256)
    await this.database.insert(contentAssets).values({
      createdAt: this.#clock(),
      displayName,
      leagueId,
      mediaType: input.mediaType,
      objectKey,
      sha256,
      sizeBytes: input.bytes.byteLength,
      uploadedByPersonId: identity!.personId,
    }).onConflictDoNothing()
    let [stored] = await this.database.select().from(contentAssets).where(and(
      eq(contentAssets.leagueId, leagueId),
      eq(contentAssets.sha256, sha256),
    )).limit(1)
    if (!stored || stored.sizeBytes !== input.bytes.byteLength || stored.mediaType !== input.mediaType) {
      throw new PlatformError('Stored content asset metadata conflicts with this upload', 'conflict')
    }
    await this.database.insert(auditRecords).values({
      action: 'content_asset.uploaded',
      actorPersonId: identity!.personId,
      leagueId,
      metadata: { displayName, mediaType: input.mediaType, sizeBytes: input.bytes.byteLength },
      targetId: sha256,
      targetType: 'content_asset',
    })
    return sha256
  }

  async assignAsset(
    identity: SessionIdentity | null,
    leagueId: string,
    revisionId: string,
    input: unknown,
  ): Promise<void> {
    this.#requireAdmin(identity, leagueId)
    let parsed = AssetAssignmentSchema.safeParse(input)
    if (!parsed.success) throw new PlatformError('Asset assignment is invalid', 'invalid_input')
    let revision = await this.#draft(leagueId, revisionId)
    if (!revision) throw new PlatformError('Content-pack draft was not found', 'not_found')
    let [asset] = await this.database.select({ sha256: contentAssets.sha256 }).from(contentAssets).where(and(
      eq(contentAssets.leagueId, leagueId),
      eq(contentAssets.sha256, parsed.data.assetSha256),
    )).limit(1)
    if (!asset) throw new PlatformError('Content asset was not found', 'not_found')
    await this.database.transaction(async (transaction) => {
      await transaction.insert(contentPackAssetAssignments).values({
        assetSha256: asset.sha256,
        characterId: parsed.data.characterId,
        contentPackRevisionId: revision.id,
        createdAt: this.#clock(),
        leagueId,
        slot: parsed.data.slot,
      }).onConflictDoUpdate({
        target: [
          contentPackAssetAssignments.leagueId,
          contentPackAssetAssignments.contentPackRevisionId,
          contentPackAssetAssignments.characterId,
          contentPackAssetAssignments.slot,
        ],
        set: { assetSha256: asset.sha256 },
      })
      await writeAudit(transaction, identity!.personId, leagueId, 'content_pack.asset.assigned', revisionId, parsed.data)
    })
  }

  async publish(
    identity: SessionIdentity | null,
    leagueId: string,
    revisionId: string,
  ): Promise<ContentPackManifest> {
    this.#requireAdmin(identity, leagueId)
    let [revision] = await this.database.select({
      revision: contentPackRevisions,
      pack: contentPacks,
    }).from(contentPackRevisions).innerJoin(contentPacks, and(
      eq(contentPacks.leagueId, contentPackRevisions.leagueId),
      eq(contentPacks.id, contentPackRevisions.contentPackId),
    )).where(and(
      eq(contentPackRevisions.leagueId, leagueId),
      eq(contentPackRevisions.id, revisionId),
      eq(contentPackRevisions.status, 'draft'),
    )).limit(1)
    if (!revision) throw new PlatformError('Content-pack draft was not found', 'not_found')
    await this.#requirePublishedDependencies(
      leagueId,
      revision.revision.statProfileRevisionId,
      revision.revision.rulesetRevisionId,
    )
    let assignmentRows = await this.database.select({
      assignment: contentPackAssetAssignments,
      asset: contentAssets,
    }).from(contentPackAssetAssignments).innerJoin(contentAssets, and(
      eq(contentAssets.leagueId, contentPackAssetAssignments.leagueId),
      eq(contentAssets.sha256, contentPackAssetAssignments.assetSha256),
    )).where(and(
      eq(contentPackAssetAssignments.leagueId, leagueId),
      eq(contentPackAssetAssignments.contentPackRevisionId, revisionId),
    ))
    let manifestAssets = [...new Map(assignmentRows.map(({ asset }) => [asset.sha256, asset])).values()]
    let manifest = ContentPackManifestSchema.parse({
      adapterVersion: revision.revision.adapterVersion,
      assets: manifestAssets.map((asset) => ({
        displayName: asset.displayName,
        mediaType: asset.mediaType,
        sha256: asset.sha256,
        sizeBytes: asset.sizeBytes,
      })),
      assignments: [
        ...revision.revision.statCharacterIds.map((characterId) => ({
          assignmentType: 'character-stats' as const,
          characterId,
          statProfileRevisionId: revision.revision.statProfileRevisionId,
        })),
        ...assignmentRows.map(({ assignment }) => ({
          assignmentType: 'character-asset' as const,
          assetSha256: assignment.assetSha256,
          characterId: assignment.characterId,
          slot: assignment.slot,
        })),
      ],
      contentPackId: revision.pack.id,
      createdAt: revision.revision.createdAt.toISOString(),
      kind: 'content-pack-manifest',
      revisionId,
      rulesetRevisionId: revision.revision.rulesetRevisionId,
      schemaVersion: 1,
      statProfileRevisionId: revision.revision.statProfileRevisionId,
      targetGame: {
        gameId: 'RMBE01',
        supportedRevisions: [{
          mainDolSha256: revision.revision.mainDolSha256,
          region: 'NTSC-U',
          revision: 0,
        }],
      },
    })
    let manifestSha256 = canonicalSha256(manifest)
    let now = this.#clock()
    await this.database.transaction(async (transaction) => {
      let updated = await transaction.update(contentPackRevisions).set({
        manifest,
        manifestSha256,
        publishedAt: now,
        status: 'published',
      }).where(and(
        eq(contentPackRevisions.leagueId, leagueId),
        eq(contentPackRevisions.id, revisionId),
        eq(contentPackRevisions.status, 'draft'),
      )).returning({ id: contentPackRevisions.id })
      if (!updated.length) throw new PlatformError('Content-pack revision is already published', 'conflict')
      await writeAudit(transaction, identity!.personId, leagueId, 'content_pack.published', revisionId, { manifestSha256 })
    })
    return manifest
  }

  async clone(
    identity: SessionIdentity | null,
    leagueId: string,
    revisionId: string,
  ): Promise<string> {
    this.#requireAdmin(identity, leagueId)
    let [source] = await this.database.select().from(contentPackRevisions).where(and(
      eq(contentPackRevisions.leagueId, leagueId),
      eq(contentPackRevisions.id, revisionId),
      eq(contentPackRevisions.status, 'published'),
    )).limit(1)
    if (!source) throw new PlatformError('Published content-pack revision was not found', 'not_found')
    let [latest] = await this.database.select({ value: max(contentPackRevisions.revisionNumber) }).from(contentPackRevisions).where(and(
      eq(contentPackRevisions.leagueId, leagueId),
      eq(contentPackRevisions.contentPackId, source.contentPackId),
    ))
    let assignments = await this.database.select().from(contentPackAssetAssignments).where(and(
      eq(contentPackAssetAssignments.leagueId, leagueId),
      eq(contentPackAssetAssignments.contentPackRevisionId, revisionId),
    ))
    let id = this.#createId()
    let now = this.#clock()
    await this.database.transaction(async (transaction) => {
      await transaction.insert(contentPackRevisions).values({
        adapterVersion: source.adapterVersion,
        basedOnRevisionId: source.id,
        contentPackId: source.contentPackId,
        createdAt: now,
        createdByPersonId: identity!.personId,
        id,
        leagueId,
        mainDolSha256: source.mainDolSha256,
        revisionNumber: (latest?.value ?? source.revisionNumber) + 1,
        rulesetRevisionId: source.rulesetRevisionId,
        statCharacterIds: source.statCharacterIds,
        statProfileRevisionId: source.statProfileRevisionId,
      })
      if (assignments.length) {
        await transaction.insert(contentPackAssetAssignments).values(assignments.map((assignment) => ({
          assetSha256: assignment.assetSha256,
          characterId: assignment.characterId,
          contentPackRevisionId: id,
          createdAt: now,
          leagueId,
          slot: assignment.slot,
        })))
      }
      await writeAudit(transaction, identity!.personId, leagueId, 'content_pack.revision.cloned', id, { basedOnRevisionId: source.id })
    })
    return id
  }

  async #draft(leagueId: string, revisionId: string) {
    let [revision] = await this.database.select().from(contentPackRevisions).where(and(
      eq(contentPackRevisions.leagueId, leagueId),
      eq(contentPackRevisions.id, revisionId),
      eq(contentPackRevisions.status, 'draft'),
    )).limit(1)
    return revision
  }

  async #requirePublishedDependencies(
    leagueId: string,
    statProfileRevisionId: string,
    rulesetRevisionId: string,
  ): Promise<void> {
    let [[profile], [ruleset]] = await Promise.all([
      this.database.select({ id: statProfileRevisions.id }).from(statProfileRevisions).where(and(
        eq(statProfileRevisions.leagueId, leagueId),
        eq(statProfileRevisions.id, statProfileRevisionId),
        eq(statProfileRevisions.status, 'published'),
      )).limit(1),
      this.database.select({ id: rulesetRevisions.id }).from(rulesetRevisions).where(and(
        eq(rulesetRevisions.leagueId, leagueId),
        eq(rulesetRevisions.id, rulesetRevisionId),
        eq(rulesetRevisions.status, 'published'),
      )).limit(1),
    ])
    if (!profile || !ruleset) {
      throw new PlatformError('Content packs require published stat and ruleset revisions', 'invalid_input')
    }
  }

  #requireAdmin(identity: SessionIdentity | null, leagueId: string): void {
    if (!identity) throw new PlatformError('Sign in required', 'unauthorized')
    if (identity.isSiteAdmin) return
    let membership = identity.memberships.find((candidate) => candidate.leagueId === leagueId)
    if (!membership || !membership.roles.some((role) => administrativeRoles.has(role))) {
      throw new PlatformError('League administrator access is required', 'forbidden')
    }
  }
}

function canonicalSha256(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(sortJson(value))).digest('hex')
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, child]) => [key, sortJson(child)]))
  }
  return value
}

function matchesMediaSignature(bytes: Uint8Array, mediaType: string): boolean {
  if (mediaType === 'image/png') {
    let signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
    return signature.every((value, index) => bytes[index] === value)
  }
  if (mediaType === 'image/webp') {
    return new TextDecoder('ascii').decode(bytes.slice(0, 4)) === 'RIFF'
      && new TextDecoder('ascii').decode(bytes.slice(8, 12)) === 'WEBP'
  }
  return false
}

async function writeAudit(
  transaction: ContentTransaction,
  actorPersonId: string,
  leagueId: string,
  action: string,
  targetId: string,
  metadata: Record<string, unknown> = {},
): Promise<void> {
  await transaction.insert(auditRecords).values({
    action,
    actorPersonId,
    leagueId,
    metadata,
    targetId,
    targetType: 'content_pack_revision',
  })
}
