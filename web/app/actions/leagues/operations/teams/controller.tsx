import { createController } from 'remix/router'
import { redirect } from 'remix/response/redirect'

import { LeagueOperations, Notifications } from '../../../../middleware/platform.ts'
import { publishBestEffort } from '../../../../notifications/publish.ts'
import { PlatformError } from '../../../../platform/errors.ts'
import { administrativeRoles } from '../../../../platform/repository.ts'
import { routes } from '../../../../routes.ts'
import { LeagueTeamsPage } from '../../../../ui/league-operations/teams-page.tsx'
import {
  OperationsActor,
  OperationsLeague,
  operationsLeague,
  readCharacterList,
  readString,
  renderOperationsError,
} from '../http.tsx'

export default createController(routes.leagues.operations.teams, {
  middleware: [operationsLeague()],
  actions: {
    async index(context) {
      let identity = context.get(OperationsActor)
      let league = context.get(OperationsLeague)
      try {
        let operations = await context.get(LeagueOperations).dashboard(identity, league.id)
        let mayAdminister = identity.isSiteAdmin || league.roles.some((role) => administrativeRoles.has(role))
        return context.render(<LeagueTeamsPage identity={identity} league={league} mayAdminister={mayAdminister} operations={operations} />)
      } catch (error) {
        return renderOperationsError(context, error)
      }
    },

    async setDeadline(context) {
      let identity = context.get(OperationsActor)
      let league = context.get(OperationsLeague)
      try {
        let data = context.get(FormData)
        let closesAt = new Date(readString(data, 'closesAt'))
        if (Number.isNaN(closesAt.getTime())) throw new PlatformError('Deadline time is invalid', 'invalid_input')
        let kind = readString(data, 'kind')
        if (kind !== 'trade' && kind !== 'roster' && kind !== 'lineup') {
          throw new PlatformError('Deadline kind is invalid', 'invalid_input')
        }
        await context.get(LeagueOperations).setDeadline(identity, league.id, {
          closesAt,
          kind,
          note: readString(data, 'note', false) || null,
          seasonId: readString(data, 'seasonId'),
        })
        return teamsRedirect(league.slug)
      } catch (error) {
        return renderOperationsError(context, error)
      }
    },

    async proposeTrade(context) {
      let identity = context.get(OperationsActor)
      let league = context.get(OperationsLeague)
      try {
        let data = context.get(FormData)
        let proposal = await context.get(LeagueOperations).proposeTrade(identity, league.id, {
          counterpartyCharacterIds: readCharacterList(data, 'counterpartyCharacterIds'),
          counterpartyTeamId: readString(data, 'counterpartyTeamId'),
          message: readString(data, 'message', false) || null,
          proposerCharacterIds: readCharacterList(data, 'proposerCharacterIds'),
          proposerTeamId: readString(data, 'proposerTeamId'),
          seasonId: readString(data, 'seasonId'),
        })
        await publishBestEffort(context.get(Notifications), league.id, {
          dedupeKey: `trade-proposed:${proposal.id}`,
          eventType: 'trade.proposed',
          message: `🔄 ${league.name} received a new trade proposal.`,
        }, context.structuredLog)
        return teamsRedirect(league.slug)
      } catch (error) {
        return renderOperationsError(context, error)
      }
    },

    async reviewTrade(context) {
      let identity = context.get(OperationsActor)
      let league = context.get(OperationsLeague)
      try {
        let data = context.get(FormData)
        let decision = readString(data, 'decision')
        if (decision !== 'approved' && decision !== 'rejected') {
          throw new PlatformError('Trade decision is invalid', 'invalid_input')
        }
        await context.get(LeagueOperations).reviewTrade(identity, league.id, context.params.proposalId, {
          decision,
          reason: readString(data, 'reason', false) || null,
        })
        if (decision === 'approved') {
          await publishBestEffort(context.get(Notifications), league.id, {
            dedupeKey: `trade-applied:${context.params.proposalId}`,
            eventType: 'trade.applied',
            message: `✅ ${league.name} approved a trade and published new rosters.`,
          }, context.structuredLog)
        }
        return teamsRedirect(league.slug)
      } catch (error) {
        return renderOperationsError(context, error)
      }
    },

    async cancelTrade(context) {
      let identity = context.get(OperationsActor)
      let league = context.get(OperationsLeague)
      try {
        await context.get(LeagueOperations).cancelTrade(identity, league.id, context.params.proposalId)
        return teamsRedirect(league.slug)
      } catch (error) {
        return renderOperationsError(context, error)
      }
    },
  },
})

function teamsRedirect(leagueSlug: string) {
  return redirect(routes.leagues.operations.teams.index.href({ leagueSlug }), 303)
}
