import type {
  LeagueDetail,
  LeagueRole,
  LeagueSummary,
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
