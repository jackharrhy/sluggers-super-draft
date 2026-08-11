import { createController } from 'remix/router'
import { redirect } from 'remix/response/redirect'

import { createStarterRulesetSettings } from '../../../../configuration/sluggers-rules.ts'
import { Configuration } from '../../../../middleware/platform.ts'
import { routes } from '../../../../routes.ts'
import { RulesetsPage } from '../../../../ui/configuration-section-pages.tsx'
import {
  ConfigurationActor,
  ConfigurationLeague,
  configurationLeague,
  readString,
  renderConfigurationError,
} from '../http.tsx'

export default createController(routes.leagues.configuration.rulesets, {
  middleware: [configurationLeague()],
  actions: {
    async index(context) {
      let identity = context.get(ConfigurationActor)
      let league = context.get(ConfigurationLeague)
      try {
        let dashboard = await context.get(Configuration).dashboard(identity, league.id)
        return context.render(<RulesetsPage dashboard={dashboard} identity={identity} league={league} />)
      } catch (error) {
        return renderConfigurationError(context, error)
      }
    },
    async create(context) {
      let identity = context.get(ConfigurationActor)
      let league = context.get(ConfigurationLeague)
      try {
        let data = context.get(FormData)
        let revision = await context.get(Configuration).createRulesetDraft(identity, league.id, {
          name: readString(data, 'name'),
          settings: createStarterRulesetSettings(),
          slug: readString(data, 'slug'),
        })
        return redirect(rulesetHref(league.slug, revision.revisionId), 303)
      } catch (error) {
        return renderConfigurationError(context, error)
      }
    },
  },
})

function rulesetHref(leagueSlug: string, revisionId: string): string {
  return routes.leagues.configuration.rulesets.revision.show.href({ leagueSlug, revisionId })
}
