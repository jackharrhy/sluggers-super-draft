import { createController } from 'remix/router'
import { redirect } from 'remix/response/redirect'
import type { RemixNode } from 'remix/ui'

import { Identity, Platform, RunnerAdmin } from '../../../middleware/platform.ts'
import { PlatformError } from '../../../platform/errors.ts'
import type { LeagueDetail, SessionIdentity } from '../../../platform/model.ts'
import type { RunnerAdminApplication } from '../../../runner/admin-service.ts'
import { routes } from '../../../routes.ts'
import { LeagueOperationsPage } from '../../../ui/league-operations-page.tsx'
import { MessagePage } from '../../../ui/message-page.tsx'

export default createController(routes.leagues.operations, {
  actions: {
    async dashboard(context) {
      let identity = context.get(Identity)
      let league = await context.get(Platform).viewLeague(context.params.leagueSlug, identity)
      if (!league) return notFound(context)
      context.structuredLog.bind({ leagueId: league.id })
      try {
        let dashboard = await context.get(RunnerAdmin).dashboard(identity, league.id)
        return context.render(<LeagueOperationsPage dashboard={dashboard} identity={identity!} league={league} />)
      } catch (error) {
        return operationsError(context, error)
      }
    },
    async scheduleMatch(context) {
      let identity = context.get(Identity)
      let league = await context.get(Platform).viewLeague(context.params.leagueSlug, identity)
      if (!league) return notFound(context)
      try {
        let data = context.get(FormData)
        let scheduledValue = readString(data, 'scheduledAt', false)
        let scheduledAt = scheduledValue ? new Date(scheduledValue) : null
        if (scheduledAt && Number.isNaN(scheduledAt.getTime())) throw new PlatformError('Scheduled time is invalid', 'invalid_input')
        await context.get(RunnerAdmin).scheduleMatch(identity, league.id, {
          awayTeamId: readString(data, 'awayTeamId'),
          homeTeamId: readString(data, 'homeTeamId'),
          scheduledAt,
          seasonId: readString(data, 'seasonId'),
        })
        return redirect(routes.leagues.operations.dashboard.href({ leagueSlug: league.slug }), 303)
      } catch (error) {
        return renderDashboardError(context, identity, league, error)
      }
    },
    async queueAttempt(context) {
      let identity = context.get(Identity)
      let league = await context.get(Platform).viewLeague(context.params.leagueSlug, identity)
      if (!league) return notFound(context)
      try {
        let data = context.get(FormData)
        await context.get(RunnerAdmin).queueAttempt(identity, league.id, context.params.matchId, {
          awayLineupRevisionId: readString(data, 'awayLineupRevisionId'),
          dynamicRuleOverrides: readJsonObject(data, 'dynamicRuleOverrides'),
          homeLineupRevisionId: readString(data, 'homeLineupRevisionId'),
          requiredGameBuildSha256: readString(data, 'requiredGameBuildSha256'),
          rulesetRevisionId: readString(data, 'rulesetRevisionId'),
          statProfileRevisionId: readString(data, 'statProfileRevisionId'),
        })
        return redirect(routes.leagues.operations.dashboard.href({ leagueSlug: league.slug }), 303)
      } catch (error) {
        return renderDashboardError(context, identity, league, error)
      }
    },
    async issueCredential(context) {
      let identity = context.get(Identity)
      let league = await context.get(Platform).viewLeague(context.params.leagueSlug, identity)
      if (!league) return notFound(context)
      try {
        let issued = await context.get(Platform).issueRunnerCredential(identity, league.id, {
          name: readString(context.get(FormData), 'name'),
          scopes: ['artifacts:read', 'heartbeat:write', 'runs:claim', 'runs:read', 'telemetry:write'],
        })
        let dashboard = await context.get(RunnerAdmin).dashboard(identity, league.id)
        return context.render(
          <LeagueOperationsPage dashboard={dashboard} identity={identity!} league={league} oneTimeCredential={issued.credential} />,
          { status: 201 },
        )
      } catch (error) {
        return renderDashboardError(context, identity, league, error)
      }
    },
    async revokeStation(context) {
      let identity = context.get(Identity)
      let league = await context.get(Platform).viewLeague(context.params.leagueSlug, identity)
      if (!league) return notFound(context)
      try {
        await context.get(RunnerAdmin).revokeStation(identity, league.id, context.params.stationId)
        return redirect(routes.leagues.operations.dashboard.href({ leagueSlug: league.slug }), 303)
      } catch (error) {
        return renderDashboardError(context, identity, league, error)
      }
    },
  },
})

async function renderDashboardError(
  context: OperationsRenderContext,
  identity: SessionIdentity | null,
  league: LeagueDetail,
  error: unknown,
) {
  let dashboard = await context.get(RunnerAdmin).dashboard(identity, league.id)
  let message = error instanceof PlatformError ? error.message : 'The match operation could not be completed.'
  let status = error instanceof PlatformError && error.code === 'forbidden' ? 403 : 400
  return context.render(<LeagueOperationsPage dashboard={dashboard} error={message} identity={identity!} league={league} />, { status })
}

function readString(data: FormData, name: string, required = true): string {
  let value = String(data.get(name) ?? '').trim()
  if (required && !value) throw new PlatformError(`${name} is required`, 'invalid_input')
  return value
}

function readJsonObject(data: FormData, name: string): Record<string, string | number | boolean | null> {
  try {
    let value: unknown = JSON.parse(readString(data, name))
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('not an object')
    return value as Record<string, string | number | boolean | null>
  } catch {
    throw new PlatformError('Dynamic rule overrides must be a JSON object', 'invalid_input')
  }
}

function operationsError(context: { render(node: RemixNode, init?: ResponseInit): Response }, error: unknown) {
  let message = error instanceof PlatformError ? error.message : 'League operations are unavailable.'
  let status = error instanceof PlatformError && error.code === 'forbidden' ? 403 : 400
  return context.render(<MessagePage heading="League operations unavailable" message={message} />, { status })
}

function notFound(context: { render(node: RemixNode, init?: ResponseInit): Response }) {
  return context.render(<MessagePage heading="League not found" message="This league is private or does not exist." />, { status: 404 })
}

interface OperationsRenderContext {
  get(key: typeof RunnerAdmin): RunnerAdminApplication
  render(node: RemixNode, init?: ResponseInit): Response
}
