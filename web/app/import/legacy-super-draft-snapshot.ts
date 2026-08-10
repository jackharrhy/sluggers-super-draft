import { z } from 'zod'

export const LegacySuperDraftSnapshotSchema = z.object({
  conferences: z.array(
    z.object({
      color: z.string().nullable(),
      name: z.string().min(1),
      seasonSourceId: z.string().min(1),
      sourceId: z.string().min(1),
    }),
  ),
  format: z.literal('starworks.legacy-super-draft-snapshot.v1'),
  season: z.object({
    sourceId: z.string().min(1),
    state: z.enum(['pre-season', 'drafting', 'playing', 'finished']),
  }),
  teams: z.array(
    z.object({
      abbreviation: z.string().min(1),
      color: z.string().nullable(),
      conferenceSourceId: z.string().nullable(),
      managerUserSourceId: z.string().min(1),
      name: z.string().min(1),
      sourceId: z.string().min(1),
    }),
  ),
  users: z.array(
    z.object({
      discordSnowflake: z.string().regex(/^\d+$/),
      name: z.string().min(1),
      role: z.enum(['admin', 'user']),
      sourceId: z.string().min(1),
    }),
  ),
  venues: z.array(
    z.object({
      name: z.string().min(1),
      sourceId: z.string().min(1),
    }),
  ),
})

export type LegacySuperDraftSnapshot = z.infer<typeof LegacySuperDraftSnapshotSchema>
