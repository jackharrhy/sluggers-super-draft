import { z } from 'zod'

import { createDatabase } from '../app/platform/database/connection.ts'
import { PostgresPlatformRepository } from '../app/platform/database/postgres-repository.ts'

let argumentSchema = z.object({
  discordUserId: z.string().regex(/^\d{5,32}$/),
  displayName: z.string().trim().min(1).max(100),
  discordUsername: z.string().trim().min(1).max(100),
})

let values = readArguments(process.argv.slice(2))
let parsed = argumentSchema.safeParse(values)
if (!parsed.success) {
  console.error(
    'Usage: npm run db:bootstrap-admin -- --discord-user-id ID --discord-username NAME [--display-name NAME]',
  )
  process.exitCode = 2
} else {
  let databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) throw new Error('DATABASE_URL is required')

  let connection = createDatabase(databaseUrl, { max: 1 })
  try {
    let repository = new PostgresPlatformRepository(connection.database)
    let identity = await repository.bootstrapSiteAdmin(parsed.data)
    console.log(
      JSON.stringify({
        discordUserId: identity.discordUserId,
        displayName: identity.displayName,
        personId: identity.personId,
        siteAdmin: identity.isSiteAdmin,
      }),
    )
  } finally {
    await connection.close()
  }
}

function readArguments(arguments_: string[]) {
  let entries = new Map<string, string>()
  for (let index = 0; index < arguments_.length; index += 2) {
    let key = arguments_[index]
    let value = arguments_[index + 1]
    if (!key?.startsWith('--') || !value) continue
    entries.set(key.slice(2), value)
  }

  let discordUsername = entries.get('discord-username') ?? ''
  return {
    discordUserId: entries.get('discord-user-id') ?? '',
    discordUsername,
    displayName: entries.get('display-name') ?? discordUsername,
  }
}
