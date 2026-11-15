import { createController } from 'remix/router'
import { redirect } from 'remix/response/redirect'

import { parseTeamLineupForm } from '../../../../../configuration/team-lineup-form.ts'
import { Configuration } from '../../../../../middleware/platform.ts'
import { routes } from '../../../../../routes.ts'
import { TeamLineupRevisionPage } from '../../../../../ui/team-lineup-revision-page.tsx'
import {
  ConfigurationActor,
  ConfigurationLeague,
  configurationLeague,
  renderConfigurationError,
} from '../../http.tsx'

export default createController(routes.leagues.configuration.teams.lineup, {
  middleware: [configurationLeague()],
  actions: {
    async show(context) {
      let identity = context.get(ConfigurationActor)
      let league = context.get(ConfigurationLeague)
      try {
        let detail = await context.get(Configuration).getTeamLineupRevision(identity, league.id, context.params.teamId, context.params.revisionId)
        return context.render(<TeamLineupRevisionPage detail={detail} identity={identity} league={league} />)
      } catch (error) {
        return renderConfigurationError(context, error)
      }
    },
    async update(context) {
      let identity = context.get(ConfigurationActor)
      let league = context.get(ConfigurationLeague)
      try {
        let configuration = context.get(Configuration)
        let detail = await configuration.getTeamLineupRevision(identity, league.id, context.params.teamId, context.params.revisionId)
        await configuration.updateTeamLineupDraft(identity, league.id, context.params.teamId, context.params.revisionId, {
          lineup: parseTeamLineupForm(context.get(FormData), detail.revision.rosterCharacterIds),
          rosterCharacterIds: detail.revision.rosterCharacterIds,
        })
        return redirect(lineupHref(league.slug, context.params.teamId, context.params.revisionId), 303)
      } catch (error) {
        return renderConfigurationError(context, error)
      }
    },
    async publish(context) {
      let identity = context.get(ConfigurationActor)
      let league = context.get(ConfigurationLeague)
      try {
        await context.get(Configuration).publishTeamLineup(identity, league.id, context.params.teamId, context.params.revisionId)
        return redirect(lineupHref(league.slug, context.params.teamId, context.params.revisionId), 303)
      } catch (error) {
        return renderConfigurationError(context, error)
      }
    },
    async clone(context) {
      let identity = context.get(ConfigurationActor)
      let league = context.get(ConfigurationLeague)
      try {
        let revision = await context.get(Configuration).cloneTeamLineupRevision(identity, league.id, context.params.teamId, context.params.revisionId)
        return redirect(lineupHref(league.slug, revision.teamId, revision.lineupRevisionId), 303)
      } catch (error) {
        return renderConfigurationError(context, error)
      }
    },
  },
})

function lineupHref(leagueSlug: string, teamId: string, revisionId: string): string {
  return routes.leagues.configuration.teams.lineup.show.href({ leagueSlug, revisionId, teamId })
}
