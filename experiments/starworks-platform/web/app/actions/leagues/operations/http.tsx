import { Renderer as RendererKey, type Renderer } from 'remix/middleware/render'
import { createContextKey, type Middleware } from 'remix/router'
import type { RemixNode } from 'remix/ui'

import { Identity, Platform } from '../../../middleware/platform.ts'
import { RequestLog } from '../../../middleware/request-logging.ts'
import { PlatformError } from '../../../platform/errors.ts'
import type { LeagueDetail, SessionIdentity } from '../../../platform/model.ts'
import { MessagePage } from '../../../ui/message-page.tsx'

export const OperationsActor = createContextKey<SessionIdentity>()
export const OperationsLeague = createContextKey<LeagueDetail>()

export function operationsLeague(): Middleware<[
  { key: typeof OperationsActor; value: SessionIdentity },
  { key: typeof OperationsLeague; value: LeagueDetail },
]> {
  return async (context, next) => {
    let identity = context.get(Identity)
    if (!identity) {
      return renderMessage(
        context.get(RendererKey),
        <MessagePage heading="League unavailable" message="Sign in to open this league." />,
        { status: 401 },
      )
    }
    let platform = context.get(Platform)
    if (!platform) throw new Error('Platform middleware did not provide the platform service')
    let league = await platform.viewLeague(context.params.leagueSlug, identity)
    if (!league) {
      return renderMessage(
        context.get(RendererKey),
        <MessagePage heading="League not found" message="This league is private or does not exist." />,
        { status: 404 },
      )
    }
    context.set(OperationsActor, identity)
    context.set(OperationsLeague, league)
    context.get(RequestLog)?.bind({ leagueId: league.id })
    return next()
  }
}

export function readString(data: FormData, name: string, required = true): string {
  let value = data.get(name)
  if (typeof value !== 'string') {
    if (!required) return ''
    throw new PlatformError(`${name} is required`, 'invalid_input')
  }
  if (required && !value.trim()) {
    throw new PlatformError(`${name} is required`, 'invalid_input')
  }
  return value.trim()
}

export function readCharacterList(data: FormData, name: string): string[] {
  let values = data.getAll(name)
    .flatMap((value) => String(value).split(/[\n,]/))
    .map((value) => value.trim())
    .filter(Boolean)
  if (!values.length) throw new PlatformError(`${name} is required`, 'invalid_input')
  return values
}

export function renderOperationsError(
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
  return context.render(<MessagePage heading="League operation unavailable" message={error.message} />, { status })
}

function renderMessage(renderer: unknown, node: RemixNode, init: ResponseInit): Response | Promise<Response> {
  if (!isRemixRenderer(renderer)) return new Response('League unavailable', init)
  return renderer(node, init)
}

function isRemixRenderer(value: unknown): value is Renderer<RemixNode> {
  return typeof value === 'function'
}
