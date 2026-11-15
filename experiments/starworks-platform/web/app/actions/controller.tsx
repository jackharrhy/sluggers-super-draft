import { createController } from 'remix/router'

import { assetServer } from '../assets.ts'
import { routes } from '../routes.ts'
import { Broadcast, Identity, Platform } from '../middleware/platform.ts'
import { HomePage } from '../ui/home-page.tsx'
import { BroadcastOverlayPage } from '../ui/broadcast-overlay-page.tsx'
import { DevKitchenSinkPage } from '../ui/dev-kitchen-sink-page.tsx'
import { PlatformError } from '../platform/errors.ts'
import { isLoopbackHostname } from '../platform/local-demo-login.ts'

export default createController(routes, {
  actions: {
    async assets(context) {
      return (
        (await assetServer.fetch(context.request)) ?? new Response('Not Found', { status: 404 })
      )
    },
    async broadcastData(context) {
      try {
        let overlay = await context.get(Broadcast).publicOverlay(context.params.leagueSlug, context.params.matchId)
        return Response.json(overlay, {
          headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' },
        })
      } catch (error) {
        let status = error instanceof PlatformError && error.code === 'not_found' ? 404 : 500
        return Response.json({ error: status === 404 ? 'Overlay not found' : 'Overlay unavailable' }, { status })
      }
    },
    async broadcastOverlay(context) {
      try {
        let overlay = await context.get(Broadcast).publicOverlay(context.params.leagueSlug, context.params.matchId)
        return context.render(<BroadcastOverlayPage overlay={overlay} />)
      } catch (error) {
        let status = error instanceof PlatformError && error.code === 'not_found' ? 404 : 500
        return new Response(status === 404 ? 'Overlay not found' : 'Overlay unavailable', { status })
      }
    },
    async devKitchenSink(context) {
      if (!developmentUiEnabled(process.env, context.url.hostname)) return new Response('Not Found', { status: 404 })
      return context.render(<DevKitchenSinkPage />)
    },
    async home(context) {
      let identity = context.get(Identity)
      let leagues = await context.get(Platform).listVisibleLeagues(identity)
      return context.render(<HomePage identity={identity} leagues={leagues} />)
    },
  },
})

function developmentUiEnabled(environment: NodeJS.ProcessEnv, hostname: string): boolean {
  return environment.NODE_ENV !== 'production'
    || (environment.STARWORKS_DEV_UI === 'local-only' && isLoopbackHostname(hostname))
}
