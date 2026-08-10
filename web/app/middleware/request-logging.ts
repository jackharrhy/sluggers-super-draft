import { randomUUID } from 'node:crypto'

import { createContextKey, type Middleware } from 'remix/router'

export interface RequestIdentifiers {
  actorId: string | null
  correlationId: string
  leagueId: string | null
  matchAttemptId: string | null
  runnerId: string | null
}

export interface StructuredLoggingOptions {
  clock?: () => Date
  createCorrelationId?: () => string
  sink?: (line: string) => void
}

type BoundIdentifiers = Omit<RequestIdentifiers, 'correlationId'>
type LogFields = Record<string, unknown>

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export class StructuredLogger {
  readonly #clock: () => Date
  readonly #sink: (line: string) => void
  readonly #identifiers: RequestIdentifiers

  constructor(
    identifiers: RequestIdentifiers,
    { clock = () => new Date(), sink = console.log }: StructuredLoggingOptions = {},
  ) {
    this.#clock = clock
    this.#sink = sink
    this.#identifiers = identifiers
  }

  bind(identifiers: Partial<BoundIdentifiers>): void {
    Object.assign(this.#identifiers, identifiers)
  }

  info(event: string, fields: LogFields = {}): void {
    this.#write('info', event, fields)
  }

  error(event: string, error: unknown, fields: LogFields = {}): void {
    this.#write('error', event, {
      ...fields,
      error: serializeError(error),
    })
  }

  #write(level: 'error' | 'info', event: string, fields: LogFields): void {
    this.#sink(
      JSON.stringify({
        ...fields,
        timestamp: this.#clock().toISOString(),
        level,
        event,
        ...this.#identifiers,
      }),
    )
  }
}

export const RequestLog = createContextKey<StructuredLogger>()

export function requestLogging(
  options: StructuredLoggingOptions = {},
): Middleware<{
  key: typeof RequestLog
  value: StructuredLogger
  property: 'structuredLog'
}> {
  let { createCorrelationId = randomUUID } = options

  return async (context, next) => {
    let correlationId = resolveCorrelationId(
      context.request.headers.get('x-correlation-id'),
      createCorrelationId,
    )
    let log = new StructuredLogger(
      {
        actorId: null,
        correlationId,
        leagueId: null,
        matchAttemptId: null,
        runnerId: null,
      },
      options,
    )
    context.set(RequestLog, log, { property: 'structuredLog' })

    let startedAt = performance.now()
    try {
      let response = await next()
      let durationMs = Math.round((performance.now() - startedAt) * 100) / 100
      log.info('http.request.completed', {
        durationMs,
        method: context.request.method,
        path: context.url.pathname,
        status: response.status,
      })

      let headers = new Headers(response.headers)
      headers.set('x-correlation-id', correlationId)
      return new Response(response.body, {
        headers,
        status: response.status,
        statusText: response.statusText,
      })
    } catch (error) {
      log.error('http.request.failed', error, {
        durationMs: Math.round((performance.now() - startedAt) * 100) / 100,
        method: context.request.method,
        path: context.url.pathname,
      })
      throw error
    }
  }
}

function resolveCorrelationId(
  candidate: string | null,
  createCorrelationId: () => string,
): string {
  return candidate && UUID_PATTERN.test(candidate)
    ? candidate.toLowerCase()
    : createCorrelationId()
}

function serializeError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return {
      message: error.message,
      name: error.name,
      stack: error.stack,
    }
  }
  return { message: String(error), name: 'UnknownError' }
}
