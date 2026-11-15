import fs from 'node:fs/promises'

import { z } from 'zod'

import { extractLegacySuperDraftSnapshot } from '../app/import/extract-legacy-super-draft.ts'
import { LegacySuperDraftImporter } from '../app/import/legacy-super-draft-importer.ts'
import { LegacySuperDraftSnapshotSchema } from '../app/import/legacy-super-draft-snapshot.ts'
import { createDatabase } from '../app/platform/database/connection.ts'

let optionsSchema = z.object({
  actorPersonId: z.string().uuid(),
  apply: z.boolean(),
  leagueId: z.string().uuid(),
  snapshotPath: z.string().min(1).optional(),
  sourceDatabaseUrl: z.string().url().optional(),
})

let options = optionsSchema.safeParse(readArguments(process.argv.slice(2)))
if (!options.success || (!options.data.snapshotPath && !options.data.sourceDatabaseUrl)) {
  console.error(
    'Usage: npm run import:legacy -- --league-id UUID --actor-person-id UUID (--snapshot FILE | --source-database-url URL) [--apply]',
  )
  process.exitCode = 2
} else {
  let targetDatabaseUrl = process.env.DATABASE_URL
  if (!targetDatabaseUrl) throw new Error('DATABASE_URL is required for the Starworks target')
  let snapshot = options.data.snapshotPath
    ? LegacySuperDraftSnapshotSchema.parse(
        JSON.parse(await fs.readFile(options.data.snapshotPath, 'utf8')),
      )
    : await extractLegacySuperDraftSnapshot(options.data.sourceDatabaseUrl!)

  let connection = createDatabase(targetDatabaseUrl, { max: 1 })
  try {
    let importer = new LegacySuperDraftImporter(connection.database)
    let result = await importer.import({
      actorPersonId: options.data.actorPersonId,
      apply: options.data.apply,
      leagueId: options.data.leagueId,
      snapshot,
    })
    console.log(JSON.stringify(result, null, 2))
  } finally {
    await connection.close()
  }
}

function readArguments(arguments_: string[]) {
  let values: Record<string, string | boolean | undefined> = { apply: false }
  for (let index = 0; index < arguments_.length; index += 1) {
    let key = arguments_[index]
    if (key === '--apply') {
      values.apply = true
      continue
    }
    let value = arguments_[index + 1]
    if (!key?.startsWith('--') || !value) continue
    values[key.slice(2)] = value
    index += 1
  }
  return {
    actorPersonId: values['actor-person-id'],
    apply: values.apply,
    leagueId: values['league-id'],
    snapshotPath: values.snapshot,
    sourceDatabaseUrl: values['source-database-url'] ?? process.env.LEGACY_DATABASE_URL,
  }
}
