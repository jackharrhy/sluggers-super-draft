import * as assert from 'remix/assert'
import { describe, it } from 'remix/test'

import { DiscordApiOAuthClient } from './discord-oauth.ts'

describe('Discord OAuth client', () => {
  it('uses authorization code PKCE with only the identify scope', () => {
    let client = new DiscordApiOAuthClient({
      clientId: 'client-id',
      clientSecret: 'client-secret',
      redirectUri: 'https://starworks.test/auth/discord/callback',
    })
    let url = client.createAuthorizationUrl({ codeChallenge: 'challenge', state: 'state' })

    assert.equal(url.origin + url.pathname, 'https://discord.com/oauth2/authorize')
    assert.equal(url.searchParams.get('scope'), 'identify')
    assert.equal(url.searchParams.get('state'), 'state')
    assert.equal(url.searchParams.get('code_challenge'), 'challenge')
    assert.equal(url.searchParams.get('code_challenge_method'), 'S256')
    assert.equal(url.searchParams.has('email'), false)
  })

  it('exchanges a code and normalizes the current Discord user', async () => {
    let requests: Array<{ input: string; init?: RequestInit }> = []
    let responses = [
      Response.json({ access_token: 'access-token', token_type: 'Bearer' }),
      Response.json({ avatar: null, global_name: 'Slugger', id: '123456789', username: 'slugger' }),
    ]
    let client = new DiscordApiOAuthClient(
      {
        clientId: 'client-id',
        clientSecret: 'client-secret',
        redirectUri: 'https://starworks.test/auth/discord/callback',
      },
      async (input, init) => {
        requests.push({ input: input.toString(), init })
        return responses.shift()!
      },
    )

    let profile = await client.exchangeCode({ code: 'authorization-code', codeVerifier: 'verifier' })
    assert.deepEqual(profile, {
      avatarHash: null,
      discordUserId: '123456789',
      displayName: 'Slugger',
      username: 'slugger',
    })
    assert.match(requests[0]?.init?.body?.toString() ?? '', /code_verifier=verifier/)
    assert.equal(requests[1]?.init?.headers && new Headers(requests[1].init.headers).get('authorization'), 'Bearer access-token')
  })
})
