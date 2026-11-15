import { createController } from 'remix/router'
import { redirect } from 'remix/response/redirect'

import { Notifications, Telemetry } from '../../../../middleware/platform.ts'
import { publishBestEffort } from '../../../../notifications/publish.ts'
import { PlatformError } from '../../../../platform/errors.ts'
import { routes } from '../../../../routes.ts'
import { parseCorrectionTarget } from '../../../../telemetry/corrections.ts'
import { LeagueResultsPage } from '../../../../ui/league-operations/results-page.tsx'
import {
  OperationsActor,
  OperationsLeague,
  operationsLeague,
  readString,
  renderOperationsError,
} from '../http.tsx'

export default createController(routes.leagues.operations.results, {
  middleware: [operationsLeague()],
  actions: {
    async index(context) {
      let identity = context.get(OperationsActor)
      let league = context.get(OperationsLeague)
      try {
        let telemetry = context.get(Telemetry)
        let [attempts, seasons] = await Promise.all([
          telemetry.dashboard(identity, league.id),
          telemetry.leagueStatistics(identity, league.id),
        ])
        return context.render(<LeagueResultsPage attempts={attempts} identity={identity} league={league} seasons={seasons} />)
      } catch (error) {
        return renderOperationsError(context, error)
      }
    },

    async derive(context) {
      let identity = context.get(OperationsActor)
      let league = context.get(OperationsLeague)
      try {
        await context.get(Telemetry).derive(identity, league.id, context.params.attemptId)
        return resultsRedirect(league.slug)
      } catch (error) {
        return renderOperationsError(context, error)
      }
    },

    async correct(context) {
      let identity = context.get(OperationsActor)
      let league = context.get(OperationsLeague)
      try {
        let data = context.get(FormData)
        let afterValue = Number(readString(data, 'afterValue'))
        if (!Number.isInteger(afterValue) || afterValue < 0) {
          throw new PlatformError('Corrected value must be a non-negative whole number', 'invalid_input')
        }
        let target = parseCorrectionTarget(readString(data, 'correctionTarget'))
        await context.get(Telemetry).correct(identity, league.id, context.params.attemptId, {
          ...target,
          afterValue,
          reason: readString(data, 'reason'),
        })
        return resultsRedirect(league.slug)
      } catch (error) {
        return renderOperationsError(context, error)
      }
    },

    async confirm(context) {
      let identity = context.get(OperationsActor)
      let league = context.get(OperationsLeague)
      try {
        await context.get(Telemetry).confirm(identity, league.id, context.params.attemptId)
        await publishBestEffort(context.get(Notifications), league.id, {
          dedupeKey: `match-result:${context.params.attemptId}`,
          eventType: 'match.result_confirmed',
          message: `✅ ${league.name} published an official match result.`,
        }, context.structuredLog)
        return resultsRedirect(league.slug)
      } catch (error) {
        return renderOperationsError(context, error)
      }
    },
  },
})

function resultsRedirect(leagueSlug: string) {
  return redirect(routes.leagues.operations.results.index.href({ leagueSlug }), 303)
}
