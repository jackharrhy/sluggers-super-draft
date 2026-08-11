import { createController } from 'remix/router'
import { redirect } from 'remix/response/redirect'

import { importAutoTeamSnapshot } from '../../../../import/auto-team.ts'
import { Configuration } from '../../../../middleware/platform.ts'
import { routes } from '../../../../routes.ts'
import { TeamsConfigurationPage } from '../../../../ui/configuration-section-pages.tsx'
import {
  ConfigurationActor,
  ConfigurationLeague,
  configurationLeague,
  readJsonValue,
  readString,
  renderConfigurationError,
} from '../http.tsx'

export default createController(routes.leagues.configuration.teams, {
  middleware: [configurationLeague()],
  actions: {
    async index(context) {
      let identity = context.get(ConfigurationActor)
      let league = context.get(ConfigurationLeague)
      try {
        let dashboard = await context.get(Configuration).dashboard(identity, league.id)
        return context.render(<TeamsConfigurationPage dashboard={dashboard} identity={identity} league={league} />)
      } catch (error) {
        return renderConfigurationError(context, error)
      }
    },
    async importAutoTeam(context) {
      let identity = context.get(ConfigurationActor)
      let league = context.get(ConfigurationLeague)
      try {
        let data = context.get(FormData)
        let imported = importAutoTeamSnapshot(readJsonValue(data, 'snapshot'), readString(data, 'teamName'))
        let revision = await context.get(Configuration).createTeamLineupDraft(
          identity,
          league.id,
          context.params.teamId,
          { lineup: imported.lineup, rosterCharacterIds: imported.rosterCharacterIds },
        )
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
