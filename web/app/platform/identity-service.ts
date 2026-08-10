import { PlatformError } from './errors.ts'
import type { DiscordOAuthClient } from './discord-oauth.ts'
import type { CompletedLogin } from './model.ts'
import type { PlatformRepository } from './repository.ts'
import { createOpaqueToken, createPkceChallenge, hashSecret } from './security.ts'

export interface IdentityServiceOptions {
  clock?: () => Date
  createToken?: () => string
}

export interface DiscordLoginStart {
  authorizationUrl: URL
  transactionToken: string
  transactionExpiresAt: Date
}

export class IdentityService {
  readonly #clock: () => Date
  readonly #createToken: () => string

  constructor(
    readonly repository: PlatformRepository,
    readonly discord: DiscordOAuthClient,
    options: IdentityServiceOptions = {},
  ) {
    this.#clock = options.clock ?? (() => new Date())
    this.#createToken = options.createToken ?? createOpaqueToken
  }

  async beginDiscordLogin(input: {
    invitationToken?: string | null
    returnTo?: string | null
  }): Promise<DiscordLoginStart> {
    let now = this.#clock()
    let invitationId: string | null = null
    if (input.invitationToken) {
      invitationId = await this.repository.findPendingInvitationId(
        hashSecret(input.invitationToken),
        now,
      )
      if (!invitationId) throw new PlatformError('Invitation is invalid or expired', 'invalid_input')
    }

    let state = this.#createToken()
    let transactionToken = this.#createToken()
    let codeVerifier = this.#createToken()
    let transactionExpiresAt = new Date(now.getTime() + 10 * 60 * 1_000)
    let returnTo = safeReturnTo(input.returnTo)
    let authorizationUrl = this.discord.createAuthorizationUrl({
      codeChallenge: createPkceChallenge(codeVerifier),
      state,
    })
    await this.repository.createOAuthAttempt({
      codeVerifier,
      expiresAt: transactionExpiresAt,
      invitationId,
      returnTo,
      stateHash: hashSecret(state),
      transactionHash: hashSecret(transactionToken),
    })

    return {
      authorizationUrl,
      transactionExpiresAt,
      transactionToken,
    }
  }

  async completeDiscordLogin(input: {
    code: string | null
    state: string | null
    transactionToken: string | null
  }): Promise<CompletedLogin> {
    if (!input.code || !input.state || !input.transactionToken) {
      throw new PlatformError('Discord login response is incomplete', 'unauthorized')
    }

    let now = this.#clock()
    let attempt = await this.repository.consumeOAuthAttempt({
      now,
      stateHash: hashSecret(input.state),
      transactionHash: hashSecret(input.transactionToken),
    })
    if (!attempt) throw new PlatformError('Discord login attempt is invalid or expired', 'unauthorized')

    let profile = await this.discord.exchangeCode({
      code: input.code,
      codeVerifier: attempt.codeVerifier,
    })
    let sessionToken = this.#createToken()
    let sessionExpiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1_000)
    try {
      let identity = await this.repository.completeDiscordLogin({
        invitationId: attempt.invitationId,
        now,
        profile,
        sessionExpiresAt,
        sessionTokenHash: hashSecret(sessionToken),
      })
      return { identity, returnTo: attempt.returnTo, sessionExpiresAt, sessionToken }
    } catch (error) {
      if (error instanceof Error && error.message === 'Open registration is disabled') {
        throw new PlatformError(
          'Starworks accounts are invitation-only. Ask the site administrator for access.',
          'registration_closed',
        )
      }
      throw error
    }
  }
}

function safeReturnTo(value: string | null | undefined): string {
  if (!value?.startsWith('/') || value.startsWith('//')) return '/'
  return value
}
