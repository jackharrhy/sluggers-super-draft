import { createController } from 'remix/router'
import { redirect } from 'remix/response/redirect'

import { exportStatEditorV4 } from '../../../../../import/stat-editor-v4.ts'
import { Configuration } from '../../../../../middleware/platform.ts'
import { PlatformError } from '../../../../../platform/errors.ts'
import { routes } from '../../../../../routes.ts'
import { StatProfileRevisionPage } from '../../../../../ui/stat-profile-revision-page.tsx'
import { StatProfileCharactersPage } from '../../../../../ui/stat-profile-characters-page.tsx'
import {
  ConfigurationActor,
  ConfigurationLeague,
  configurationLeague,
  renderConfigurationError,
} from '../../http.tsx'

export default createController(routes.leagues.configuration.statProfiles.revision, {
  middleware: [configurationLeague()],
  actions: {
    async show(context) {
      let identity = context.get(ConfigurationActor)
      let league = context.get(ConfigurationLeague)
      try {
        let detail = await context.get(Configuration).getStatProfileRevision(identity, league.id, context.params.revisionId)
        return context.render(<StatProfileRevisionPage detail={detail} identity={identity} league={league} />)
      } catch (error) {
        return renderConfigurationError(context, error)
      }
    },
    async characters(context) {
      let identity = context.get(ConfigurationActor)
      let league = context.get(ConfigurationLeague)
      try {
        let detail = await context.get(Configuration).getStatProfileRevision(identity, league.id, context.params.revisionId)
        return context.render(<StatProfileCharactersPage
          identity={identity}
          league={league}
          revision={detail.revision}
          selectedKind={characterKind(context.url.searchParams.get('kind'))}
        />)
      } catch (error) {
        return renderConfigurationError(context, error)
      }
    },
    async export(context) {
      let identity = context.get(ConfigurationActor)
      let league = context.get(ConfigurationLeague)
      try {
        let detail = await context.get(Configuration).getStatProfileRevision(identity, league.id, context.params.revisionId)
        if (!detail.revision.sluggersTuning) {
          throw new PlatformError('This profile was not imported from Stat Editor v4 and cannot be exported in that format', 'invalid_input')
        }
        return new Response(exportStatEditorV4({
          characterValues: detail.revision.characterValues,
          sluggersTuning: detail.revision.sluggersTuning,
        }), {
          headers: {
            'content-disposition': `attachment; filename="stat-profile-r${detail.revision.revisionNumber}.txt"`,
            'content-type': 'text/plain; charset=utf-8',
          },
        })
      } catch (error) {
        return renderConfigurationError(context, error)
      }
    },
    async publish(context) {
      let identity = context.get(ConfigurationActor)
      let league = context.get(ConfigurationLeague)
      try {
        await context.get(Configuration).publishStatProfile(identity, league.id, context.params.revisionId)
        return redirect(profileHref(league.slug, context.params.revisionId), 303)
      } catch (error) {
        return renderConfigurationError(context, error)
      }
    },
    async clone(context) {
      let identity = context.get(ConfigurationActor)
      let league = context.get(ConfigurationLeague)
      try {
        let revision = await context.get(Configuration).cloneStatProfileRevision(identity, league.id, context.params.revisionId)
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

function characterKind(value: string | null): 'playable' | 'mii' | 'unused' {
  return value === 'mii' || value === 'unused' ? value : 'playable'
}
