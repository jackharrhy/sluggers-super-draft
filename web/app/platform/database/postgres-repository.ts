import { and, asc, eq, gt, isNull, or } from 'drizzle-orm'

import type {
  DiscordProfile,
  LeagueDetail,
  LeagueRole,
  LeagueSummary,
  MembershipIdentity,
  OAuthAttemptRecord,
  PublicationPolicy,
  SessionIdentity,
  RunnerCredentialScope,
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
  oauthAttempts,
  people,
  publicationSettings,
  runnerCredentials,
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

  async completeDiscordLogin(input: {
    invitationId: string | null
    now: Date
    profile: DiscordProfile
    sessionExpiresAt: Date
    sessionTokenHash: string
  }): Promise<SessionIdentity> {
    let personId = await this.database.transaction(async (transaction) => {
      let [discordIdentity] = await transaction
        .select({ personId: discordIdentities.personId })
        .from(discordIdentities)
        .where(eq(discordIdentities.discordUserId, input.profile.discordUserId))
        .limit(1)

      let invitation = null
      if (input.invitationId) {
        let [pendingInvitation] = await transaction
          .select({
            id: invitations.id,
            leagueId: invitations.leagueId,
            role: invitations.role,
          })
          .from(invitations)
          .where(
            and(
              eq(invitations.id, input.invitationId),
              eq(invitations.status, 'pending'),
              gt(invitations.expiresAt, input.now),
              isNull(invitations.revokedAt),
            ),
          )
          .limit(1)
          .for('update')
        invitation = pendingInvitation ?? null
        if (!invitation) throw new Error('Invitation is no longer available')
      }

      if (!discordIdentity && !invitation) {
        throw new Error('Open registration is disabled')
      }

      let resolvedPersonId = discordIdentity?.personId
      if (!resolvedPersonId) {
        let [person] = await transaction
          .insert(people)
          .values({ displayName: input.profile.displayName })
          .returning({ id: people.id })
        if (!person) throw new Error('Failed to create provisioned person')
        resolvedPersonId = person.id
        await transaction.insert(discordIdentities).values({
          avatarHash: input.profile.avatarHash,
          discordUserId: input.profile.discordUserId,
          personId: resolvedPersonId,
          username: input.profile.username,
        })
      } else {
        await transaction
          .update(discordIdentities)
          .set({
            avatarHash: input.profile.avatarHash,
            lastLoginAt: input.now,
            username: input.profile.username,
          })
          .where(eq(discordIdentities.discordUserId, input.profile.discordUserId))
        await transaction
          .update(people)
          .set({ displayName: input.profile.displayName, updatedAt: input.now })
          .where(eq(people.id, resolvedPersonId))
      }

      if (invitation) {
        await transaction
          .insert(leagueMemberships)
          .values({ leagueId: invitation.leagueId, personId: resolvedPersonId })
          .onConflictDoNothing()
        await transaction
          .insert(leagueMembershipRoles)
          .values({
            leagueId: invitation.leagueId,
            personId: resolvedPersonId,
            role: invitation.role,
          })
          .onConflictDoNothing()
        let redeemed = await transaction
          .update(invitations)
          .set({
            redeemedAt: input.now,
            redeemedByPersonId: resolvedPersonId,
            status: 'redeemed',
          })
          .where(and(eq(invitations.id, invitation.id), eq(invitations.status, 'pending')))
          .returning({ id: invitations.id })
        if (redeemed.length !== 1) throw new Error('Invitation was redeemed concurrently')
        await transaction.insert(auditRecords).values({
          action: 'invitation.redeemed',
          actorPersonId: resolvedPersonId,
          leagueId: invitation.leagueId,
          targetId: invitation.id,
          targetType: 'invitation',
        })
      }

      await transaction.insert(sessions).values({
        expiresAt: input.sessionExpiresAt,
        personId: resolvedPersonId,
        tokenHash: input.sessionTokenHash,
      })
      await transaction.insert(auditRecords).values({
        action: 'session.created',
        actorPersonId: resolvedPersonId,
        targetId: resolvedPersonId,
        targetType: 'person',
      })
      return resolvedPersonId
    })

    let identity = await this.#loadIdentity(personId)
    if (!identity) throw new Error('Failed to load authenticated identity')
    return identity
  }

  async consumeOAuthAttempt(input: {
    now: Date
    stateHash: string
    transactionHash: string
  }): Promise<OAuthAttemptRecord | null> {
    let [attempt] = await this.database
      .update(oauthAttempts)
      .set({ consumedAt: input.now })
      .where(
        and(
          eq(oauthAttempts.transactionHash, input.transactionHash),
          eq(oauthAttempts.stateHash, input.stateHash),
          isNull(oauthAttempts.consumedAt),
          gt(oauthAttempts.expiresAt, input.now),
        ),
      )
      .returning({
        codeVerifier: oauthAttempts.codeVerifier,
        invitationId: oauthAttempts.invitationId,
        returnTo: oauthAttempts.returnTo,
      })
    return attempt ?? null
  }

  async createOAuthAttempt(input: {
    codeVerifier: string
    expiresAt: Date
    invitationId: string | null
    returnTo: string
    stateHash: string
    transactionHash: string
  }): Promise<void> {
    await this.database.insert(oauthAttempts).values(input)
  }

  async findPendingInvitationId(tokenHash: string, now: Date): Promise<string | null> {
    let [invitation] = await this.database
      .select({ id: invitations.id })
      .from(invitations)
      .where(
        and(
          eq(invitations.tokenHash, tokenHash),
          eq(invitations.status, 'pending'),
          gt(invitations.expiresAt, now),
          isNull(invitations.revokedAt),
        ),
      )
      .limit(1)
    return invitation?.id ?? null
  }

  async createRunnerCredential(input: {
    actorPersonId: string
    leagueId: string
    name: string
    scopes: RunnerCredentialScope[]
    secretHash: string
  }): Promise<string> {
    return this.database.transaction(async (transaction) => {
      let [credential] = await transaction
        .insert(runnerCredentials)
        .values({
          createdByPersonId: input.actorPersonId,
          leagueId: input.leagueId,
          name: input.name,
          scopes: input.scopes,
          secretHash: input.secretHash,
        })
        .returning({ id: runnerCredentials.id })
      if (!credential) throw new Error('Failed to create runner credential')
      await transaction.insert(auditRecords).values({
        action: 'runner_credential.created',
        actorPersonId: input.actorPersonId,
        leagueId: input.leagueId,
        metadata: { name: input.name, scopes: input.scopes },
        targetId: credential.id,
        targetType: 'runner_credential',
      })
      return credential.id
    })
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

  async revokeRunnerCredential(input: {
    actorPersonId: string
    credentialId: string
    leagueId: string
    now: Date
  }): Promise<boolean> {
    return this.database.transaction(async (transaction) => {
      let revoked = await transaction
        .update(runnerCredentials)
        .set({ revokedAt: input.now })
        .where(
          and(
            eq(runnerCredentials.id, input.credentialId),
            eq(runnerCredentials.leagueId, input.leagueId),
            isNull(runnerCredentials.revokedAt),
          ),
        )
        .returning({ id: runnerCredentials.id })
      if (!revoked.length) return false
      await transaction.insert(auditRecords).values({
        action: 'runner_credential.revoked',
        actorPersonId: input.actorPersonId,
        leagueId: input.leagueId,
        targetId: input.credentialId,
        targetType: 'runner_credential',
      })
      return true
    })
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
