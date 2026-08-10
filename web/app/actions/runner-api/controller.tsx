import { createController } from 'remix/router'

import { RunnerControl, Telemetry } from '../../middleware/platform.ts'
import { RequestLog, type StructuredLogger } from '../../middleware/request-logging.ts'
import { PlatformError } from '../../platform/errors.ts'
import { routes } from '../../routes.ts'

export default createController(routes.runnerApi, {
  actions: {
    async register(context) {
      return handle(async () => {
        let response = await context.get(RunnerControl).register(
          readBearerCredential(context.request),
          await readJson(context.request),
        )
        context.get(RequestLog)?.bind({ runnerId: response.runnerId })
        return json(response, 201)
      })
    },
    async heartbeat(context) {
      return handle(async () => {
        let body = await readJson(context.request)
        bindRunnerIdentifiers(context.get(RequestLog), body)
        return json(await context.get(RunnerControl).heartbeat(
          readBearerCredential(context.request),
          body,
        ))
      })
    },
    async claim(context) {
      return handle(async () => {
        let body = await readJson(context.request)
        bindRunnerIdentifiers(context.get(RequestLog), body)
        let response = await context.get(RunnerControl).claim(
          readBearerCredential(context.request),
          body,
        )
        if (response.run) {
          context.get(RequestLog)?.bind({
            leagueId: response.run.leagueId,
            matchAttemptId: response.run.attemptId,
            runnerId: response.run.lease.runnerId,
          })
        }
        return json(response)
      })
    },
    async configuration(context) {
      return handle(async () => {
        let response = await context.get(RunnerControl).configuration(
          readBearerCredential(context.request),
          context.params.attemptId,
        )
        context.get(RequestLog)?.bind({
          leagueId: response.leagueId,
          matchAttemptId: response.attemptId,
        })
        return json(response)
      })
    },
    async updateLease(context) {
      return handle(async () => {
        let body = await readJson(context.request)
        if (!isRecord(body) || body.leaseId !== context.params.leaseId) {
          throw new PlatformError('Lease URL and message do not match', 'invalid_input')
        }
        bindRunnerIdentifiers(context.get(RequestLog), body)
        return json(await context.get(RunnerControl).updateLease(
          readBearerCredential(context.request),
          body,
        ))
      })
    },
    async telemetry(context) {
      return handle(async () => {
        let body = await readJson(context.request)
        if (!isRecord(body) || body.attemptId !== context.params.attemptId) {
          throw new PlatformError('Telemetry URL and message do not match', 'invalid_input')
        }
        bindRunnerIdentifiers(context.get(RequestLog), body)
        return json(await context.get(Telemetry).ingest(
          readBearerCredential(context.request),
          body,
        ))
      })
    },
  },
})

async function handle(action: () => Promise<Response>): Promise<Response> {
  try {
    return await action()
  } catch (error) {
    if (!(error instanceof PlatformError)) throw error
    let status = {
      conflict: 409,
      forbidden: 403,
      invalid_input: 400,
      not_found: 404,
      registration_closed: 403,
      unauthorized: 401,
    }[error.code]
    let headers: Record<string, string> = {}
    if (status === 401) headers['www-authenticate'] = 'Bearer realm="Starworks runner"'
    return json({ error: { code: error.code, message: error.message } }, status, headers)
  }
}

function json(value: unknown, status = 200, additionalHeaders: Record<string, string> = {}): Response {
  return Response.json(value, {
    headers: { 'cache-control': 'no-store', ...additionalHeaders },
    status,
  })
}

async function readJson(request: Request): Promise<unknown> {
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
    throw new PlatformError('Runner API requires application/json', 'invalid_input')
  }
  try {
    return await request.json()
  } catch {
    throw new PlatformError('Runner API request body is not valid JSON', 'invalid_input')
  }
}

function readBearerCredential(request: Request): string {
  let authorization = request.headers.get('authorization')
  let match = /^Bearer\s+(.+)$/i.exec(authorization ?? '')
  if (!match) throw new PlatformError('Runner bearer credential is required', 'unauthorized')
  return match[1]!
}

function bindRunnerIdentifiers(log: StructuredLogger | undefined, body: unknown): void {
  if (!log || !isRecord(body)) return
  log.bind({
    matchAttemptId: typeof body.attemptId === 'string' ? body.attemptId : undefined,
    runnerId: typeof body.runnerId === 'string' ? body.runnerId : undefined,
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
