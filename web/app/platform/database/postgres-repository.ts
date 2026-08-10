import { and, asc, eq, gt, isNull, or } from 'drizzle-orm'

import type {
  LeagueDetail,
  LeagueRole,
  LeagueSummary,
  MembershipIdentity,
  PublicationPolicy,
  SessionIdentity,
} from '../model.ts'
import type { PlatformRepository, ProvisionLeagueRecord } from '../repository.ts'
import type { StarworksDatabase } from './connection.ts'
import {
  auditRecords,
  discordIdentities,
  invitations,
  leagueMembershipRoles,
  leagueMemberships,
  leagues,
  people,
  publicationSettings,
  sessions,
} from './schema.ts'

export class PostgresPlatformRepository implements PlatformRepository {
  constructor(readonly database: StarworksDatabase) {}

  async bootstrapSiteAdmin(input: {
    discordUserId: string
    displayName: string
    discordUsername: string
  }): Promise<SessionIdentity> {
    let personId = await this.database.transaction(async (transaction) => {
      let [existing] = await transaction
        .select({ personId: discordIdentities.personId })
        .from(discordIdentities)
        .where(eq(discordIdentities.discordUserId, input.discordUserId))
        .limit(1)

      if (existing) {
        await transaction
          .update(people)
          .set({ displayName: input.displayName, isSiteAdmin: true, updatedAt: new Date() })
          .where(eq(people.id, existing.personId))
        await transaction
          .update(discordIdentities)
          .set({ username: input.discordUsername })
          .where(eq(discordIdentities.discordUserId, input.discordUserId))
        return existing.personId
      }

      let [person] = await transaction
        .insert(people)
        .values({ displayName: input.displayName, isSiteAdmin: true })
        .returning({ id: people.id })
      if (!person) throw new Error('Failed to create site administrator')

      await transaction.insert(discordIdentities).values({
        discordUserId: input.discordUserId,
        personId: person.id,
        username: input.discordUsername,
      })
      await transaction.insert(auditRecords).values({
        action: 'site_admin.bootstrapped',
        actorPersonId: person.id,
        targetId: person.id,
        targetType: 'person',
      })
      return person.id
    })

    let identity = await this.#loadIdentity(personId)
    if (!identity) throw new Error('Failed to load bootstrapped site administrator')
    return identity
  }

  async findIdentityBySessionHash(tokenHash: string, now: Date): Promise<SessionIdentity | null> {
    let [record] = await this.database
      .select({ personId: sessions.personId })
      .from(sessions)
      .innerJoin(people, eq(people.id, sessions.personId))
      .where(
        and(
          eq(sessions.tokenHash, tokenHash),
          isNull(sessions.revokedAt),
          gt(sessions.expiresAt, now),
          isNull(people.disabledAt),
        ),
      )
      .limit(1)

    if (!record) return null
    await this.database.update(sessions).set({ lastSeenAt: now }).where(eq(sessions.tokenHash, tokenHash))
    return this.#loadIdentity(record.personId)
  }

  async listVisibleLeagues(personId: string | null): Promise<LeagueSummary[]> {
    let conditions = personId
      ? or(eq(publicationSettings.leagueVisible, true), eq(leagueMemberships.personId, personId))
      : eq(publicationSettings.leagueVisible, true)
    let rows = await this.database
      .select({
        draftVisible: publicationSettings.draftVisible,
        id: leagues.id,
        leagueVisible: publicationSettings.leagueVisible,
        name: leagues.name,
        slug: leagues.slug,
        standingsVisible: publicationSettings.standingsVisible,
        statsVisible: publicationSettings.statsVisible,
      })
      .from(leagues)
      .innerJoin(publicationSettings, eq(publicationSettings.leagueId, leagues.id))
      .leftJoin(
        leagueMemberships,
        personId
          ? and(
              eq(leagueMemberships.leagueId, leagues.id),
              eq(leagueMemberships.personId, personId),
              isNull(leagueMemberships.disabledAt),
            )
          : eq(leagueMemberships.leagueId, leagues.id),
      )
      .where(and(eq(leagues.status, 'active'), conditions))
      .orderBy(asc(leagues.name))

    let roles = personId ? await this.#loadRoles(personId) : new Map<string, LeagueRole[]>()
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      publication: publicationFromRow(row),
      roles: roles.get(row.id) ?? [],
      slug: row.slug,
    }))
  }

  async findAccessibleLeague(slug: string, personId: string | null): Promise<LeagueDetail | null> {
    let [row] = await this.database
      .select({
        draftVisible: publicationSettings.draftVisible,
        id: leagues.id,
        leagueVisible: publicationSettings.leagueVisible,
        name: leagues.name,
        slug: leagues.slug,
        standingsVisible: publicationSettings.standingsVisible,
        statsVisible: publicationSettings.statsVisible,
        status: leagues.status,
      })
      .from(leagues)
      .innerJoin(publicationSettings, eq(publicationSettings.leagueId, leagues.id))
      .where(eq(leagues.slug, slug))
      .limit(1)

    if (!row) return null
    let roles = personId ? (await this.#loadRoles(personId)).get(row.id) ?? [] : []
    if (!row.leagueVisible && roles.length === 0) return null

    return {
      id: row.id,
      name: row.name,
      publication: publicationFromRow(row),
      roles,
      slug: row.slug,
      status: row.status,
    }
  }

  async provisionLeague(input: ProvisionLeagueRecord): Promise<LeagueDetail> {
    return this.database.transaction(async (transaction) => {
      let [league] = await transaction
        .insert(leagues)
        .values({
          createdByPersonId: input.actorPersonId,
          name: input.name,
          slug: input.slug,
        })
        .returning({ id: leagues.id, name: leagues.name, slug: leagues.slug, status: leagues.status })
      if (!league) throw new Error('Failed to create league')

      await transaction.insert(publicationSettings).values({ leagueId: league.id })
      await transaction.insert(leagueMemberships).values({
        leagueId: league.id,
        personId: input.actorPersonId,
      })
      await transaction.insert(leagueMembershipRoles).values({
        grantedByPersonId: input.actorPersonId,
        leagueId: league.id,
        personId: input.actorPersonId,
        role: 'owner',
      })
      await transaction.insert(invitations).values({
        createdByPersonId: input.actorPersonId,
        expiresAt: input.invitationExpiresAt,
        leagueId: league.id,
        role: 'administrator',
        tokenHash: input.invitationTokenHash,
      })
      await transaction.insert(auditRecords).values({
        action: 'league.provisioned',
        actorPersonId: input.actorPersonId,
        leagueId: league.id,
        metadata: { initialInvitationRole: 'administrator' },
        targetId: league.id,
        targetType: 'league',
      })

      return {
        ...league,
        publication: {
          draftVisible: false,
          leagueVisible: false,
          standingsVisible: false,
          statsVisible: false,
        },
        roles: ['owner'],
      }
    })
  }

  async revokeSession(tokenHash: string, now: Date): Promise<void> {
    await this.database
      .update(sessions)
      .set({ revokedAt: now })
      .where(and(eq(sessions.tokenHash, tokenHash), isNull(sessions.revokedAt)))
  }

  async setPublicationPolicy(input: {
    actorPersonId: string
    leagueId: string
    policy: PublicationPolicy
    now: Date
  }): Promise<void> {
    await this.database.transaction(async (transaction) => {
      await transaction
        .update(publicationSettings)
        .set({ ...input.policy, updatedAt: input.now })
        .where(eq(publicationSettings.leagueId, input.leagueId))
      await transaction.insert(auditRecords).values({
        action: 'league.publication.updated',
        actorPersonId: input.actorPersonId,
        leagueId: input.leagueId,
        metadata: {
          draftVisible: input.policy.draftVisible,
          leagueVisible: input.policy.leagueVisible,
          standingsVisible: input.policy.standingsVisible,
          statsVisible: input.policy.statsVisible,
        },
        targetId: input.leagueId,
        targetType: 'league',
      })
    })
  }

  async #loadIdentity(personId: string): Promise<SessionIdentity | null> {
    let [person] = await this.database
      .select({
        discordUserId: discordIdentities.discordUserId,
        discordUsername: discordIdentities.username,
        displayName: people.displayName,
        isSiteAdmin: people.isSiteAdmin,
        personId: people.id,
      })
      .from(people)
      .innerJoin(discordIdentities, eq(discordIdentities.personId, people.id))
      .where(and(eq(people.id, personId), isNull(people.disabledAt)))
      .limit(1)
    if (!person) return null

    let memberships = await this.#loadMemberships(personId)
    return { ...person, memberships }
  }

  async #loadMemberships(personId: string): Promise<MembershipIdentity[]> {
    let rows = await this.database
      .select({
        leagueId: leagues.id,
        leagueName: leagues.name,
        leagueSlug: leagues.slug,
        role: leagueMembershipRoles.role,
      })
      .from(leagueMemberships)
      .innerJoin(leagues, eq(leagues.id, leagueMemberships.leagueId))
      .leftJoin(
        leagueMembershipRoles,
        and(
          eq(leagueMembershipRoles.leagueId, leagueMemberships.leagueId),
          eq(leagueMembershipRoles.personId, leagueMemberships.personId),
        ),
      )
      .where(and(eq(leagueMemberships.personId, personId), isNull(leagueMemberships.disabledAt)))
      .orderBy(asc(leagues.name))

    let memberships = new Map<string, MembershipIdentity>()
    for (let row of rows) {
      let membership = memberships.get(row.leagueId) ?? {
        leagueId: row.leagueId,
        leagueName: row.leagueName,
        leagueSlug: row.leagueSlug,
        roles: [],
      }
      if (row.role) membership.roles.push(row.role)
      memberships.set(row.leagueId, membership)
    }
    return [...memberships.values()]
  }

  async #loadRoles(personId: string): Promise<Map<string, LeagueRole[]>> {
    let memberships = await this.#loadMemberships(personId)
    return new Map(memberships.map((membership) => [membership.leagueId, membership.roles]))
  }
}

function publicationFromRow(row: {
  draftVisible: boolean
  leagueVisible: boolean
  standingsVisible: boolean
  statsVisible: boolean
}): PublicationPolicy {
  return {
    draftVisible: row.draftVisible,
    leagueVisible: row.leagueVisible,
    standingsVisible: row.standingsVisible,
    statsVisible: row.statsVisible,
  }
}
