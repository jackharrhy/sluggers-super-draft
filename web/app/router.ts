import { createRouter, type MiddlewareContext } from 'remix/router'
import { staticFiles } from 'remix/middleware/static'
import { formData } from 'remix/middleware/form-data'

import controller from './actions/controller.tsx'
import adminController from './actions/admin/controller.tsx'
import authController from './actions/auth/controller.tsx'
import leaguesController from './actions/leagues/controller.tsx'
import leagueConfigurationController from './actions/leagues/configuration/controller.tsx'
import runnerController from './actions/runner-api/controller.tsx'
import leagueOperationsController from './actions/leagues/operations/controller.tsx'
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
  router.map(routes.leagues.operations, leagueOperationsController)
  router.map(routes.runnerApi, runnerController)
  return router
}

export const router = createAppRouter()
