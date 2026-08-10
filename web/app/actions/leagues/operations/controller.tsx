import { createController } from 'remix/router'
import { redirect } from 'remix/response/redirect'
import type { RemixNode } from 'remix/ui'

import { Identity, LeagueOperations, Platform, RunnerAdmin, Telemetry } from '../../../middleware/platform.ts'
import type { LeagueOperationsApplication } from '../../../league-operations/service.ts'
import { PlatformError } from '../../../platform/errors.ts'
import type { LeagueDetail, SessionIdentity } from '../../../platform/model.ts'
import { administrativeRoles } from '../../../platform/repository.ts'
import type { RunnerAdminApplication } from '../../../runner/admin-service.ts'
import type { TelemetryApplication } from '../../../telemetry/service.ts'
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
        let dashboards = await loadDashboards(
          identity,
          league,
          context.get(RunnerAdmin),
          context.get(LeagueOperations),
          context.get(Telemetry),
        )
        return context.render(<LeagueOperationsPage {...dashboards} identity={identity!} league={league} />)
      } catch (error) {
        return operationsError(context, error)
      }
    },
    async setDeadline(context) {
      let identity = context.get(Identity)
      let league = await context.get(Platform).viewLeague(context.params.leagueSlug, identity)
      if (!league) return notFound(context)
      try {
        let data = context.get(FormData)
        let closesAt = new Date(readString(data, 'closesAt'))
        if (Number.isNaN(closesAt.getTime())) throw new PlatformError('Deadline time is invalid', 'invalid_input')
        let kind = readString(data, 'kind')
        if (!['trade', 'roster', 'lineup'].includes(kind)) throw new PlatformError('Deadline kind is invalid', 'invalid_input')
        await context.get(LeagueOperations).setDeadline(identity, league.id, {
          closesAt,
          kind: kind as 'trade' | 'roster' | 'lineup',
          note: readString(data, 'note', false) || null,
          seasonId: readString(data, 'seasonId'),
        })
        return operationsRedirect(league)
      } catch (error) {
        return renderDashboardError(renderContext(context), identity, league, error)
      }
    },
    async proposeTrade(context) {
      let identity = context.get(Identity)
      let league = await context.get(Platform).viewLeague(context.params.leagueSlug, identity)
      if (!league) return notFound(context)
      try {
        let data = context.get(FormData)
        await context.get(LeagueOperations).proposeTrade(identity, league.id, {
          counterpartyCharacterIds: readCharacterList(data, 'counterpartyCharacterIds'),
          counterpartyTeamId: readString(data, 'counterpartyTeamId'),
          message: readString(data, 'message', false) || null,
          proposerCharacterIds: readCharacterList(data, 'proposerCharacterIds'),
          proposerTeamId: readString(data, 'proposerTeamId'),
          seasonId: readString(data, 'seasonId'),
        })
        return operationsRedirect(league)
      } catch (error) {
        return renderDashboardError(renderContext(context), identity, league, error)
      }
    },
    async reviewTrade(context) {
      let identity = context.get(Identity)
      let league = await context.get(Platform).viewLeague(context.params.leagueSlug, identity)
      if (!league) return notFound(context)
      try {
        let data = context.get(FormData)
        let decision = readString(data, 'decision')
        if (decision !== 'approved' && decision !== 'rejected') throw new PlatformError('Trade decision is invalid', 'invalid_input')
        await context.get(LeagueOperations).reviewTrade(identity, league.id, context.params.proposalId, {
          decision,
          reason: readString(data, 'reason', false) || null,
        })
        return operationsRedirect(league)
      } catch (error) {
        return renderDashboardError(renderContext(context), identity, league, error)
      }
    },
    async cancelTrade(context) {
      let identity = context.get(Identity)
      let league = await context.get(Platform).viewLeague(context.params.leagueSlug, identity)
      if (!league) return notFound(context)
      try {
        await context.get(LeagueOperations).cancelTrade(identity, league.id, context.params.proposalId)
        return operationsRedirect(league)
      } catch (error) {
        return renderDashboardError(renderContext(context), identity, league, error)
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
        return renderDashboardError(renderContext(context), identity, league, error)
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
        return renderDashboardError(renderContext(context), identity, league, error)
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
        let dashboards = await loadDashboards(
          identity,
          league,
          context.get(RunnerAdmin),
          context.get(LeagueOperations),
          context.get(Telemetry),
        )
        return context.render(
          <LeagueOperationsPage {...dashboards} identity={identity!} league={league} oneTimeCredential={issued.credential} />,
          { status: 201 },
        )
      } catch (error) {
        return renderDashboardError(renderContext(context), identity, league, error)
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
        return renderDashboardError(renderContext(context), identity, league, error)
      }
    },
    async deriveTelemetry(context) {
      let identity = context.get(Identity)
      let league = await context.get(Platform).viewLeague(context.params.leagueSlug, identity)
      if (!league) return notFound(context)
      try {
        await context.get(Telemetry).derive(identity, league.id, context.params.attemptId)
        return operationsRedirect(league)
      } catch (error) {
        return renderDashboardError(renderContext(context), identity, league, error)
      }
    },
    async correctTelemetry(context) {
      let identity = context.get(Identity)
      let league = await context.get(Platform).viewLeague(context.params.leagueSlug, identity)
      if (!league) return notFound(context)
      try {
        let data = context.get(FormData)
        let beforeValue = Number(readString(data, 'beforeValue'))
        let afterValue = Number(readString(data, 'afterValue'))
        if (!Number.isInteger(beforeValue) || !Number.isInteger(afterValue)) {
          throw new PlatformError('Correction values must be whole numbers', 'invalid_input')
        }
        let entityType = readString(data, 'entityType')
        if (entityType !== 'team' && entityType !== 'character') {
          throw new PlatformError('Correction entity type is invalid', 'invalid_input')
        }
        await context.get(Telemetry).correct(identity, league.id, context.params.attemptId, {
          afterValue,
          beforeValue,
          entityId: readString(data, 'entityId'),
          entityType,
          reason: readString(data, 'reason'),
          statPath: readString(data, 'statPath'),
        })
        return operationsRedirect(league)
      } catch (error) {
        return renderDashboardError(renderContext(context), identity, league, error)
      }
    },
    async confirmTelemetry(context) {
      let identity = context.get(Identity)
      let league = await context.get(Platform).viewLeague(context.params.leagueSlug, identity)
      if (!league) return notFound(context)
      try {
        await context.get(Telemetry).confirm(identity, league.id, context.params.attemptId)
        return operationsRedirect(league)
      } catch (error) {
        return renderDashboardError(renderContext(context), identity, league, error)
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
  let dashboards = await loadDashboards(
    identity,
    league,
    context.runnerAdmin,
    context.leagueOperations,
    context.telemetry,
  )
  let message = error instanceof PlatformError ? error.message : 'The league operation could not be completed.'
  let status = error instanceof PlatformError && error.code === 'forbidden' ? 403 : 400
  return context.render(<LeagueOperationsPage {...dashboards} error={message} identity={identity!} league={league} />, { status })
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

function readCharacterList(data: FormData, name: string): string[] {
  return readString(data, name)
    .split(/[\n,]/)
    .map((value) => value.trim())
    .filter(Boolean)
}

function operationsRedirect(league: LeagueDetail) {
  return redirect(routes.leagues.operations.dashboard.href({ leagueSlug: league.slug }), 303)
}

async function loadDashboards(
  identity: SessionIdentity | null,
  league: LeagueDetail,
  runnerAdmin: RunnerAdminApplication,
  leagueOperations: LeagueOperationsApplication,
  telemetry: TelemetryApplication,
) {
  let mayAdminister = Boolean(identity?.isSiteAdmin || league.roles.some((role) => administrativeRoles.has(role)))
  let [leagueOperationsDashboard, runnerDashboard, telemetryDashboard] = await Promise.all([
    leagueOperations.dashboard(identity, league.id),
    mayAdminister ? runnerAdmin.dashboard(identity, league.id) : Promise.resolve(emptyRunnerDashboard()),
    telemetry.dashboard(identity, league.id),
  ])
  let seasonStatistics = await Promise.all(leagueOperationsDashboard.seasons.map(async (season) => ({
    name: season.name,
    seasonId: season.id,
    statistics: await telemetry.rebuildSeason(identity, league.id, season.id),
  })))
  return { dashboard: runnerDashboard, leagueOperations: leagueOperationsDashboard, seasonStatistics, telemetry: telemetryDashboard }
}

function emptyRunnerDashboard(): Awaited<ReturnType<RunnerAdminApplication['dashboard']>> {
  return { audit: [], matches: [], rulesets: [], seasons: [], stations: [], statProfiles: [] }
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
  leagueOperations: LeagueOperationsApplication
  runnerAdmin: RunnerAdminApplication
  telemetry: TelemetryApplication
  render(node: RemixNode, init?: ResponseInit): Response
}

function renderContext(context: unknown): OperationsRenderContext {
  let runnerContext = context as { get(key: typeof RunnerAdmin): RunnerAdminApplication }
  let operationsContext = context as { get(key: typeof LeagueOperations): LeagueOperationsApplication }
  let telemetryContext = context as { get(key: typeof Telemetry): TelemetryApplication }
  let renderer = context as { render(node: RemixNode, init?: ResponseInit): Response }
  return {
    leagueOperations: operationsContext.get(LeagueOperations),
    render: (node, init) => renderer.render(node, init),
    runnerAdmin: runnerContext.get(RunnerAdmin),
    telemetry: telemetryContext.get(Telemetry),
  }
}
