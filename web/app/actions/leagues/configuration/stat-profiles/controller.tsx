import { createController } from 'remix/router'
import { redirect } from 'remix/response/redirect'

import { importStatEditorV4 } from '../../../../import/stat-editor-v4.ts'
import { Configuration } from '../../../../middleware/platform.ts'
import { PlatformError } from '../../../../platform/errors.ts'
import { routes } from '../../../../routes.ts'
import { StatProfilesPage } from '../../../../ui/configuration-section-pages.tsx'
import {
  ConfigurationActor,
  ConfigurationLeague,
  configurationLeague,
  readString,
  renderConfigurationError,
} from '../http.tsx'

export default createController(routes.leagues.configuration.statProfiles, {
  middleware: [configurationLeague()],
  actions: {
    async index(context) {
      let identity = context.get(ConfigurationActor)
      let league = context.get(ConfigurationLeague)
      try {
        let dashboard = await context.get(Configuration).dashboard(identity, league.id)
        return context.render(<StatProfilesPage dashboard={dashboard} identity={identity} league={league} />)
      } catch (error) {
        return renderConfigurationError(context, error)
      }
    },
    async importStatEditor(context) {
      let identity = context.get(ConfigurationActor)
      let league = context.get(ConfigurationLeague)
      try {
        let data = context.get(FormData)
        let snapshot = data.get('snapshot')
        if (!(snapshot instanceof File) || snapshot.size === 0 || snapshot.size > 2_000_000) {
          throw new PlatformError('Choose a Stat Editor v4 text file smaller than 2 MB', 'invalid_input')
        }
        let imported = importStatEditorV4({
          profileName: readString(data, 'name'),
          rawText: await snapshot.text(),
          sourceVersion: 'v4',
        })
        let revision = await context.get(Configuration).createStatProfileDraft(identity, league.id, {
          characterValues: imported.characterValues,
          definitions: imported.definitions,
          name: imported.name,
          sluggersTuning: imported.sluggersTuning,
          slug: readString(data, 'slug'),
        })
        return redirect(profileHref(league.slug, revision.revisionId), 303)
      } catch (error) {
        return renderConfigurationError(context, error)
      }
    },
  },
})

function profileHref(leagueSlug: string, revisionId: string): string {
  return routes.leagues.configuration.statProfiles.revision.show.href({ leagueSlug, revisionId })
}
