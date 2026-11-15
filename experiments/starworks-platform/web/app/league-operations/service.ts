import { randomUUID } from 'node:crypto'

import { and, asc, desc, eq, inArray } from 'drizzle-orm'
import { z } from 'zod'

import type { StarworksDatabase } from '../platform/database/connection.ts'
import {
  auditRecords,
  leagueDeadlines,
  leagueTeams,
  rosterRevisions,
  rosterTransactions,
  seasons,
  tradeApprovals,
  tradeItems,
  tradeProposals,
} from '../platform/database/schema.ts'
import { PlatformError } from '../platform/errors.ts'
import type { SessionIdentity } from '../platform/model.ts'
import { administrativeRoles } from '../platform/repository.ts'

const DeadlineSchema = z.strictObject({
  closesAt: z.date(),
  kind: z.enum(['trade', 'roster', 'lineup']),
  note: z.string().trim().max(500).nullable(),
  seasonId: z.uuid(),
})

const ProposeTradeSchema = z.strictObject({
  counterpartyCharacterIds: z.array(z.string().trim().min(1).max(127)).min(1).max(18),
  counterpartyTeamId: z.uuid(),
  message: z.string().trim().max(1_000).nullable(),
  proposerCharacterIds: z.array(z.string().trim().min(1).max(127)).min(1).max(18),
  proposerTeamId: z.uuid(),
  seasonId: z.uuid(),
})

const ReviewTradeSchema = z.strictObject({
  decision: z.enum(['approved', 'rejected']),
  reason: z.string().trim().max(500).nullable(),
})

type OperationsTransaction = Parameters<Parameters<StarworksDatabase['transaction']>[0]>[0]
type RosterRow = typeof rosterRevisions.$inferSelect

export interface LeagueOperationsServiceOptions {
  clock?: () => Date
  createId?: () => string
}

export interface LeagueOperationsDashboard {
  deadlines: Array<typeof leagueDeadlines.$inferSelect & { seasonName: string }>
  seasons: Array<{
    id: string
    name: string
    teams: Array<{
      id: string
      managerPersonId: string | null
      name: string
      roster: { characterIds: string[]; revisionId: string; revisionNumber: number } | null
    }>
  }>
  trades: Array<{
    approvals: Array<typeof tradeApprovals.$inferSelect>
    counterpartyTeamId: string
    counterpartyTeamName: string
    id: string
    items: Array<typeof tradeItems.$inferSelect>
    message: string | null
    proposedAt: Date
    proposedByPersonId: string
    proposerTeamId: string
    proposerTeamName: string
    status: typeof tradeProposals.$inferSelect.status
  }>
}

export type LeagueOperationsApplication = Pick<
  LeagueOperationsService,
  'cancelTrade' | 'dashboard' | 'proposeTrade' | 'reviewTrade' | 'setDeadline'
>

export class LeagueOperationsService {
  readonly #clock: () => Date
  readonly #createId: () => string

  constructor(
    readonly database: StarworksDatabase,
    options: LeagueOperationsServiceOptions = {},
  ) {
    this.#clock = options.clock ?? (() => new Date())
    this.#createId = options.createId ?? randomUUID
  }

  async dashboard(
    identity: SessionIdentity | null,
    leagueId: string,
  ): Promise<LeagueOperationsDashboard> {
    this.#requireLeagueAccess(identity, leagueId)
    let [seasonRows, teamRows, rosterRows, deadlineRows, proposalRows, itemRows, approvalRows] = await Promise.all([
      this.database.select().from(seasons).where(eq(seasons.leagueId, leagueId)).orderBy(desc(seasons.createdAt)),
      this.database.select().from(leagueTeams).where(eq(leagueTeams.leagueId, leagueId)).orderBy(asc(leagueTeams.name)),
      this.database.select().from(rosterRevisions).where(and(eq(rosterRevisions.leagueId, leagueId), eq(rosterRevisions.status, 'published'))).orderBy(desc(rosterRevisions.revisionNumber)),
      this.database.select().from(leagueDeadlines).where(eq(leagueDeadlines.leagueId, leagueId)).orderBy(asc(leagueDeadlines.closesAt)),
      this.database.select().from(tradeProposals).where(eq(tradeProposals.leagueId, leagueId)).orderBy(desc(tradeProposals.proposedAt)),
      this.database.select().from(tradeItems).where(eq(tradeItems.leagueId, leagueId)),
      this.database.select().from(tradeApprovals).where(eq(tradeApprovals.leagueId, leagueId)),
    ])
    let teamNames = new Map(teamRows.map((team) => [team.id, team.name]))
    return {
      deadlines: deadlineRows.map((deadline) => ({
        ...deadline,
        seasonName: seasonRows.find((season) => season.id === deadline.seasonId)?.name ?? 'Unknown season',
      })),
      seasons: seasonRows.map((season) => ({
        id: season.id,
        name: season.name,
        teams: teamRows.filter((team) => team.seasonId === season.id).map((team) => {
          let roster = rosterRows.find((candidate) => candidate.teamId === team.id)
          return {
            id: team.id,
            managerPersonId: team.managerPersonId,
            name: team.name,
            roster: roster ? {
              characterIds: roster.rosterCharacterIds,
              revisionId: roster.id,
              revisionNumber: roster.revisionNumber,
            } : null,
          }
        }),
      })),
      trades: proposalRows.map((proposal) => ({
        approvals: approvalRows.filter((approval) => approval.proposalId === proposal.id),
        counterpartyTeamId: proposal.counterpartyTeamId,
        counterpartyTeamName: teamNames.get(proposal.counterpartyTeamId) ?? 'Unknown team',
        id: proposal.id,
        items: itemRows.filter((item) => item.proposalId === proposal.id),
        message: proposal.message,
        proposedAt: proposal.proposedAt,
        proposedByPersonId: proposal.proposedByPersonId,
        proposerTeamId: proposal.proposerTeamId,
        proposerTeamName: teamNames.get(proposal.proposerTeamId) ?? 'Unknown team',
        status: proposal.status,
      })),
    }
  }

  async setDeadline(
    identity: SessionIdentity | null,
    leagueId: string,
    input: z.input<typeof DeadlineSchema>,
  ): Promise<void> {
    this.#requireLeagueAdmin(identity, leagueId)
    let parsed = DeadlineSchema.safeParse(input)
    if (!parsed.success) throw invalidInput('Deadline settings are invalid')
    let [season] = await this.database
      .select({ id: seasons.id })
      .from(seasons)
      .where(and(eq(seasons.leagueId, leagueId), eq(seasons.id, parsed.data.seasonId)))
      .limit(1)
    if (!season) throw new PlatformError('Season was not found', 'not_found')
    let now = this.#clock()
    await this.database.transaction(async (transaction) => {
      await transaction.insert(leagueDeadlines).values({
        closesAt: parsed.data.closesAt,
        createdAt: now,
        createdByPersonId: identity!.personId,
        id: this.#createId(),
        kind: parsed.data.kind,
        leagueId,
        note: parsed.data.note,
        seasonId: parsed.data.seasonId,
        updatedAt: now,
      }).onConflictDoUpdate({
        set: {
          closesAt: parsed.data.closesAt,
          createdByPersonId: identity!.personId,
          note: parsed.data.note,
          updatedAt: now,
        },
        target: [leagueDeadlines.leagueId, leagueDeadlines.seasonId, leagueDeadlines.kind],
      })
      await audit(transaction, identity!.personId, leagueId, 'deadline.updated', parsed.data.seasonId, {
        closesAt: parsed.data.closesAt.toISOString(),
        kind: parsed.data.kind,
      })
    })
  }

  async proposeTrade(
    identity: SessionIdentity | null,
    leagueId: string,
    input: z.input<typeof ProposeTradeSchema>,
  ): Promise<{ id: string }> {
    if (!identity) throw new PlatformError('Sign in is required', 'unauthorized')
    let parsed = ProposeTradeSchema.safeParse(input)
    if (!parsed.success) throw invalidInput('Trade proposal is invalid')
    if (parsed.data.proposerTeamId === parsed.data.counterpartyTeamId) {
      throw invalidInput('A trade requires two different teams')
    }
    let allCharacters = [...parsed.data.proposerCharacterIds, ...parsed.data.counterpartyCharacterIds]
    if (new Set(allCharacters).size !== allCharacters.length) {
      throw invalidInput('A character can appear only once in a trade')
    }
    let proposalId = this.#createId()
    let now = this.#clock()
    await this.database.transaction(async (transaction) => {
      await this.#assertDeadlineOpen(transaction, leagueId, parsed.data.seasonId, 'trade', now)
      let teams = await this.#lockTeams(transaction, leagueId, [
        parsed.data.proposerTeamId,
        parsed.data.counterpartyTeamId,
      ])
      if (teams.length !== 2 || teams.some((team) => team.seasonId !== parsed.data.seasonId)) {
        throw invalidInput('Both trade teams must belong to the selected season')
      }
      let proposer = teams.find((team) => team.id === parsed.data.proposerTeamId)!
      if (!this.#isLeagueAdmin(identity, leagueId) && proposer.managerPersonId !== identity.personId) {
        throw new PlatformError('Only the proposing team manager can offer this trade', 'forbidden')
      }
      let rosters = await this.#loadLatestPublishedRosters(
        transaction,
        leagueId,
        [parsed.data.proposerTeamId, parsed.data.counterpartyTeamId],
      )
      this.#validateTradeCharacters(parsed.data.proposerCharacterIds, rosters.get(parsed.data.proposerTeamId), 'proposing')
      this.#validateTradeCharacters(parsed.data.counterpartyCharacterIds, rosters.get(parsed.data.counterpartyTeamId), 'counterparty')

      await transaction.insert(tradeProposals).values({
        createdAt: now,
        id: proposalId,
        leagueId,
        message: parsed.data.message,
        proposedAt: now,
        proposedByPersonId: identity.personId,
        proposerTeamId: parsed.data.proposerTeamId,
        counterpartyTeamId: parsed.data.counterpartyTeamId,
        seasonId: parsed.data.seasonId,
        updatedAt: now,
      })
      await transaction.insert(tradeItems).values([
        ...parsed.data.proposerCharacterIds.map((characterId) => ({
          characterId,
          fromTeamId: parsed.data.proposerTeamId,
          leagueId,
          proposalId,
          toTeamId: parsed.data.counterpartyTeamId,
        })),
        ...parsed.data.counterpartyCharacterIds.map((characterId) => ({
          characterId,
          fromTeamId: parsed.data.counterpartyTeamId,
          leagueId,
          proposalId,
          toTeamId: parsed.data.proposerTeamId,
        })),
      ])
      await transaction.insert(tradeApprovals).values({
        decidedAt: now,
        decidedByPersonId: identity.personId,
        decision: 'approved',
        leagueId,
        proposalId,
        reason: 'Approval recorded with proposal',
        teamId: parsed.data.proposerTeamId,
      })
      await audit(transaction, identity.personId, leagueId, 'trade.proposed', proposalId)
    })
    return { id: proposalId }
  }

  async reviewTrade(
    identity: SessionIdentity | null,
    leagueId: string,
    proposalId: string,
    input: z.input<typeof ReviewTradeSchema>,
  ): Promise<void> {
    if (!identity) throw new PlatformError('Sign in is required', 'unauthorized')
    let parsed = ReviewTradeSchema.safeParse(input)
    if (!parsed.success) throw invalidInput('Trade decision is invalid')
    let now = this.#clock()
    await this.database.transaction(async (transaction) => {
      let proposal = await this.#lockProposal(transaction, leagueId, proposalId)
      if (proposal.status !== 'pending') throw new PlatformError('Trade proposal is already closed', 'conflict')
      let teams = await this.#lockTeams(transaction, leagueId, [
        proposal.proposerTeamId,
        proposal.counterpartyTeamId,
      ])
      let counterparty = teams.find((team) => team.id === proposal.counterpartyTeamId)
      if (!counterparty) throw new PlatformError('Trade counterparty was not found', 'not_found')
      if (!this.#isLeagueAdmin(identity, leagueId) && counterparty.managerPersonId !== identity.personId) {
        throw new PlatformError('Only the counterparty manager can review this trade', 'forbidden')
      }
      await transaction.insert(tradeApprovals).values({
        decidedAt: now,
        decidedByPersonId: identity.personId,
        decision: parsed.data.decision,
        leagueId,
        proposalId,
        reason: parsed.data.reason,
        teamId: proposal.counterpartyTeamId,
      })
      if (parsed.data.decision === 'rejected') {
        await transaction.update(tradeProposals).set({
          rejectedAt: now,
          status: 'rejected',
          updatedAt: now,
        }).where(eq(tradeProposals.id, proposalId))
        await audit(transaction, identity.personId, leagueId, 'trade.rejected', proposalId)
        return
      }
      await this.#assertDeadlineOpen(transaction, leagueId, proposal.seasonId, 'trade', now)
      await this.#applyTrade(transaction, proposal, identity.personId, now)
    })
  }

  async cancelTrade(
    identity: SessionIdentity | null,
    leagueId: string,
    proposalId: string,
  ): Promise<void> {
    if (!identity) throw new PlatformError('Sign in is required', 'unauthorized')
    let now = this.#clock()
    await this.database.transaction(async (transaction) => {
      let proposal = await this.#lockProposal(transaction, leagueId, proposalId)
      if (proposal.status !== 'pending') throw new PlatformError('Trade proposal is already closed', 'conflict')
      if (!this.#isLeagueAdmin(identity, leagueId) && proposal.proposedByPersonId !== identity.personId) {
        throw new PlatformError('Only the proposer can cancel this trade', 'forbidden')
      }
      await transaction.update(tradeProposals).set({
        cancelledAt: now,
        status: 'cancelled',
        updatedAt: now,
      }).where(eq(tradeProposals.id, proposalId))
      await audit(transaction, identity.personId, leagueId, 'trade.cancelled', proposalId)
    })
  }

  async #applyTrade(
    transaction: OperationsTransaction,
    proposal: typeof tradeProposals.$inferSelect,
    actorPersonId: string,
    now: Date,
  ): Promise<void> {
    let items = await transaction
      .select()
      .from(tradeItems)
      .where(and(eq(tradeItems.leagueId, proposal.leagueId), eq(tradeItems.proposalId, proposal.id)))
    let teamIds = [proposal.proposerTeamId, proposal.counterpartyTeamId]
    let current = await this.#loadLatestPublishedRosters(transaction, proposal.leagueId, teamIds)
    let next = new Map<string, string[]>()
    for (let teamId of teamIds) {
      let roster = current.get(teamId)
      if (!roster) throw new PlatformError('Both teams need published rosters', 'conflict')
      let outgoing = new Set(items.filter((item) => item.fromTeamId === teamId).map((item) => item.characterId))
      let incoming = items.filter((item) => item.toTeamId === teamId).map((item) => item.characterId)
      this.#validateTradeCharacters([...outgoing], roster, 'trading')
      let characters = [...roster.rosterCharacterIds.filter((characterId) => !outgoing.has(characterId)), ...incoming]
      if (characters.length < 1 || characters.length > 18 || new Set(characters).size !== characters.length) {
        throw invalidInput('Trade would create an invalid roster')
      }
      next.set(teamId, characters)
    }

    let created = new Map<string, string>()
    for (let teamId of [...teamIds].sort()) {
      let source = current.get(teamId)!
      let id = this.#createId()
      await transaction.insert(rosterRevisions).values({
        basedOnRevisionId: source.id,
        createdAt: now,
        createdByPersonId: actorPersonId,
        id,
        leagueId: proposal.leagueId,
        publishedAt: now,
        revisionNumber: source.revisionNumber + 1,
        rosterCharacterIds: next.get(teamId)!,
        status: 'published',
        teamId,
      })
      created.set(teamId, id)
    }
    await transaction.insert(rosterTransactions).values(items.map((item) => ({
      actorPersonId,
      characterId: item.characterId,
      fromAfterRosterRevisionId: created.get(item.fromTeamId)!,
      fromBeforeRosterRevisionId: current.get(item.fromTeamId)!.id,
      fromTeamId: item.fromTeamId,
      id: this.#createId(),
      kind: 'trade' as const,
      leagueId: proposal.leagueId,
      occurredAt: now,
      reason: proposal.message,
      seasonId: proposal.seasonId,
      sourceId: proposal.id,
      toAfterRosterRevisionId: created.get(item.toTeamId)!,
      toBeforeRosterRevisionId: current.get(item.toTeamId)!.id,
      toTeamId: item.toTeamId,
    })))
    await transaction.update(tradeProposals).set({
      appliedAt: now,
      status: 'applied',
      updatedAt: now,
    }).where(eq(tradeProposals.id, proposal.id))
    await audit(transaction, actorPersonId, proposal.leagueId, 'trade.applied', proposal.id, {
      rosterRevisionIds: Object.fromEntries(created),
    })
  }

  async #lockProposal(
    transaction: OperationsTransaction,
    leagueId: string,
    proposalId: string,
  ) {
    let [proposal] = await transaction
      .select()
      .from(tradeProposals)
      .where(and(eq(tradeProposals.leagueId, leagueId), eq(tradeProposals.id, proposalId)))
      .for('update')
      .limit(1)
    if (!proposal) throw new PlatformError('Trade proposal was not found', 'not_found')
    return proposal
  }

  async #lockTeams(
    transaction: OperationsTransaction,
    leagueId: string,
    teamIds: string[],
  ) {
    return transaction
      .select({ id: leagueTeams.id, managerPersonId: leagueTeams.managerPersonId, seasonId: leagueTeams.seasonId })
      .from(leagueTeams)
      .where(and(eq(leagueTeams.leagueId, leagueId), inArray(leagueTeams.id, teamIds)))
      .orderBy(asc(leagueTeams.id))
      .for('update')
  }

  async #loadLatestPublishedRosters(
    transaction: StarworksDatabase | OperationsTransaction,
    leagueId: string,
    teamIds: string[],
  ): Promise<Map<string, RosterRow>> {
    let rows = await transaction
      .select()
      .from(rosterRevisions)
      .where(and(
        eq(rosterRevisions.leagueId, leagueId),
        inArray(rosterRevisions.teamId, teamIds),
        eq(rosterRevisions.status, 'published'),
      ))
      .orderBy(asc(rosterRevisions.teamId), desc(rosterRevisions.revisionNumber))
    let latest = new Map<string, RosterRow>()
    for (let row of rows) if (!latest.has(row.teamId)) latest.set(row.teamId, row)
    return latest
  }

  async #assertDeadlineOpen(
    transaction: OperationsTransaction,
    leagueId: string,
    seasonId: string,
    kind: 'lineup' | 'roster' | 'trade',
    now: Date,
  ): Promise<void> {
    let [deadline] = await transaction
      .select({ closesAt: leagueDeadlines.closesAt })
      .from(leagueDeadlines)
      .where(and(
        eq(leagueDeadlines.leagueId, leagueId),
        eq(leagueDeadlines.seasonId, seasonId),
        eq(leagueDeadlines.kind, kind),
      ))
      .limit(1)
    if (deadline && now.getTime() > deadline.closesAt.getTime()) {
      throw new PlatformError(`${kind[0]!.toUpperCase()}${kind.slice(1)} deadline has passed`, 'conflict')
    }
  }

  #validateTradeCharacters(characterIds: string[], roster: RosterRow | undefined, label: string): void {
    if (!roster) throw new PlatformError(`${label} team needs a published roster`, 'conflict')
    if (characterIds.some((characterId) => !roster.rosterCharacterIds.includes(characterId))) {
      throw invalidInput(`${label[0]!.toUpperCase()}${label.slice(1)} team no longer owns every offered character`)
    }
  }

  #requireLeagueAccess(identity: SessionIdentity | null, leagueId: string): asserts identity is SessionIdentity {
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

function invalidInput(message: string): PlatformError {
  return new PlatformError(message, 'invalid_input')
}

async function audit(
  transaction: OperationsTransaction,
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
    targetType: 'league_operation',
  })
}
