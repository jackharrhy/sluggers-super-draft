import { createRouter, type MiddlewareContext } from 'remix/router'
import { staticFiles } from 'remix/middleware/static'
import { formData } from 'remix/middleware/form-data'

import controller from './actions/controller.tsx'
import adminController from './actions/admin/controller.tsx'
import authController from './actions/auth/controller.tsx'
import leaguesController from './actions/leagues/controller.tsx'
import leagueConfigurationController from './actions/leagues/configuration/controller.tsx'
import statProfilesController from './actions/leagues/configuration/stat-profiles/controller.tsx'
import statProfileRevisionController from './actions/leagues/configuration/stat-profiles/revision/controller.tsx'
import statProfileCharacterController from './actions/leagues/configuration/stat-profiles/revision/character/controller.tsx'
import statProfileTuningController from './actions/leagues/configuration/stat-profiles/revision/tuning/controller.tsx'
import rulesetsController from './actions/leagues/configuration/rulesets/controller.tsx'
import rulesetRevisionController from './actions/leagues/configuration/rulesets/revision/controller.tsx'
import teamsConfigurationController from './actions/leagues/configuration/teams/controller.tsx'
import teamLineupController from './actions/leagues/configuration/teams/lineup/controller.tsx'
import leagueContentController from './actions/leagues/content/controller.tsx'
import runnerController from './actions/runner-api/controller.tsx'
import leagueAdminController from './actions/leagues/operations/admin/controller.tsx'
import leagueMatchesController from './actions/leagues/operations/matches/controller.tsx'
import leagueResultsController from './actions/leagues/operations/results/controller.tsx'
import leagueTeamsController from './actions/leagues/operations/teams/controller.tsx'
import leagueDraftsController from './actions/leagues/drafts/controller.tsx'
import systemController from './actions/system/controller.ts'
import { platform, sameOrigin } from './middleware/platform.ts'
import { render } from './middleware/render.tsx'
import {
  requestLogging,
  type StructuredLoggingOptions,
} from './middleware/request-logging.ts'
import { routes } from './routes.ts'
import { getAppRuntime, type AppRuntime } from './platform/runtime.ts'

type AppContext = MiddlewareContext<
  [
    ReturnType<typeof requestLogging>,
    ReturnType<typeof platform>,
    ReturnType<typeof sameOrigin>,
    ReturnType<typeof formData>,
    ReturnType<typeof render>,
  ]
>

declare module 'remix/router' {
  interface RouterTypes {
    context: AppContext
  }
}

export interface AppRouterOptions {
  logging?: StructuredLoggingOptions
  runtime?: AppRuntime
}

export function createAppRouter(options: AppRouterOptions = {}) {
  let router = createRouter<AppContext>({
    middleware: [
      staticFiles('./public', { index: false }),
      requestLogging(options.logging),
      platform(() => options.runtime ?? getAppRuntime()),
      sameOrigin(),
      formData(),
      render(),
    ],
  })

  router.map(routes, controller)
  router.map(routes.admin, adminController)
  router.map(routes.auth, authController)
  router.map(routes.leagues, leaguesController)
  router.map(routes.leagues.configuration, leagueConfigurationController)
  router.map(routes.leagues.configuration.statProfiles, statProfilesController)
  router.map(routes.leagues.configuration.statProfiles.revision, statProfileRevisionController)
  router.map(routes.leagues.configuration.statProfiles.revision.character, statProfileCharacterController)
  router.map(routes.leagues.configuration.statProfiles.revision.tuning, statProfileTuningController)
  router.map(routes.leagues.configuration.rulesets, rulesetsController)
  router.map(routes.leagues.configuration.rulesets.revision, rulesetRevisionController)
  router.map(routes.leagues.configuration.teams, teamsConfigurationController)
  router.map(routes.leagues.configuration.teams.lineup, teamLineupController)
  router.map(routes.leagues.content, leagueContentController)
  router.map(routes.leagues.operations.admin, leagueAdminController)
  router.map(routes.leagues.operations.matches, leagueMatchesController)
  router.map(routes.leagues.operations.results, leagueResultsController)
  router.map(routes.leagues.operations.teams, leagueTeamsController)
  router.map(routes.leagues.drafts, leagueDraftsController)
  router.map(routes.runnerApi, runnerController)
  router.map(routes.system, systemController)
  return router
}

export const router = createAppRouter()
