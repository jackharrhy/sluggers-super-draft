export const leagueRoles = [
  'owner',
  'administrator',
  'commissioner',
  'manager',
  'member',
] as const

export type LeagueRole = (typeof leagueRoles)[number]

export interface MembershipIdentity {
  leagueId: string
  leagueSlug: string
  leagueName: string
  roles: LeagueRole[]
}

export interface SessionIdentity {
  personId: string
  displayName: string
  discordUserId: string
  discordUsername: string
  isSiteAdmin: boolean
  memberships: MembershipIdentity[]
}

export interface PublicationPolicy {
  leagueVisible: boolean
  standingsVisible: boolean
  statsVisible: boolean
  draftVisible: boolean
}

export interface LeagueSummary {
  id: string
  slug: string
  name: string
  publication: PublicationPolicy
  roles: LeagueRole[]
}

export interface LeagueDetail extends LeagueSummary {
  status: 'active' | 'archived'
}

export interface ProvisionedLeague {
  league: LeagueDetail
  invitationToken: string
  invitationExpiresAt: Date
}

export interface DiscordProfile {
  avatarHash: string | null
  discordUserId: string
  displayName: string
  username: string
}

export interface OAuthAttemptRecord {
  codeVerifier: string
  invitationId: string | null
  returnTo: string
}

export interface CompletedLogin {
  identity: SessionIdentity
  returnTo: string
  sessionToken: string
  sessionExpiresAt: Date
}

export const runnerCredentialScopes = [
  'artifacts:read',
  'heartbeat:write',
  'runs:claim',
  'runs:read',
  'telemetry:write',
] as const

export type RunnerCredentialScope = (typeof runnerCredentialScopes)[number]

export interface IssuedRunnerCredential {
  credential: string
  credentialId: string
  leagueId: string
  name: string
  scopes: RunnerCredentialScope[]
}
