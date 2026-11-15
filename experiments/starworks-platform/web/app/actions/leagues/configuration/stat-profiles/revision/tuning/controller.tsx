import { createController } from 'remix/router'
import { redirect } from 'remix/response/redirect'

import {
  parseStatEditorTuningSection,
  selectedTuningRow,
  updateStatEditorTuning,
} from '../../../../../../configuration/stat-editor-tuning.ts'
import { Configuration } from '../../../../../../middleware/platform.ts'
import { PlatformError } from '../../../../../../platform/errors.ts'
import { routes } from '../../../../../../routes.ts'
import { StatProfileTuningPage } from '../../../../../../ui/stat-profile-tuning-page.tsx'
import {
  ConfigurationActor,
  ConfigurationLeague,
  configurationLeague,
  renderConfigurationError,
} from '../../../http.tsx'

export default createController(routes.leagues.configuration.statProfiles.revision.tuning, {
  middleware: [configurationLeague()],
  actions: {
    async edit(context) {
      let identity = context.get(ConfigurationActor)
      let league = context.get(ConfigurationLeague)
      try {
        let section = parseStatEditorTuningSection(context.params.section)
        let detail = await context.get(Configuration).getStatProfileRevision(identity, league.id, context.params.revisionId)
        if (!detail.revision.sluggersTuning) {
          throw new PlatformError('This profile does not contain Stat Editor v4 tuning data', 'not_found')
        }
        return context.render(
          <StatProfileTuningPage
            basedOnTuning={detail.basedOnRevision?.sluggersTuning ?? null}
            identity={identity}
            league={league}
            revision={{ ...detail.revision, sluggersTuning: detail.revision.sluggersTuning }}
            section={section}
            selectedRow={selectedTuningRow(section, context.url.searchParams.get('row'))}
          />,
        )
      } catch (error) {
        return renderConfigurationError(context, error)
      }
    },
    async update(context) {
      let identity = context.get(ConfigurationActor)
      let league = context.get(ConfigurationLeague)
      try {
        let section = parseStatEditorTuningSection(context.params.section)
        let configuration = context.get(Configuration)
        let detail = await configuration.getStatProfileRevision(identity, league.id, context.params.revisionId)
        if (!detail.revision.sluggersTuning) {
          throw new PlatformError('This profile does not contain Stat Editor v4 tuning data', 'not_found')
        }
        let data = context.get(FormData)
        let sluggersTuning = updateStatEditorTuning(detail.revision.sluggersTuning, section, data)
        await configuration.updateStatProfileDraft(identity, league.id, context.params.revisionId, {
          characterValues: detail.revision.characterValues,
          definitions: detail.revision.definitions,
          name: detail.revision.name,
          sluggersTuning,
        })
        let href = routes.leagues.configuration.statProfiles.revision.tuning.edit.href({
          leagueSlug: league.slug,
          revisionId: context.params.revisionId,
          section,
        })
        let row = data.get('row')
        if (typeof row === 'string') href += `?row=${encodeURIComponent(row)}`
        return redirect(href, 303)
      } catch (error) {
        return renderConfigurationError(context, error)
      }
    },
  },
})
