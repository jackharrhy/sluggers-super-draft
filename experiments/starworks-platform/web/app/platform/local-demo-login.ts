import { z } from 'zod'

const localDemoConfigurationSchema = z.object({
  leagueSlug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  sessionToken: z.string().min(32),
})

export interface LocalDemoLoginConfiguration {
  leagueSlug: string
  sessionToken: string
}

export function readLocalDemoLoginConfiguration(
  environment: NodeJS.ProcessEnv,
): LocalDemoLoginConfiguration | null {
  if (environment.STARWORKS_DEMO_MODE !== 'local-only') return null
  return localDemoConfigurationSchema.parse({
    leagueSlug: environment.STARWORKS_DEMO_LEAGUE_SLUG,
    sessionToken: environment.STARWORKS_DEMO_SESSION_TOKEN,
  })
}

export function isLoopbackHostname(hostname: string): boolean {
  return hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '[::1]'
}
