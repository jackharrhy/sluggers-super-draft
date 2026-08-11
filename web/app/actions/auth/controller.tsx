import { createController } from 'remix/router'
import { redirect } from 'remix/response/redirect'
import type { RemixNode } from 'remix/ui'

import {
  IdentityServiceContext,
  LocalDemoLogin,
  OAuthCookie,
  Platform,
  SessionCookie,
} from '../../middleware/platform.ts'
import { PlatformError } from '../../platform/errors.ts'
import { isLoopbackHostname } from '../../platform/local-demo-login.ts'
import { routes } from '../../routes.ts'
import { MessagePage } from '../../ui/message-page.tsx'

export default createController(routes.auth, {
  actions: {
    async discord(context) {
      try {
        let start = await context.get(IdentityServiceContext).beginDiscordLogin({
          invitationToken: context.url.searchParams.get('invite'),
          returnTo: context.url.searchParams.get('returnTo'),
        })
        let transactionCookie = await context
          .get(OAuthCookie)
          .serialize(start.transactionToken, { expires: start.transactionExpiresAt })
        return redirect(start.authorizationUrl, {
          headers: { 'set-cookie': transactionCookie },
          status: 302,
        })
      } catch (error) {
        return renderAuthError(context, error)
      }
    },
    async discordCallback(context) {
      let oauthCookie = context.get(OAuthCookie)
      let transactionToken = await oauthCookie.parse(context.request.headers.get('cookie'))
      try {
        let login = await context.get(IdentityServiceContext).completeDiscordLogin({
          code: context.url.searchParams.get('code'),
          state: context.url.searchParams.get('state'),
          transactionToken,
        })
        let headers = new Headers()
        headers.append(
          'set-cookie',
          await context
            .get(SessionCookie)
            .serialize(login.sessionToken, { expires: login.sessionExpiresAt }),
        )
        headers.append('set-cookie', await oauthCookie.serialize('', { maxAge: 0 }))
        return redirect(login.returnTo, { headers, status: 303 })
      } catch (error) {
        return renderAuthError(context, error, {
          'set-cookie': await oauthCookie.serialize('', { maxAge: 0 }),
        })
      }
    },
    async localDemo(context) {
      let configuration = context.get(LocalDemoLogin)
      if (!configuration || !isLoopbackHostname(context.url.hostname)) {
        return new Response('Not Found', { status: 404 })
      }
      let identity = await context.get(Platform).resolveSession(configuration.sessionToken)
      if (!identity) {
        return context.render(
          <MessagePage
            heading="Local demo needs reseeding"
            message="Run npm run demo:seed and restart the local web service with .starworks/demo.env."
          />,
          { status: 503 },
        )
      }
      let sessionCookie = context.get(SessionCookie)
      return redirect(
        routes.leagues.operations.dashboard.href({
          leagueSlug: configuration.leagueSlug,
        }),
        {
          headers: {
            // The demo is deliberately limited to loopback, where local Compose is
            // served over plain HTTP even though the container uses NODE_ENV=production.
            'set-cookie': await sessionCookie.serialize(configuration.sessionToken, {
              secure: false,
            }),
          },
          status: 302,
        },
      )
    },
    async logout(context) {
      let sessionCookie = context.get(SessionCookie)
      let rawSession = await sessionCookie.parse(context.request.headers.get('cookie'))
      await context.get(Platform).revokeSession(rawSession)
      return redirect(routes.home.href(), {
        headers: { 'set-cookie': await sessionCookie.serialize('', { maxAge: 0 }) },
        status: 303,
      })
    },
  },
})

function renderAuthError(
  context: { render(node: RemixNode, init?: ResponseInit): Response },
  error: unknown,
  headers?: HeadersInit,
) {
  let message = 'Discord login is not configured or temporarily unavailable.'
  let status = 503
  if (error instanceof PlatformError) {
    message = error.message
    status = error.code === 'invalid_input' ? 400 : 401
  }
  return context.render(
    <MessagePage heading="Discord sign-in unavailable" message={message} />,
    { headers, status },
  )
}
