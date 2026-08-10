import { z } from 'zod'

import { PlatformError } from './errors.ts'
import { runnerCredentialScopes } from './model.ts'
import type {
  LeagueDetail,
  LeagueSummary,
  IssuedRunnerCredential,
  ProvisionedLeague,
  PublicationPolicy,
  SessionIdentity,
  RunnerCredentialScope,
} from './model.ts'
import { administrativeRoles, type PlatformRepository } from './repository.ts'
import { createOpaqueToken, hashSecret } from './security.ts'

const provisionLeagueSchema = z.object({
  name: z.string().trim().min(2).max(100),
  slug: z
    .string()
    .trim()
    .min(2)
    .max(64)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
})

const publicationPolicySchema = z.object({
  leagueVisible: z.boolean(),
  standingsVisible: z.boolean(),
  statsVisible: z.boolean(),
  draftVisible: z.boolean(),
})

const runnerCredentialSchema = z.object({
  name: z.string().trim().min(2).max(100),
  scopes: z.array(z.enum(runnerCredentialScopes)).min(1).max(runnerCredentialScopes.length),
})

export interface PlatformServiceOptions {
  clock?: () => Date
  createToken?: () => string
}

export class PlatformService {
  readonly #clock: () => Date
  readonly #createToken: () => string

  constructor(
    readonly repository: PlatformRepository,
    options: PlatformServiceOptions = {},
  ) {
    this.#clock = options.clock ?? (() => new Date())
    this.#createToken = options.createToken ?? createOpaqueToken
  }

  async resolveSession(rawToken: string | null): Promise<SessionIdentity | null> {
    if (!rawToken) return null
    return this.repository.findIdentityBySessionHash(hashSecret(rawToken), this.#clock())
  }

  async revokeSession(rawToken: string | null): Promise<void> {
    if (!rawToken) return
    await this.repository.revokeSession(hashSecret(rawToken), this.#clock())
  }

  listVisibleLeagues(identity: SessionIdentity | null): Promise<LeagueSummary[]> {
    return this.repository.listVisibleLeagues(identity?.personId ?? null)
  }

  viewLeague(slug: string, identity: SessionIdentity | null): Promise<LeagueDetail | null> {
    return this.repository.findAccessibleLeague(slug, identity?.personId ?? null)
  }

  async provisionLeague(
    identity: SessionIdentity | null,
    input: { name: string; slug: string },
  ): Promise<ProvisionedLeague> {
    if (!identity) throw new PlatformError('Sign in is required', 'unauthorized')
    if (!identity.isSiteAdmin) {
      throw new PlatformError('Only a site administrator can create a league', 'forbidden')
    }

    let parsed = provisionLeagueSchema.safeParse(input)
    if (!parsed.success) {
      throw new PlatformError('League name or slug is invalid', 'invalid_input')
    }

    let invitationToken = this.#createToken()
    let invitationExpiresAt = new Date(this.#clock().getTime() + 7 * 24 * 60 * 60 * 1_000)
    let league = await this.repository.provisionLeague({
      actorPersonId: identity.personId,
      invitationExpiresAt,
      invitationTokenHash: hashSecret(invitationToken),
      ...parsed.data,
    })

    return { invitationExpiresAt, invitationToken, league }
  }

  async setPublicationPolicy(
    identity: SessionIdentity | null,
    leagueId: string,
    input: PublicationPolicy,
  ): Promise<void> {
    if (!identity) throw new PlatformError('Sign in is required', 'unauthorized')
    if (!mayAdministerLeague(identity, leagueId)) {
      throw new PlatformError('League administrator access is required', 'forbidden')
    }

    let policy = publicationPolicySchema.safeParse(input)
    if (!policy.success) throw new PlatformError('Publication policy is invalid', 'invalid_input')
    await this.repository.setPublicationPolicy({
      actorPersonId: identity.personId,
      leagueId,
      now: this.#clock(),
      policy: policy.data,
    })
  }

  async issueRunnerCredential(
    identity: SessionIdentity | null,
    leagueId: string,
    input: { name: string; scopes: RunnerCredentialScope[] },
  ): Promise<IssuedRunnerCredential> {
    if (!identity) throw new PlatformError('Sign in is required', 'unauthorized')
    if (!mayAdministerLeague(identity, leagueId)) {
      throw new PlatformError('League administrator access is required', 'forbidden')
    }
    let parsed = runnerCredentialSchema.safeParse(input)
    if (!parsed.success) throw new PlatformError('Runner credential is invalid', 'invalid_input')
    let scopes = [...new Set(parsed.data.scopes)].sort() as RunnerCredentialScope[]
    let secret = this.#createToken()
    let credentialId = await this.repository.createRunnerCredential({
      actorPersonId: identity.personId,
      leagueId,
      name: parsed.data.name,
      scopes,
      secretHash: hashSecret(secret),
    })
    return {
      credential: `starworks_runner_${credentialId}.${secret}`,
      credentialId,
      leagueId,
      name: parsed.data.name,
      scopes,
    }
  }

  async revokeRunnerCredential(
    identity: SessionIdentity | null,
    leagueId: string,
    credentialId: string,
  ): Promise<void> {
    if (!identity) throw new PlatformError('Sign in is required', 'unauthorized')
    if (!mayAdministerLeague(identity, leagueId)) {
      throw new PlatformError('League administrator access is required', 'forbidden')
    }
    let revoked = await this.repository.revokeRunnerCredential({
      actorPersonId: identity.personId,
      credentialId,
      leagueId,
      now: this.#clock(),
    })
    if (!revoked) throw new PlatformError('Runner credential was not found', 'not_found')
  }
}

function mayAdministerLeague(identity: SessionIdentity, leagueId: string): boolean {
  let membership = identity.memberships.find((candidate) => candidate.leagueId === leagueId)
  return (
    identity.isSiteAdmin ||
    membership?.roles.some((role) => administrativeRoles.has(role)) === true
  )
}
