import * as assert from 'remix/assert'
import { describe, it } from 'remix/test'

import {
  DiscordApiNotificationClient,
  DisabledDiscordNotificationClient,
  createDiscordNotificationClient,
} from './discord-client.ts'

describe('Discord notification client', () => {
  it('posts without allowing event text to trigger mentions', async () => {
    let request: { body: string; headers: Headers; method: string; url: string } | undefined
    let client = new DiscordApiNotificationClient(
      'bot-token',
      async (input, init) => {
        request = {
          body: String(init?.body),
          headers: new Headers(init?.headers),
          method: init?.method ?? 'GET',
          url: String(input),
        }
        return new Response(null, { status: 201 })
      },
    )

    await client.sendChannelMessage('123456789012345678', '@everyone game ready')

    assert.equal(request?.method, 'POST')
    assert.equal(request?.url, 'https://discord.com/api/v10/channels/123456789012345678/messages')
    assert.equal(request?.headers.get('authorization'), 'Bot bot-token')
    assert.ok(request?.body)
    assert.deepEqual(JSON.parse(request!.body), {
      allowed_mentions: { parse: [] },
      content: '@everyone game ready',
    })
  })

  it('runs with notification delivery disabled when no bot token exists', () => {
    assert.ok(createDiscordNotificationClient({}) instanceof DisabledDiscordNotificationClient)
  })

  it('bounds delivery time with an abort signal', async () => {
    let signal: AbortSignal | null | undefined
    let client = new DiscordApiNotificationClient('bot-token', async (_input, init) => {
      signal = init?.signal
      return new Response(null, { status: 201 })
    }, 25)

    await client.sendChannelMessage('123456789012345678', 'Game ready')

    assert.ok(signal)
  })
})
