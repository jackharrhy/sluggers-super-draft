import type {
  DiscordProfile,
  LeagueDetail,
  LeagueRole,
  LeagueSummary,
  OAuthAttemptRecord,
  PublicationPolicy,
  SessionIdentity,
} from './model.ts'

export interface ProvisionLeagueRecord {
  actorPersonId: string
  invitationExpiresAt: Date
  invitationTokenHash: string
  name: string
  slug: string
}

export interface PlatformRepository {
  bootstrapSiteAdmin(input: {
    discordUserId: string
    displayName: string
    discordUsername: string
  }): Promise<SessionIdentity>
  completeDiscordLogin(input: {
    invitationId: string | null
    now: Date
    profile: DiscordProfile
    sessionExpiresAt: Date
    sessionTokenHash: string
  }): Promise<SessionIdentity>
  consumeOAuthAttempt(input: {
    now: Date
    stateHash: string
    transactionHash: string
  }): Promise<OAuthAttemptRecord | null>
  createOAuthAttempt(input: {
    codeVerifier: string
    expiresAt: Date
    invitationId: string | null
    returnTo: string
    stateHash: string
    transactionHash: string
  }): Promise<void>
  findPendingInvitationId(tokenHash: string, now: Date): Promise<string | null>
  findIdentityBySessionHash(tokenHash: string, now: Date): Promise<SessionIdentity | null>
  listVisibleLeagues(personId: string | null): Promise<LeagueSummary[]>
  findAccessibleLeague(slug: string, personId: string | null): Promise<LeagueDetail | null>
  provisionLeague(input: ProvisionLeagueRecord): Promise<LeagueDetail>
  revokeSession(tokenHash: string, now: Date): Promise<void>
  setPublicationPolicy(input: {
    actorPersonId: string
    leagueId: string
    policy: PublicationPolicy
    now: Date
  }): Promise<void>
}

export const administrativeRoles = new Set<LeagueRole>([
  'owner',
  'administrator',
  'commissioner',
])
