import { createHash } from 'node:crypto'

import { and, eq, inArray, isNull } from 'drizzle-orm'

import type { StarworksDatabase } from '../platform/database/connection.ts'
import {
  auditRecords,
  conferences,
  discordIdentities,
  importReferences,
  leagueMembershipRoles,
  leagueMemberships,
  leagueTeams,
  leagues,
  people,
  seasons,
  venues,
} from '../platform/database/schema.ts'
import {
  LegacySuperDraftSnapshotSchema,
  type LegacySuperDraftSnapshot,
} from './legacy-super-draft-snapshot.ts'

const SOURCE = 'sluggers-super-draft'
type SourceEntityType = 'conference' | 'season' | 'team' | 'user' | 'venue'
type ImportActionKind = 'create' | 'reuse' | 'skip'

export interface LegacyImportAction {
  action: ImportActionKind
  sourceEntityId: string
  sourceEntityType: SourceEntityType
  targetEntityId?: string
}

export interface LegacyImportResult {
  applied: boolean
  counts: Record<ImportActionKind, number>
  actions: LegacyImportAction[]
}

interface ExistingReference {
  sourceContentHash: string
  sourceEntityId: string
  sourceEntityType: string
  targetEntityId: string
}

type StarworksTransaction = Parameters<Parameters<StarworksDatabase['transaction']>[0]>[0]

export class LegacySuperDraftImporter {
  constructor(readonly database: StarworksDatabase) {}

  async import(input: {
    actorPersonId: string
    apply: boolean
    leagueId: string
    snapshot: LegacySuperDraftSnapshot
  }): Promise<LegacyImportResult> {
    let snapshot = LegacySuperDraftSnapshotSchema.parse(input.snapshot)
    await this.#assertTarget(input.actorPersonId, input.leagueId)
    let references = await this.#loadReferences(input.leagueId)
    let discordIds = snapshot.users.map((user) => user.discordSnowflake)
    let existingDiscord = discordIds.length
      ? await this.database
          .select({
            discordUserId: discordIdentities.discordUserId,
            personId: discordIdentities.personId,
          })
          .from(discordIdentities)
          .where(inArray(discordIdentities.discordUserId, discordIds))
      : []
    let peopleByDiscordId = new Map(
      existingDiscord.map((identity) => [identity.discordUserId, identity.personId]),
    )
    let actions = planActions(snapshot, references, peopleByDiscordId)
    let result = { applied: false, actions, counts: countActions(actions) }
    if (!input.apply) return result

    await this.database.transaction(async (transaction) => {
      let seasonId = await resolveEntity({
        create: async () => {
          let [season] = await transaction
            .insert(seasons)
            .values({
              leagueId: input.leagueId,
              name: `Legacy Season ${snapshot.season.sourceId}`,
              slug: `legacy-season-${snapshot.season.sourceId}`,
              status: mapSeasonStatus(snapshot.season.state),
            })
            .returning({ id: seasons.id })
          return requiredId(season?.id, 'season')
        },
        entity: snapshot.season,
        leagueId: input.leagueId,
        reference: references.get(referenceKey('season', snapshot.season.sourceId)),
        sourceEntityId: snapshot.season.sourceId,
        sourceEntityType: 'season',
        transaction,
      })

      let personIds = new Map<string, string>()
      for (let user of snapshot.users) {
        let existingPersonId = peopleByDiscordId.get(user.discordSnowflake)
        let personId = await resolveEntity({
          create: async () => {
            if (existingPersonId) return existingPersonId
            let [person] = await transaction
              .insert(people)
              .values({ displayName: user.name })
              .returning({ id: people.id })
            let personId = requiredId(person?.id, 'person')
            await transaction.insert(discordIdentities).values({
              discordUserId: user.discordSnowflake,
              personId,
              username: user.name,
            })
            return personId
          },
          entity: user,
          leagueId: input.leagueId,
          reference: references.get(referenceKey('user', user.sourceId)),
          sourceEntityId: user.sourceId,
          sourceEntityType: 'user',
          transaction,
        })
        personIds.set(user.sourceId, personId)
        await transaction
          .insert(leagueMemberships)
          .values({ leagueId: input.leagueId, personId })
          .onConflictDoNothing()
        await transaction
          .insert(leagueMembershipRoles)
          .values({
            grantedByPersonId: input.actorPersonId,
            leagueId: input.leagueId,
            personId,
            role: user.role === 'admin' ? 'administrator' : 'manager',
          })
          .onConflictDoNothing()
      }

      let conferenceIds = new Map<string, string>()
      for (let conference of snapshot.conferences) {
        if (conference.seasonSourceId !== snapshot.season.sourceId) {
          throw new Error(`Conference ${conference.sourceId} references another legacy season`)
        }
        let conferenceId = await resolveEntity({
          create: async () => {
            let [created] = await transaction
              .insert(conferences)
              .values({
                leagueId: input.leagueId,
                name: conference.name,
                color: conference.color,
                seasonId,
                slug: sourceSlug(conference.name, conference.sourceId),
              })
              .returning({ id: conferences.id })
            return requiredId(created?.id, 'conference')
          },
          entity: conference,
          leagueId: input.leagueId,
          reference: references.get(referenceKey('conference', conference.sourceId)),
          sourceEntityId: conference.sourceId,
          sourceEntityType: 'conference',
          transaction,
        })
        conferenceIds.set(conference.sourceId, conferenceId)
      }

      for (let venue of snapshot.venues) {
        await resolveEntity({
          create: async () => {
            let [created] = await transaction
              .insert(venues)
              .values({
                leagueId: input.leagueId,
                name: venue.name,
                slug: sourceSlug(venue.name, venue.sourceId),
              })
              .returning({ id: venues.id })
            return requiredId(created?.id, 'venue')
          },
          entity: venue,
          leagueId: input.leagueId,
          reference: references.get(referenceKey('venue', venue.sourceId)),
          sourceEntityId: venue.sourceId,
          sourceEntityType: 'venue',
          transaction,
        })
      }

      for (let team of snapshot.teams) {
        let managerPersonId = personIds.get(team.managerUserSourceId)
        if (!managerPersonId) throw new Error(`Team ${team.sourceId} has no imported manager`)
        let conferenceId = team.conferenceSourceId
          ? conferenceIds.get(team.conferenceSourceId)
          : undefined
        if (team.conferenceSourceId && !conferenceId) {
          throw new Error(`Team ${team.sourceId} has no imported conference`)
        }
        await resolveEntity({
          create: async () => {
            let [created] = await transaction
              .insert(leagueTeams)
              .values({
                abbreviation: team.abbreviation,
                color: team.color,
                conferenceId,
                leagueId: input.leagueId,
                managerPersonId,
                name: team.name,
                seasonId,
                slug: sourceSlug(team.name, team.sourceId),
              })
              .returning({ id: leagueTeams.id })
            return requiredId(created?.id, 'team')
          },
          entity: team,
          leagueId: input.leagueId,
          reference: references.get(referenceKey('team', team.sourceId)),
          sourceEntityId: team.sourceId,
          sourceEntityType: 'team',
          transaction,
        })
      }

      await transaction.insert(auditRecords).values({
        action: 'legacy_import.applied',
        actorPersonId: input.actorPersonId,
        leagueId: input.leagueId,
        metadata: { counts: result.counts, format: snapshot.format, source: SOURCE },
        targetId: input.leagueId,
        targetType: 'league',
      })
    })

    return { ...result, applied: true }
  }

  async #assertTarget(actorPersonId: string, leagueId: string): Promise<void> {
    let targets = await this.database
      .select({
        id: leagues.id,
        isSiteAdmin: people.isSiteAdmin,
        role: leagueMembershipRoles.role,
      })
      .from(leagues)
      .innerJoin(people, eq(people.id, actorPersonId))
      .leftJoin(
        leagueMembershipRoles,
        and(
          eq(leagueMembershipRoles.leagueId, leagues.id),
          eq(leagueMembershipRoles.personId, actorPersonId),
        ),
      )
      .where(
        and(
          eq(leagues.id, leagueId),
          isNull(people.disabledAt),
        ),
      )
    if (!targets.length) throw new Error('Import actor or target league does not exist')
    let authorized = targets.some(
      (target) =>
        target.isSiteAdmin ||
        target.role === 'owner' ||
        target.role === 'administrator' ||
        target.role === 'commissioner',
    )
    if (!authorized) throw new Error('Import actor cannot access the target league')
  }

  async #loadReferences(leagueId: string): Promise<Map<string, ExistingReference>> {
    let rows = await this.database
      .select({
        sourceContentHash: importReferences.sourceContentHash,
        sourceEntityId: importReferences.sourceEntityId,
        sourceEntityType: importReferences.sourceEntityType,
        targetEntityId: importReferences.targetEntityId,
      })
      .from(importReferences)
      .where(and(eq(importReferences.leagueId, leagueId), eq(importReferences.source, SOURCE)))
    return new Map(rows.map((row) => [referenceKey(row.sourceEntityType, row.sourceEntityId), row]))
  }
}

function planActions(
  snapshot: LegacySuperDraftSnapshot,
  references: Map<string, ExistingReference>,
  peopleByDiscordId: Map<string, string>,
): LegacyImportAction[] {
  let entities: Array<{
    entity: object
    sourceEntityId: string
    sourceEntityType: SourceEntityType
    reuseTargetId?: string
  }> = [
    { entity: snapshot.season, sourceEntityId: snapshot.season.sourceId, sourceEntityType: 'season' },
    ...snapshot.users.map((entity) => ({
      entity,
      reuseTargetId: peopleByDiscordId.get(entity.discordSnowflake),
      sourceEntityId: entity.sourceId,
      sourceEntityType: 'user' as const,
    })),
    ...snapshot.conferences.map((entity) => ({ entity, sourceEntityId: entity.sourceId, sourceEntityType: 'conference' as const })),
    ...snapshot.venues.map((entity) => ({ entity, sourceEntityId: entity.sourceId, sourceEntityType: 'venue' as const })),
    ...snapshot.teams.map((entity) => ({ entity, sourceEntityId: entity.sourceId, sourceEntityType: 'team' as const })),
  ]
  return entities.map((item) => {
    let reference = references.get(referenceKey(item.sourceEntityType, item.sourceEntityId))
    if (reference) {
      let hash = contentHash(item.entity)
      if (reference.sourceContentHash !== hash) {
        throw new Error(
          `Legacy ${item.sourceEntityType} ${item.sourceEntityId} changed after import; explicit reconciliation is required`,
        )
      }
      return {
        action: 'skip',
        sourceEntityId: item.sourceEntityId,
        sourceEntityType: item.sourceEntityType,
        targetEntityId: reference.targetEntityId,
      }
    }
    return {
      action: item.reuseTargetId ? 'reuse' : 'create',
      sourceEntityId: item.sourceEntityId,
      sourceEntityType: item.sourceEntityType,
      targetEntityId: item.reuseTargetId,
    }
  })
}

async function resolveEntity(input: {
  create(): Promise<string>
  entity: object
  leagueId: string
  reference?: ExistingReference
  sourceEntityId: string
  sourceEntityType: SourceEntityType
  transaction: StarworksTransaction
}): Promise<string> {
  if (input.reference) return input.reference.targetEntityId
  let targetEntityId = await input.create()
  await input.transaction.insert(importReferences).values({
    leagueId: input.leagueId,
    source: SOURCE,
    sourceContentHash: contentHash(input.entity),
    sourceEntityId: input.sourceEntityId,
    sourceEntityType: input.sourceEntityType,
    targetEntityId,
    targetEntityType: targetType(input.sourceEntityType),
  })
  return targetEntityId
}

function targetType(sourceType: SourceEntityType): string {
  return sourceType === 'user' ? 'person' : sourceType
}

function referenceKey(type: string, id: string): string {
  return `${type}:${id}`
}

function contentHash(value: object): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex')
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
      .join(',')}}`
  }
  let encoded = JSON.stringify(value)
  if (encoded === undefined) throw new Error('Import source contains an unsupported value')
  return encoded
}

function sourceSlug(name: string, sourceId: string): string {
  let base = name
    .normalize('NFKD')
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, '-')
    .replaceAll(/^-|-$/g, '')
  return `${base || 'legacy'}-${sourceId}`
}

function mapSeasonStatus(state: LegacySuperDraftSnapshot['season']['state']) {
  if (state === 'playing') return 'active' as const
  if (state === 'finished') return 'complete' as const
  return 'draft' as const
}

function requiredId(value: string | undefined, type: string): string {
  if (!value) throw new Error(`Failed to create imported ${type}`)
  return value
}

function countActions(actions: LegacyImportAction[]): Record<ImportActionKind, number> {
  return actions.reduce(
    (counts, action) => ({ ...counts, [action.action]: counts[action.action] + 1 }),
    { create: 0, reuse: 0, skip: 0 },
  )
}
