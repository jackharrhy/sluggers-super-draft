import { createContextKey, type Middleware } from 'remix/router'
import { Renderer as RendererKey, type Renderer } from 'remix/middleware/render'
import type { RemixNode } from 'remix/ui'
import { Identity, Platform } from '../../../middleware/platform.ts'
import { RequestLog } from '../../../middleware/request-logging.ts'
import { PlatformError } from '../../../platform/errors.ts'
import type { LeagueDetail, SessionIdentity } from '../../../platform/model.ts'
import { MessagePage } from '../../../ui/message-page.tsx'

export const ConfigurationActor = createContextKey<SessionIdentity>()
export const ConfigurationLeague = createContextKey<LeagueDetail>()

export function configurationLeague(): Middleware<[
  { key: typeof ConfigurationActor; value: SessionIdentity },
  { key: typeof ConfigurationLeague; value: LeagueDetail },
]> {
  return async (context, next) => {
    let identity = context.get(Identity)
    if (!identity) {
      return renderMessage(context.get(RendererKey),
        <MessagePage heading="Configuration unavailable" message="Sign in to manage league configuration." />,
        { status: 401 },
      )
    }
    let platform = context.get(Platform)
    if (!platform) throw new Error('Platform middleware did not provide the platform service')
    let league = await platform.viewLeague(context.params.leagueSlug, identity)
    if (!league) {
      return renderMessage(context.get(RendererKey),
        <MessagePage heading="League not found" message="This league is private or does not exist." />,
        { status: 404 },
      )
    }
    context.set(ConfigurationActor, identity)
    context.set(ConfigurationLeague, league)
    context.get(RequestLog)?.bind({ leagueId: league.id })
    return next()
  }
}

function renderMessage(renderer: unknown, node: RemixNode, init: ResponseInit): Response | Promise<Response> {
  if (!isRemixRenderer(renderer)) return new Response('Configuration unavailable', init)
  return renderer(node, init)
}

function isRemixRenderer(value: unknown): value is Renderer<RemixNode> {
  return typeof value === 'function'
}

export function readString(data: FormData, name: string): string {
  let value = data.get(name)
  if (typeof value !== 'string' || !value.trim()) {
    throw new PlatformError(`${name} is required`, 'invalid_input')
  }
  return value.trim()
}

export function readJsonValue(data: FormData, name: string): unknown {
  let raw = readString(data, name)
  try {
    return JSON.parse(raw)
  } catch {
    throw new PlatformError(`${name} must be valid JSON`, 'invalid_input')
  }
}

export function renderConfigurationError(
  context: { render(node: RemixNode, init?: ResponseInit): Response },
  error: unknown,
): Response {
  if (!(error instanceof PlatformError)) throw error
  let status = error.code === 'unauthorized'
    ? 401
    : error.code === 'forbidden'
      ? 403
      : error.code === 'not_found'
        ? 404
        : error.code === 'conflict'
          ? 409
          : 400
  return context.render(<MessagePage heading="Configuration unavailable" message={error.message} />, { status })
}
