import { createController } from 'remix/router'
import { redirect } from 'remix/response/redirect'

import { parseCharacterStatForm } from '../../../../../../configuration/stat-editor-form.ts'
import { Configuration } from '../../../../../../middleware/platform.ts'
import { PlatformError } from '../../../../../../platform/errors.ts'
import { routes } from '../../../../../../routes.ts'
import { StatProfileCharacterPage } from '../../../../../../ui/stat-profile-character-page.tsx'
import {
  ConfigurationActor,
  ConfigurationLeague,
  configurationLeague,
  renderConfigurationError,
} from '../../../http.tsx'

export default createController(routes.leagues.configuration.statProfiles.revision.character, {
  middleware: [configurationLeague()],
  actions: {
    async edit(context) {
      let identity = context.get(ConfigurationActor)
      let league = context.get(ConfigurationLeague)
      try {
        let detail = await context.get(Configuration).getStatProfileRevision(identity, league.id, context.params.revisionId)
        let character = detail.revision.characterValues.find((value) => value.characterId === context.params.characterId)
        if (!character) throw new PlatformError('Character stats were not found in this profile', 'not_found')
        return context.render(
          <StatProfileCharacterPage
            character={character}
            definitions={detail.revision.definitions}
            identity={identity}
            league={league}
            previousValues={detail.basedOnRevision?.characterValues.find((value) => value.characterId === character.characterId)?.values ?? null}
            profileName={detail.revision.name}
            revisionId={detail.revision.revisionId}
            status={detail.revision.status}
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
        let configuration = context.get(Configuration)
        let detail = await configuration.getStatProfileRevision(identity, league.id, context.params.revisionId)
        let characterIndex = detail.revision.characterValues.findIndex((value) => value.characterId === context.params.characterId)
        if (characterIndex === -1) throw new PlatformError('Character stats were not found in this profile', 'not_found')
        let characterValues = [...detail.revision.characterValues]
        characterValues[characterIndex] = {
          characterId: context.params.characterId,
          values: parseCharacterStatForm(detail.revision.definitions, context.get(FormData)),
        }
        await configuration.updateStatProfileDraft(identity, league.id, context.params.revisionId, {
          characterValues,
          definitions: detail.revision.definitions,
          name: detail.revision.name,
          sluggersTuning: detail.revision.sluggersTuning,
        })
        return redirect(characterHref(league.slug, context.params.revisionId, context.params.characterId), 303)
      } catch (error) {
        return renderConfigurationError(context, error)
      }
    },
  },
})

function characterHref(leagueSlug: string, revisionId: string, characterId: string): string {
  return routes.leagues.configuration.statProfiles.revision.character.edit.href({
    characterId,
    leagueSlug,
    revisionId,
  })
}
