import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'

import * as schema from './schema.ts'

export function createDatabase(databaseUrl: string, options: { max?: number } = {}) {
  let client = postgres(databaseUrl, {
    max: options.max ?? 10,
    onnotice: () => {},
  })
  let database = drizzle(client, { schema })

  return {
    client,
    database,
    async close() {
      await client.end()
    },
  }
}

export type StarworksDatabase = ReturnType<typeof createDatabase>['database']
