import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { migrate } from 'drizzle-orm/postgres-js/migrator'

import { createDatabase } from '../app/platform/database/connection.ts'

let databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) {
  throw new Error('DATABASE_URL is required')
}

let migrationsFolder = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../drizzle')
let connection = createDatabase(databaseUrl, { max: 1 })

try {
  await migrate(connection.database, { migrationsFolder })
  console.log('Starworks database migrations are current')
} finally {
  await connection.close()
}
