import type { Cookie } from 'remix/cookie'
import { createContextKey, type Middleware } from 'remix/router'

import type { ConfigurationApplication } from '../configuration/service.ts'
import type { DraftApplication } from '../draft/service.ts'
import type { LeagueOperationsApplication } from '../league-operations/service.ts'
import type { RunnerControlApplication } from '../runner/control-service.ts'
import type { RunnerAdminApplication } from '../runner/admin-service.ts'
import type { TelemetryApplication } from '../telemetry/service.ts'
import type { IdentityService } from '../platform/identity-service.ts'
import type { SessionIdentity } from '../platform/model.ts'
import type { AppRuntime } from '../platform/runtime.ts'
import type { PlatformService } from '../platform/service.ts'
import { RequestLog } from './request-logging.ts'

export const Identity = createContextKey<SessionIdentity | null>(null)
export const Configuration = createContextKey<ConfigurationApplication>()
export const Draft = createContextKey<DraftApplication>()
export const IdentityServiceContext = createContextKey<IdentityService>()
export const LeagueOperations = createContextKey<LeagueOperationsApplication>()
export const OAuthCookie = createContextKey<Cookie>()
export const Platform = createContextKey<PlatformService>()
export const RunnerControl = createContextKey<RunnerControlApplication>()
export const RunnerAdmin = createContextKey<RunnerAdminApplication>()
export const SessionCookie = createContextKey<Cookie>()
export const Telemetry = createContextKey<TelemetryApplication>()

export function platform(
  resolveRuntime: () => AppRuntime,
): Middleware<
  [
    { key: typeof Configuration; value: ConfigurationApplication },
    { key: typeof Draft; value: DraftApplication },
    { key: typeof Identity; value: SessionIdentity | null; property: 'identity' },
    { key: typeof IdentityServiceContext; value: IdentityService },
    { key: typeof LeagueOperations; value: LeagueOperationsApplication },
    { key: typeof OAuthCookie; value: Cookie },
    { key: typeof Platform; value: PlatformService },
    { key: typeof RunnerControl; value: RunnerControlApplication },
    { key: typeof RunnerAdmin; value: RunnerAdminApplication },
    { key: typeof SessionCookie; value: Cookie },
    { key: typeof Telemetry; value: TelemetryApplication },
  ]
> {
  return async (context, next) => {
    let runtime = resolveRuntime()
    let rawSessionToken = await runtime.sessionCookie.parse(context.request.headers.get('cookie'))
    let identity = await runtime.platform.resolveSession(rawSessionToken)

    context.set(Configuration, runtime.configuration)
    context.set(Draft, runtime.draft)
    context.set(Identity, identity, { property: 'identity' })
    context.set(IdentityServiceContext, runtime.identity)
    context.set(LeagueOperations, runtime.leagueOperations)
    context.set(OAuthCookie, runtime.oauthCookie)
    context.set(Platform, runtime.platform)
    context.set(RunnerControl, runtime.runnerControl)
    context.set(RunnerAdmin, runtime.runnerAdmin)
    context.set(SessionCookie, runtime.sessionCookie)
    context.set(Telemetry, runtime.telemetry)
    if (identity) context.get(RequestLog)?.bind({ actorId: identity.personId })
    return next()
  }
}

export function sameOrigin(): Middleware {
  return async (context, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(context.method)) return next()
    let origin = context.request.headers.get('origin')
    let referer = context.request.headers.get('referer')
    let sourceOrigin = origin ?? (referer ? new URL(referer).origin : null)
    if (sourceOrigin && sourceOrigin !== context.url.origin) {
      return new Response('Cross-origin form submission rejected', { status: 403 })
    }
    return next()
  }
}
