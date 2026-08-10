import { createController } from 'remix/router'

import { assetServer } from '../assets.ts'
import { routes } from '../routes.ts'
import { Identity, Platform } from '../middleware/platform.ts'
import { HomePage } from '../ui/home-page.tsx'

export default createController(routes, {
  actions: {
    async assets(context) {
      return (
        (await assetServer.fetch(context.request)) ?? new Response('Not Found', { status: 404 })
      )
    },
    async home(context) {
      let identity = context.get(Identity)
      let leagues = await context.get(Platform).listVisibleLeagues(identity)
      return context.render(<HomePage identity={identity} leagues={leagues} />)
    },
  },
})
