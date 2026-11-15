import { createController } from 'remix/router'
import { redirect } from 'remix/response/redirect'

import { Notifications, RunnerAdmin } from '../../../../middleware/platform.ts'
import { publishBestEffort } from '../../../../notifications/publish.ts'
import { PlatformError } from '../../../../platform/errors.ts'
import { runnerOperationRoles } from '../../../../platform/repository.ts'
import type { RunnerMatchDashboard } from '../../../../runner/admin-service.ts'
import { routes } from '../../../../routes.ts'
import { LeagueMatchesPage } from '../../../../ui/league-operations/matches-page.tsx'
import {
  OperationsActor,
  OperationsLeague,
  operationsLeague,
  readString,
  renderOperationsError,
} from '../http.tsx'

export default createController(routes.leagues.operations.matches, {
  middleware: [operationsLeague()],
  actions: {
    async index(context) {
      let identity = context.get(OperationsActor)
      let league = context.get(OperationsLeague)
      let mayOperate = identity.isSiteAdmin || league.roles.some((role) => runnerOperationRoles.has(role))
      try {
        let dashboard = mayOperate
          ? await context.get(RunnerAdmin).matchDashboard(identity, league.id)
          : emptyDashboard()
        return context.render(<LeagueMatchesPage dashboard={dashboard} identity={identity} league={league} mayOperate={mayOperate} />)
      } catch (error) {
        return renderOperationsError(context, error)
      }
    },

    async schedule(context) {
      let identity = context.get(OperationsActor)
      let league = context.get(OperationsLeague)
      try {
        let data = context.get(FormData)
        let scheduleTiming = readString(data, 'scheduleTiming', false) || 'later'
        if (!['now', 'later'].includes(scheduleTiming)) {
          throw new PlatformError('Schedule choice is invalid', 'invalid_input')
        }
        let scheduledValue = readString(data, 'scheduledAt', false)
        if (scheduleTiming === 'later' && !scheduledValue) {
          throw new PlatformError('Choose a scheduled time or use Schedule now', 'invalid_input')
        }
        let scheduledAt = scheduleTiming === 'now' ? new Date() : new Date(scheduledValue)
        if (scheduledAt && Number.isNaN(scheduledAt.getTime())) {
          throw new PlatformError('Scheduled time is invalid', 'invalid_input')
        }
        await context.get(RunnerAdmin).scheduleMatch(identity, league.id, {
          awayTeamId: readString(data, 'awayTeamId'),
          homeTeamId: readString(data, 'homeTeamId'),
          scheduledAt,
          seasonId: readString(data, 'seasonId'),
          venueId: readString(data, 'venueId', false) || null,
        })
        return redirect(routes.leagues.operations.matches.index.href({ leagueSlug: league.slug }), 303)
      } catch (error) {
        return renderOperationsError(context, error)
      }
    },

    async queueAttempt(context) {
      let identity = context.get(OperationsActor)
      let league = context.get(OperationsLeague)
      try {
        let data = context.get(FormData)
        let queued = await context.get(RunnerAdmin).queueAttempt(identity, league.id, context.params.matchId, {
          awayLineupRevisionId: readString(data, 'awayLineupRevisionId'),
          contentPackRevisionId: readString(data, 'contentPackRevisionId', false) || null,
          dynamicRuleOverrides: {},
          executionMode: 'cpu-vs-cpu',
          gameStadiumId: readString(data, 'gameStadiumId', false) || 'mario-stadium',
          homeLineupRevisionId: readString(data, 'homeLineupRevisionId'),
          requiredGameBuildSha256: readString(data, 'requiredGameBuildSha256'),
          rulesetRevisionId: readString(data, 'rulesetRevisionId'),
          statProfileRevisionId: readString(data, 'statProfileRevisionId'),
        })
        await publishBestEffort(context.get(Notifications), league.id, {
          dedupeKey: `match-attempt:${queued.attemptId}`,
          eventType: 'match.attempt_queued',
          message: `⚾ ${league.name} queued match attempt #${queued.attemptNumber}.`,
        }, context.structuredLog)
        return redirect(routes.leagues.operations.matches.index.href({ leagueSlug: league.slug }), 303)
      } catch (error) {
        return renderOperationsError(context, error)
      }
    },
  },
})

function emptyDashboard(): RunnerMatchDashboard {
  return { contentPacks: [], defaultGameBuildSha256: null, matches: [], rulesets: [], seasons: [], statProfiles: [], venues: [] }
}
