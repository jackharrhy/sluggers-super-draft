import { createController } from 'remix/router'

import { Configuration } from '../../../middleware/platform.ts'
import { PlatformError } from '../../../platform/errors.ts'
import { routes } from '../../../routes.ts'
import { OperationPreviewPage } from '../../../ui/configuration-dashboard-page.tsx'
import { ConfigurationHomePage } from '../../../ui/configuration-section-pages.tsx'
import {
  ConfigurationActor,
  ConfigurationLeague,
  configurationLeague,
  readString,
  renderConfigurationError,
} from './http.tsx'

export default createController(routes.leagues.configuration, {
  middleware: [configurationLeague()],
  actions: {
    async dashboard(context) {
      let identity = context.get(ConfigurationActor)
      let league = context.get(ConfigurationLeague)
      try {
        let dashboard = await context.get(Configuration).dashboard(identity, league.id)
        return context.render(<ConfigurationHomePage dashboard={dashboard} identity={identity} league={league} />)
      } catch (error) {
        return renderConfigurationError(context, error)
      }
    },
    async preview(context) {
      let identity = context.get(ConfigurationActor)
      let league = context.get(ConfigurationLeague)
      try {
        let data = context.get(FormData)
        let [teamId, lineupRevisionId] = readString(data, 'lineupSelection').split(':')
        if (!teamId || !lineupRevisionId) throw new PlatformError('Lineup selection is invalid', 'invalid_input')
        let bundle = await context.get(Configuration).compilePublishedConfiguration({
          adapterVersion: readString(data, 'adapterVersion'),
          identity,
          leagueId: league.id,
          lineupRevisionId,
          rulesetRevisionId: readString(data, 'rulesetRevisionId'),
          statProfileRevisionId: readString(data, 'statProfileRevisionId'),
          teamId,
        })
        return context.render(<OperationPreviewPage bundle={bundle} identity={identity} league={league} />)
      } catch (error) {
        return renderConfigurationError(context, error)
      }
    },
  },
})
