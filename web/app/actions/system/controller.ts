import { createController } from 'remix/router'

import { Operations } from '../../middleware/platform.ts'
import { routes } from '../../routes.ts'

const JSON_HEADERS = {
  'cache-control': 'no-store',
  'content-type': 'application/json; charset=utf-8',
  'x-content-type-options': 'nosniff',
}

export default createController(routes.system, {
  actions: {
    health() {
      return Response.json({ status: 'ok' }, { headers: JSON_HEADERS })
    },
    async metrics(context) {
      let operations = context.get(Operations)
      if (!operations.authorizeMetrics(context.request.headers.get('authorization'))) {
        return new Response('Not Found', {
          headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' },
          status: 404,
        })
      }
      return new Response(await operations.metrics(), {
        headers: {
          'cache-control': 'no-store',
          'content-type': 'text/plain; version=0.0.4; charset=utf-8',
          'x-content-type-options': 'nosniff',
        },
      })
    },
    async ready(context) {
      let report = await context.get(Operations).readiness()
      return Response.json(report, {
        headers: JSON_HEADERS,
        status: report.status === 'ready' ? 200 : 503,
      })
    },
  },
})
