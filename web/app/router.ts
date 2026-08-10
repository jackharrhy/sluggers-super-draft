import { createRouter, type MiddlewareContext } from 'remix/router'
import { staticFiles } from 'remix/middleware/static'

import controller from './actions/controller.tsx'
import { render } from './middleware/render.tsx'
import {
  requestLogging,
  type StructuredLoggingOptions,
} from './middleware/request-logging.ts'
import { routes } from './routes.ts'

type AppContext = MiddlewareContext<
  [ReturnType<typeof requestLogging>, ReturnType<typeof render>]
>

declare module 'remix/router' {
  interface RouterTypes {
    context: AppContext
  }
}

export interface AppRouterOptions {
  logging?: StructuredLoggingOptions
}

export function createAppRouter(options: AppRouterOptions = {}) {
  let router = createRouter<AppContext>({
    middleware: [
      staticFiles('./public', { index: false }),
      requestLogging(options.logging),
      render(),
    ],
  })

  router.map(routes, controller)
  return router
}

export const router = createAppRouter()
