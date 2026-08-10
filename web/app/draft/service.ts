import { randomUUID } from 'node:crypto'

import { and, asc, desc, eq, inArray, max } from 'drizzle-orm'
import { z } from 'zod'

import type { StarworksDatabase } from '../platform/database/connection.ts'
import {
  auditRecords,
  draftEvents,
  draftPicks,
  draftQueues,
  drafts,
  draftSlots,
  gameCharacterChemistry,
  gameCharacters,
  leagueTeams,
  rosterRevisions,
  seasons,
  statProfileRevisions,
} from '../platform/database/schema.ts'
import { PlatformError } from '../platform/errors.ts'
import type { SessionIdentity } from '../platform/model.ts'
import { administrativeRoles } from '../platform/repository.ts'

const CreateDraftSchema = z.object({
  gameId: z.string().trim().min(1).max(32).default('RMBE01'),
  name: z.string().trim().min(1).max(120),
  orderMode: z.enum(['snake', 'linear']),
  pickSeconds: z.number().int().min(15).max(86_400),
  rounds: z.number().int().min(1).max(18),
  seasonId: z.uuid(),
  slotTeamIds: z.array(z.uuid()).min(2).max(32),
  statProfileRevisionId: z.uuid(),
})

const PickSchema = z.object({
  characterId: z.string().trim().min(1).max(127),
  expectedVersion: z.number().int().nonnegative().optional(),
  reason: z.string().trim().min(1).max(500).optional(),
})

const QueueSchema = z.object({
  characterIds: z.array(z.string().trim().min(1).max(127)).max(101),
})

type DraftRow = typeof drafts.$inferSelect
type DraftPickRow = typeof draftPicks.$inferSelect
type DraftTransaction = Parameters<Parameters<StarworksDatabase['transaction']>[0]>[0]
type DraftSlotRow = {
  managerPersonId: string | null
  position: number
  teamId: string
  teamName: string
}

export interface DraftServiceOptions {
  clock?: () => Date
  createId?: () => string
}

export interface DraftSummary {
  id: string
  name: string
  status: DraftRow['status']
  seasonId: string
  seasonName: string
  currentPickNumber: number
  totalPicks: number
}

export interface DraftSetupOptions {
  drafts: DraftSummary[]
  seasons: Array<{ id: string; name: string; teams: Array<{ id: string; name: string }> }>
  statProfiles: Array<{ id: string; name: string; revisionNumber: number }>
}

export interface DraftCharacter {
  characterId: string
  chemistry: Array<{
    characterId: string
    displayName: string
    relationship: 'positive' | 'negative'
  }>
  displayName: string
  isCaptain: boolean
  values: Record<string, boolean | number | string | null>
}

export interface DraftRoom {
  characters: DraftCharacter[]
  draft: DraftRow & {
    deadline: Date | null
    totalPicks: number
  }
  events: Array<typeof draftEvents.$inferSelect>
  picks: Array<DraftPickRow & { characterName: string; teamName: string }>
  queue: string[]
  slots: Array<{
    managerPersonId: string | null
    position: number
    teamId: string
    teamName: string
  }>
  currentTeamId: string | null
}

export type DraftApplication = Pick<
  DraftService,
  | 'automaticPickAfterExpiry'
  | 'createDraft'
  | 'dashboard'
  | 'getDraftRoom'
  | 'makePick'
  | 'pauseDraft'
  | 'resumeDraft'
  | 'reverseLatestPick'
  | 'startDraft'
  | 'updateQueue'
>

export class DraftService {
  readonly #clock: () => Date
  readonly #createId: () => string

  constructor(
    readonly database: StarworksDatabase,
    options: DraftServiceOptions = {},
  ) {
    this.#clock = options.clock ?? (() => new Date())
    this.#createId = options.createId ?? randomUUID
  }

  async dashboard(
    identity: SessionIdentity | null,
    leagueId: string,
  ): Promise<DraftSetupOptions> {
    this.#requireDraftAccess(identity, leagueId)
    let [draftRows, slotRows, seasonRows, teamRows, profileRows] = await Promise.all([
      this.database
        .select()
        .from(drafts)
        .where(eq(drafts.leagueId, leagueId))
        .orderBy(desc(drafts.createdAt)),
      this.database
        .select({ draftId: draftSlots.draftId })
        .from(draftSlots)
        .where(eq(draftSlots.leagueId, leagueId)),
      this.database
        .select({ id: seasons.id, name: seasons.name })
        .from(seasons)
        .where(eq(seasons.leagueId, leagueId))
        .orderBy(desc(seasons.createdAt)),
      this.database
        .select({ id: leagueTeams.id, name: leagueTeams.name, seasonId: leagueTeams.seasonId })
        .from(leagueTeams)
        .where(eq(leagueTeams.leagueId, leagueId))
        .orderBy(asc(leagueTeams.name)),
      this.database
        .select({
          id: statProfileRevisions.id,
          name: statProfileRevisions.name,
          revisionNumber: statProfileRevisions.revisionNumber,
        })
        .from(statProfileRevisions)
        .where(and(
          eq(statProfileRevisions.leagueId, leagueId),
          eq(statProfileRevisions.status, 'published'),
        ))
        .orderBy(desc(statProfileRevisions.publishedAt)),
    ])

    return {
      drafts: draftRows.map((draft) => ({
        currentPickNumber: draft.currentPickNumber,
        id: draft.id,
        name: draft.name,
        seasonId: draft.seasonId,
        seasonName: seasonRows.find((season) => season.id === draft.seasonId)?.name ?? 'Unknown season',
        status: draft.status,
        totalPicks: draft.rounds * slotRows.filter((slot) => slot.draftId === draft.id).length,
      })),
      seasons: seasonRows.map((season) => ({
        ...season,
        teams: teamRows.filter((team) => team.seasonId === season.id).map(({ id, name }) => ({ id, name })),
      })),
      statProfiles: profileRows,
    }
  }

  async createDraft(
    identity: SessionIdentity | null,
    leagueId: string,
    input: z.input<typeof CreateDraftSchema>,
  ): Promise<{ id: string }> {
    this.#requireLeagueAdmin(identity, leagueId)
    let parsed = CreateDraftSchema.safeParse(input)
    if (!parsed.success) throw invalidInput(parsed.error.issues[0]?.message ?? 'Draft settings are invalid')
    if (new Set(parsed.data.slotTeamIds).size !== parsed.data.slotTeamIds.length) {
      throw invalidInput('A team can occupy only one draft slot')
    }

    let draftId = this.#createId()
    let now = this.#clock()
    await this.database.transaction(async (transaction) => {
      let [season] = await transaction
        .select({ id: seasons.id })
        .from(seasons)
        .where(and(eq(seasons.leagueId, leagueId), eq(seasons.id, parsed.data.seasonId)))
        .limit(1)
      if (!season) throw new PlatformError('Season was not found', 'not_found')

      let [profile] = await transaction
        .select({ characterValues: statProfileRevisions.characterValues })
        .from(statProfileRevisions)
        .where(and(
          eq(statProfileRevisions.leagueId, leagueId),
          eq(statProfileRevisions.id, parsed.data.statProfileRevisionId),
          eq(statProfileRevisions.status, 'published'),
        ))
        .limit(1)
      if (!profile) throw invalidInput('Drafts require a published stat-profile revision')

      let selectedTeams = await transaction
        .select({ id: leagueTeams.id })
        .from(leagueTeams)
        .where(and(
          eq(leagueTeams.leagueId, leagueId),
          eq(leagueTeams.seasonId, parsed.data.seasonId),
          inArray(leagueTeams.id, parsed.data.slotTeamIds),
        ))
      if (selectedTeams.length !== parsed.data.slotTeamIds.length) {
        throw invalidInput('Every draft slot must reference a team in the selected season')
      }
      let totalPicks = parsed.data.rounds * parsed.data.slotTeamIds.length
      if (profile.characterValues.length < totalPicks) {
        throw invalidInput(`The published stat profile has only ${profile.characterValues.length} eligible characters for ${totalPicks} picks`)
      }

      await transaction.insert(drafts).values({
        createdAt: now,
        createdByPersonId: identity!.personId,
        gameId: parsed.data.gameId,
        id: draftId,
        leagueId,
        name: parsed.data.name,
        orderMode: parsed.data.orderMode,
        pickSeconds: parsed.data.pickSeconds,
        rounds: parsed.data.rounds,
        seasonId: parsed.data.seasonId,
        statProfileRevisionId: parsed.data.statProfileRevisionId,
        updatedAt: now,
      })
      await transaction.insert(draftSlots).values(parsed.data.slotTeamIds.map((teamId, index) => ({
        createdAt: now,
        draftId,
        leagueId,
        position: index + 1,
        teamId,
      })))
      await this.#appendEvent(transaction, {
        actorPersonId: identity!.personId,
        draftId,
        eventType: 'created',
        leagueId,
        metadata: {
          orderMode: parsed.data.orderMode,
          pickSeconds: parsed.data.pickSeconds,
          rounds: parsed.data.rounds,
          slotTeamIds: parsed.data.slotTeamIds,
          statProfileRevisionId: parsed.data.statProfileRevisionId,
        },
        occurredAt: now,
      })
      await audit(transaction, identity!.personId, leagueId, 'draft.created', draftId)
    })
    return { id: draftId }
  }

  async getDraftRoom(
    identity: SessionIdentity | null,
    leagueId: string,
    draftId: string,
  ): Promise<DraftRoom> {
    this.#requireDraftAccess(identity, leagueId)
    let [draft] = await this.database
      .select()
      .from(drafts)
      .where(and(eq(drafts.leagueId, leagueId), eq(drafts.id, draftId)))
      .limit(1)
    if (!draft) throw new PlatformError('Draft was not found', 'not_found')

    let [slotRows, pickRows, eventRows, profileRows, catalogRows, chemistryRows] = await Promise.all([
      this.#loadSlots(this.database, leagueId, draftId),
      this.database
        .select()
        .from(draftPicks)
        .where(and(eq(draftPicks.leagueId, leagueId), eq(draftPicks.draftId, draftId)))
        .orderBy(asc(draftPicks.pickNumber), asc(draftPicks.selectedAt)),
      this.database
        .select()
        .from(draftEvents)
        .where(and(eq(draftEvents.leagueId, leagueId), eq(draftEvents.draftId, draftId)))
        .orderBy(asc(draftEvents.sequence)),
      this.database
        .select({ characterValues: statProfileRevisions.characterValues })
        .from(statProfileRevisions)
        .where(and(
          eq(statProfileRevisions.leagueId, leagueId),
          eq(statProfileRevisions.id, draft.statProfileRevisionId),
        )),
      this.database.select().from(gameCharacters).where(eq(gameCharacters.gameId, draft.gameId)),
      this.database
        .select()
        .from(gameCharacterChemistry)
        .where(eq(gameCharacterChemistry.gameId, draft.gameId)),
    ])
    let profile = profileRows[0]
    if (!profile) throw new PlatformError('Draft stat profile was not found', 'not_found')
    let catalog = new Map(catalogRows.map((character) => [character.characterId, character]))
    let names = new Map(profile.characterValues.map((character) => [
      character.characterId,
      catalog.get(character.characterId)?.displayName ?? character.characterId,
    ]))
    let activePicks = pickRows.filter((pick) => pick.status === 'active')
    let pickedCharacters = new Set(activePicks.map((pick) => pick.characterId))
    let managedTeam = slotRows.find((slot) => slot.managerPersonId === identity!.personId)
    let queueRows = managedTeam
      ? await this.database
          .select()
          .from(draftQueues)
          .where(and(
            eq(draftQueues.leagueId, leagueId),
            eq(draftQueues.draftId, draftId),
            eq(draftQueues.teamId, managedTeam.teamId),
          ))
          .orderBy(asc(draftQueues.rank))
      : []
    let characters = profile.characterValues.map((character) => ({
      characterId: character.characterId,
      chemistry: chemistryRows.flatMap((relationship) => {
        let otherId = relationship.characterAId === character.characterId
          ? relationship.characterBId
          : relationship.characterBId === character.characterId
            ? relationship.characterAId
            : null
        return otherId ? [{
          characterId: otherId,
          displayName: names.get(otherId) ?? otherId,
          relationship: relationship.relationship,
        }] : []
      }),
      displayName: names.get(character.characterId)!,
      isCaptain: catalog.get(character.characterId)?.isCaptain ?? false,
      values: character.values,
    }))

    return {
      characters: characters.filter((character) => !pickedCharacters.has(character.characterId)),
      currentTeamId: currentSlot(draft, slotRows)?.teamId ?? null,
      draft: {
        ...draft,
        deadline: draft.status === 'active' && draft.turnStartedAt
          ? new Date(draft.turnStartedAt.getTime() + draft.pickSeconds * 1_000)
          : null,
        totalPicks: draft.rounds * slotRows.length,
      },
      events: eventRows,
      picks: pickRows.map((pick) => ({
        ...pick,
        characterName: names.get(pick.characterId) ?? pick.characterId,
        teamName: slotRows.find((slot) => slot.teamId === pick.teamId)?.teamName ?? 'Unknown team',
      })),
      queue: queueRows.map((entry) => entry.characterId),
      slots: slotRows,
    }
  }

  async startDraft(
    identity: SessionIdentity | null,
    leagueId: string,
    draftId: string,
  ): Promise<void> {
    this.#requireLeagueAdmin(identity, leagueId)
    let now = this.#clock()
    await this.database.transaction(async (transaction) => {
      let draft = await this.#lockDraft(transaction, leagueId, draftId)
      if (draft.status !== 'setup') throw new PlatformError('Only a draft in setup can start', 'conflict')
      let slots = await this.#loadSlots(transaction, leagueId, draftId)
      if (slots.length < 2) throw invalidInput('A draft requires at least two teams')
      await transaction.update(drafts).set({
        startedAt: now,
        status: 'active',
        turnStartedAt: now,
        updatedAt: now,
        version: draft.version + 1,
      }).where(eq(drafts.id, draftId))
      await this.#appendEvent(transaction, {
        actorPersonId: identity!.personId,
        draftId,
        eventType: 'started',
        leagueId,
        occurredAt: now,
      })
      await audit(transaction, identity!.personId, leagueId, 'draft.started', draftId)
    })
  }

  async makePick(
    identity: SessionIdentity | null,
    leagueId: string,
    draftId: string,
    input: z.input<typeof PickSchema>,
  ): Promise<DraftPickRow> {
    if (!identity) throw new PlatformError('Sign in is required', 'unauthorized')
    let parsed = PickSchema.safeParse(input)
    if (!parsed.success) throw invalidInput(parsed.error.issues[0]?.message ?? 'Pick is invalid')
    return this.database.transaction(async (transaction) => {
      let draft = await this.#lockDraft(transaction, leagueId, draftId)
      let slots = await this.#loadSlots(transaction, leagueId, draftId)
      let slot = currentSlot(draft, slots)
      if (!slot) throw new PlatformError('Draft order is empty', 'conflict')
      let isAdmin = this.#isLeagueAdmin(identity, leagueId)
      if (!isAdmin && slot.managerPersonId !== identity.personId) {
        throw new PlatformError('It is not your team’s turn', 'forbidden')
      }
      return this.#recordPick(transaction, draft, slots, identity, {
        ...parsed.data,
        source: isAdmin && slot.managerPersonId !== identity.personId ? 'commissioner' : 'manager',
      })
    })
  }

  async automaticPickAfterExpiry(
    identity: SessionIdentity | null,
    leagueId: string,
    draftId: string,
  ): Promise<DraftPickRow> {
    this.#requireLeagueAdmin(identity, leagueId)
    return this.database.transaction(async (transaction) => {
      let draft = await this.#lockDraft(transaction, leagueId, draftId)
      let slots = await this.#loadSlots(transaction, leagueId, draftId)
      let slot = currentSlot(draft, slots)
      if (!slot) throw new PlatformError('Draft order is empty', 'conflict')
      let now = this.#clock()
      if (draft.status !== 'active' || !draft.turnStartedAt) {
        throw new PlatformError('The draft clock is not running', 'conflict')
      }
      let deadline = draft.turnStartedAt.getTime() + draft.pickSeconds * 1_000
      if (now.getTime() < deadline) throw new PlatformError('The current pick clock has not expired', 'conflict')

      let [profile] = await transaction
        .select({ characterValues: statProfileRevisions.characterValues })
        .from(statProfileRevisions)
        .where(and(
          eq(statProfileRevisions.leagueId, leagueId),
          eq(statProfileRevisions.id, draft.statProfileRevisionId),
        ))
        .limit(1)
      let picked = await transaction
        .select({ characterId: draftPicks.characterId })
        .from(draftPicks)
        .where(and(
          eq(draftPicks.leagueId, leagueId),
          eq(draftPicks.draftId, draftId),
          eq(draftPicks.status, 'active'),
        ))
      let unavailable = new Set(picked.map((pick) => pick.characterId))
      let queue = await transaction
        .select({ characterId: draftQueues.characterId })
        .from(draftQueues)
        .where(and(
          eq(draftQueues.leagueId, leagueId),
          eq(draftQueues.draftId, draftId),
          eq(draftQueues.teamId, slot.teamId),
        ))
        .orderBy(asc(draftQueues.rank))
      let characterId = queue.find((entry) => !unavailable.has(entry.characterId))?.characterId
        ?? profile?.characterValues.find((entry) => !unavailable.has(entry.characterId))?.characterId
      if (!characterId) throw new PlatformError('No eligible character remains', 'conflict')
      await this.#appendEvent(transaction, {
        actorPersonId: identity!.personId,
        draftId,
        eventType: 'clock-expired',
        leagueId,
        metadata: { characterId, pickNumber: draft.currentPickNumber },
        occurredAt: now,
        teamId: slot.teamId,
      })
      return this.#recordPick(transaction, draft, slots, identity!, {
        characterId,
        reason: 'Draft clock expired',
        source: 'automatic',
      })
    })
  }

  async pauseDraft(identity: SessionIdentity | null, leagueId: string, draftId: string): Promise<void> {
    this.#requireLeagueAdmin(identity, leagueId)
    let now = this.#clock()
    await this.database.transaction(async (transaction) => {
      let draft = await this.#lockDraft(transaction, leagueId, draftId)
      if (draft.status !== 'active') throw new PlatformError('Only an active draft can be paused', 'conflict')
      await transaction.update(drafts).set({
        pausedAt: now,
        status: 'paused',
        updatedAt: now,
        version: draft.version + 1,
      }).where(eq(drafts.id, draftId))
      await this.#appendEvent(transaction, { actorPersonId: identity!.personId, draftId, eventType: 'paused', leagueId, occurredAt: now })
      await audit(transaction, identity!.personId, leagueId, 'draft.paused', draftId)
    })
  }

  async resumeDraft(identity: SessionIdentity | null, leagueId: string, draftId: string): Promise<void> {
    this.#requireLeagueAdmin(identity, leagueId)
    let now = this.#clock()
    await this.database.transaction(async (transaction) => {
      let draft = await this.#lockDraft(transaction, leagueId, draftId)
      if (draft.status !== 'paused' || !draft.pausedAt) {
        throw new PlatformError('Only a paused draft can resume', 'conflict')
      }
      let pausedFor = now.getTime() - draft.pausedAt.getTime()
      let turnStartedAt = draft.turnStartedAt
        ? new Date(draft.turnStartedAt.getTime() + pausedFor)
        : now
      await transaction.update(drafts).set({
        pausedAt: null,
        status: 'active',
        turnStartedAt,
        updatedAt: now,
        version: draft.version + 1,
      }).where(eq(drafts.id, draftId))
      await this.#appendEvent(transaction, { actorPersonId: identity!.personId, draftId, eventType: 'resumed', leagueId, occurredAt: now })
      await audit(transaction, identity!.personId, leagueId, 'draft.resumed', draftId)
    })
  }

  async reverseLatestPick(
    identity: SessionIdentity | null,
    leagueId: string,
    draftId: string,
    reason: string,
  ): Promise<void> {
    this.#requireLeagueAdmin(identity, leagueId)
    let normalizedReason = z.string().trim().min(1).max(500).safeParse(reason)
    if (!normalizedReason.success) throw invalidInput('A reversal reason is required')
    let now = this.#clock()
    await this.database.transaction(async (transaction) => {
      let draft = await this.#lockDraft(transaction, leagueId, draftId)
      if (!['active', 'paused'].includes(draft.status)) {
        throw new PlatformError('Only an open draft can reverse a pick', 'conflict')
      }
      let [pick] = await transaction
        .select()
        .from(draftPicks)
        .where(and(
          eq(draftPicks.leagueId, leagueId),
          eq(draftPicks.draftId, draftId),
          eq(draftPicks.status, 'active'),
        ))
        .orderBy(desc(draftPicks.pickNumber))
        .limit(1)
      if (!pick) throw new PlatformError('No pick can be reversed', 'conflict')
      await transaction.update(draftPicks).set({
        reason: normalizedReason.data,
        reversedAt: now,
        status: 'reversed',
      }).where(eq(draftPicks.id, pick.id))
      await transaction.update(drafts).set({
        currentPickNumber: pick.pickNumber,
        pausedAt: now,
        status: 'paused',
        turnStartedAt: now,
        updatedAt: now,
        version: draft.version + 1,
      }).where(eq(drafts.id, draftId))
      await this.#appendEvent(transaction, {
        actorPersonId: identity!.personId,
        draftId,
        eventType: 'pick-reversed',
        leagueId,
        metadata: { characterId: pick.characterId, reason: normalizedReason.data },
        occurredAt: now,
        pickId: pick.id,
        teamId: pick.teamId,
      })
      await audit(transaction, identity!.personId, leagueId, 'draft.pick.reversed', pick.id)
    })
  }

  async updateQueue(
    identity: SessionIdentity | null,
    leagueId: string,
    draftId: string,
    teamId: string,
    input: z.input<typeof QueueSchema>,
  ): Promise<void> {
    if (!identity) throw new PlatformError('Sign in is required', 'unauthorized')
    let parsed = QueueSchema.safeParse(input)
    if (!parsed.success) throw invalidInput(parsed.error.issues[0]?.message ?? 'Queue is invalid')
    if (new Set(parsed.data.characterIds).size !== parsed.data.characterIds.length) {
      throw invalidInput('A draft queue cannot contain duplicate characters')
    }
    await this.database.transaction(async (transaction) => {
      let draft = await this.#lockDraft(transaction, leagueId, draftId)
      if (['completed', 'cancelled'].includes(draft.status)) {
        throw new PlatformError('A closed draft queue cannot be changed', 'conflict')
      }
      let [team] = await transaction
        .select({ managerPersonId: leagueTeams.managerPersonId })
        .from(leagueTeams)
        .innerJoin(draftSlots, and(
          eq(draftSlots.leagueId, leagueTeams.leagueId),
          eq(draftSlots.teamId, leagueTeams.id),
          eq(draftSlots.draftId, draftId),
        ))
        .where(and(eq(leagueTeams.leagueId, leagueId), eq(leagueTeams.id, teamId)))
        .limit(1)
      if (!team) throw new PlatformError('Draft team was not found', 'not_found')
      if (!this.#isLeagueAdmin(identity, leagueId) && team.managerPersonId !== identity.personId) {
        throw new PlatformError('Team manager access is required', 'forbidden')
      }
      let [profile] = await transaction
        .select({ characterValues: statProfileRevisions.characterValues })
        .from(statProfileRevisions)
        .where(eq(statProfileRevisions.id, draft.statProfileRevisionId))
        .limit(1)
      let eligible = new Set(profile?.characterValues.map((character) => character.characterId))
      if (parsed.data.characterIds.some((characterId) => !eligible.has(characterId))) {
        throw invalidInput('Draft queue contains a character outside the selected stat profile')
      }
      await transaction.delete(draftQueues).where(and(
        eq(draftQueues.leagueId, leagueId),
        eq(draftQueues.draftId, draftId),
        eq(draftQueues.teamId, teamId),
      ))
      if (parsed.data.characterIds.length) {
        let now = this.#clock()
        await transaction.insert(draftQueues).values(parsed.data.characterIds.map((characterId, index) => ({
          characterId,
          createdAt: now,
          draftId,
          leagueId,
          rank: index + 1,
          teamId,
          updatedAt: now,
          updatedByPersonId: identity.personId,
        })))
      }
    })
  }

  async #recordPick(
    transaction: DraftTransaction,
    draft: DraftRow,
    slots: DraftSlotRow[],
    identity: SessionIdentity,
    input: {
      characterId: string
      expectedVersion?: number
      reason?: string
      source: 'manager' | 'commissioner' | 'automatic'
    },
  ): Promise<DraftPickRow> {
    if (draft.status !== 'active') throw new PlatformError('The draft is not active', 'conflict')
    if (input.expectedVersion !== undefined && input.expectedVersion !== draft.version) {
      throw new PlatformError('Draft state changed; refresh before picking', 'conflict')
    }
    let slot = currentSlot(draft, slots)
    if (!slot) throw new PlatformError('Draft order is empty', 'conflict')
    let [profile] = await transaction
      .select({ characterValues: statProfileRevisions.characterValues })
      .from(statProfileRevisions)
      .where(and(
        eq(statProfileRevisions.leagueId, draft.leagueId),
        eq(statProfileRevisions.id, draft.statProfileRevisionId),
        eq(statProfileRevisions.status, 'published'),
      ))
      .limit(1)
    if (!profile?.characterValues.some((character) => character.characterId === input.characterId)) {
      throw invalidInput('Character is not eligible for this draft')
    }
    let now = this.#clock()
    let pickId = this.#createId()
    let pickNumber = draft.currentPickNumber
    let roundNumber = Math.floor((pickNumber - 1) / slots.length) + 1
    let [pick] = await transaction.insert(draftPicks).values({
      characterId: input.characterId,
      draftId: draft.id,
      id: pickId,
      leagueId: draft.leagueId,
      pickedByPersonId: identity.personId,
      pickNumber,
      reason: input.reason,
      roundNumber,
      selectedAt: now,
      slotPosition: slot.position,
      source: input.source,
      teamId: slot.teamId,
    }).returning()
    if (!pick) throw new Error('Draft pick insert returned no row')
    await transaction.delete(draftQueues).where(and(
      eq(draftQueues.leagueId, draft.leagueId),
      eq(draftQueues.draftId, draft.id),
      eq(draftQueues.characterId, input.characterId),
    ))
    await this.#appendEvent(transaction, {
      actorPersonId: identity.personId,
      draftId: draft.id,
      eventType: 'pick-made',
      leagueId: draft.leagueId,
      metadata: { characterId: input.characterId, pickNumber, source: input.source },
      occurredAt: now,
      pickId,
      teamId: slot.teamId,
    })

    let totalPicks = draft.rounds * slots.length
    if (pickNumber === totalPicks) {
      await this.#publishDraftRosters(transaction, draft, slots, identity.personId, now)
      await transaction.update(drafts).set({
        completedAt: now,
        currentPickNumber: pickNumber + 1,
        pausedAt: null,
        status: 'completed',
        turnStartedAt: null,
        updatedAt: now,
        version: draft.version + 1,
      }).where(eq(drafts.id, draft.id))
      await this.#appendEvent(transaction, {
        actorPersonId: identity.personId,
        draftId: draft.id,
        eventType: 'completed',
        leagueId: draft.leagueId,
        metadata: { totalPicks },
        occurredAt: now,
      })
      await audit(transaction, identity.personId, draft.leagueId, 'draft.completed', draft.id)
    } else {
      await transaction.update(drafts).set({
        currentPickNumber: pickNumber + 1,
        turnStartedAt: now,
        updatedAt: now,
        version: draft.version + 1,
      }).where(eq(drafts.id, draft.id))
    }
    return pick
  }

  async #publishDraftRosters(
    transaction: DraftTransaction,
    draft: DraftRow,
    slots: DraftSlotRow[],
    actorPersonId: string,
    now: Date,
  ): Promise<void> {
    for (let slot of slots) {
      let picks = await transaction
        .select({ characterId: draftPicks.characterId })
        .from(draftPicks)
        .where(and(
          eq(draftPicks.leagueId, draft.leagueId),
          eq(draftPicks.draftId, draft.id),
          eq(draftPicks.teamId, slot.teamId),
          eq(draftPicks.status, 'active'),
        ))
        .orderBy(asc(draftPicks.pickNumber))
      let [latest] = await transaction
        .select({ id: rosterRevisions.id, revisionNumber: rosterRevisions.revisionNumber })
        .from(rosterRevisions)
        .where(and(
          eq(rosterRevisions.leagueId, draft.leagueId),
          eq(rosterRevisions.teamId, slot.teamId),
        ))
        .orderBy(desc(rosterRevisions.revisionNumber))
        .limit(1)
      await transaction.insert(rosterRevisions).values({
        basedOnRevisionId: latest?.id ?? null,
        createdAt: now,
        createdByPersonId: actorPersonId,
        id: this.#createId(),
        leagueId: draft.leagueId,
        publishedAt: now,
        revisionNumber: (latest?.revisionNumber ?? 0) + 1,
        rosterCharacterIds: picks.map((pick) => pick.characterId),
        status: 'published',
        teamId: slot.teamId,
      })
    }
  }

  async #lockDraft(
    transaction: DraftTransaction,
    leagueId: string,
    draftId: string,
  ): Promise<DraftRow> {
    let [draft] = await transaction
      .select()
      .from(drafts)
      .where(and(eq(drafts.leagueId, leagueId), eq(drafts.id, draftId)))
      .for('update')
      .limit(1)
    if (!draft) throw new PlatformError('Draft was not found', 'not_found')
    return draft
  }

  async #loadSlots(
    database: StarworksDatabase | DraftTransaction,
    leagueId: string,
    draftId: string,
  ) {
    return database
      .select({
        managerPersonId: leagueTeams.managerPersonId,
        position: draftSlots.position,
        teamId: draftSlots.teamId,
        teamName: leagueTeams.name,
      })
      .from(draftSlots)
      .innerJoin(leagueTeams, and(
        eq(leagueTeams.leagueId, draftSlots.leagueId),
        eq(leagueTeams.id, draftSlots.teamId),
      ))
      .where(and(eq(draftSlots.leagueId, leagueId), eq(draftSlots.draftId, draftId)))
      .orderBy(asc(draftSlots.position))
  }

  async #appendEvent(
    transaction: DraftTransaction,
    event: {
      actorPersonId: string
      draftId: string
      eventType: typeof draftEvents.$inferInsert.eventType
      leagueId: string
      metadata?: Record<string, unknown>
      occurredAt: Date
      pickId?: string
      teamId?: string
    },
  ): Promise<void> {
    let [latest] = await transaction
      .select({ value: max(draftEvents.sequence) })
      .from(draftEvents)
      .where(and(eq(draftEvents.leagueId, event.leagueId), eq(draftEvents.draftId, event.draftId)))
    await transaction.insert(draftEvents).values({
      ...event,
      sequence: (latest?.value ?? 0) + 1,
    })
  }

  #requireDraftAccess(identity: SessionIdentity | null, leagueId: string): asserts identity is SessionIdentity {
    if (!identity) throw new PlatformError('Sign in is required', 'unauthorized')
    if (!identity.isSiteAdmin && !identity.memberships.some((membership) => membership.leagueId === leagueId)) {
      throw new PlatformError('League membership is required', 'forbidden')
    }
  }

  #requireLeagueAdmin(identity: SessionIdentity | null, leagueId: string): asserts identity is SessionIdentity {
    if (!identity) throw new PlatformError('Sign in is required', 'unauthorized')
    if (!this.#isLeagueAdmin(identity, leagueId)) {
      throw new PlatformError('League administrator access is required', 'forbidden')
    }
  }

  #isLeagueAdmin(identity: SessionIdentity, leagueId: string): boolean {
    let membership = identity.memberships.find((candidate) => candidate.leagueId === leagueId)
    return identity.isSiteAdmin || Boolean(membership?.roles.some((role) => administrativeRoles.has(role)))
  }
}

export function currentSlot<T extends { position: number; teamId: string }>(
  draft: Pick<DraftRow, 'currentPickNumber' | 'orderMode' | 'rounds'>,
  slots: T[],
): T | null {
  if (!slots.length) return null
  let totalPicks = draft.rounds * slots.length
  if (draft.currentPickNumber < 1 || draft.currentPickNumber > totalPicks) return null
  let roundIndex = Math.floor((draft.currentPickNumber - 1) / slots.length)
  let positionInRound = (draft.currentPickNumber - 1) % slots.length
  let slotIndex = draft.orderMode === 'snake' && roundIndex % 2 === 1
    ? slots.length - positionInRound - 1
    : positionInRound
  return slots[slotIndex] ?? null
}

function invalidInput(message: string): PlatformError {
  return new PlatformError(message, 'invalid_input')
}

async function audit(
  transaction: DraftTransaction,
  actorPersonId: string,
  leagueId: string,
  action: string,
  targetId: string,
): Promise<void> {
  await transaction.insert(auditRecords).values({
    action,
    actorPersonId,
    leagueId,
    targetId,
    targetType: 'draft',
  })
}
