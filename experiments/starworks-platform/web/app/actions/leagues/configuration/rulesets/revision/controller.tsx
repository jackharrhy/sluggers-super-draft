import { createController } from 'remix/router'
import { redirect } from 'remix/response/redirect'

import { parseSupportedRuleValues } from '../../../../../configuration/sluggers-rules.ts'
import { Configuration } from '../../../../../middleware/platform.ts'
import { routes } from '../../../../../routes.ts'
import { RulesetRevisionPage } from '../../../../../ui/ruleset-revision-page.tsx'
import {
  ConfigurationActor,
  ConfigurationLeague,
  configurationLeague,
  readString,
  renderConfigurationError,
} from '../../http.tsx'

export default createController(routes.leagues.configuration.rulesets.revision, {
  middleware: [configurationLeague()],
  actions: {
    async show(context) {
      let identity = context.get(ConfigurationActor)
      let league = context.get(ConfigurationLeague)
      try {
        let detail = await context.get(Configuration).getRulesetRevision(identity, league.id, context.params.revisionId)
        return context.render(<RulesetRevisionPage detail={detail} identity={identity} league={league} />)
      } catch (error) {
        return renderConfigurationError(context, error)
      }
    },
    async update(context) {
      let identity = context.get(ConfigurationActor)
      let league = context.get(ConfigurationLeague)
      try {
        let configuration = context.get(Configuration)
        let detail = await configuration.getRulesetRevision(identity, league.id, context.params.revisionId)
        let data = context.get(FormData)
        await configuration.updateRulesetDraft(identity, league.id, context.params.revisionId, {
          name: readString(data, 'name'),
          settings: parseSupportedRuleValues(data, detail.revision.settings),
        })
        return redirect(rulesetHref(league.slug, context.params.revisionId), 303)
      } catch (error) {
        return renderConfigurationError(context, error)
      }
    },
    async publish(context) {
      let identity = context.get(ConfigurationActor)
      let league = context.get(ConfigurationLeague)
      try {
        await context.get(Configuration).publishRuleset(identity, league.id, context.params.revisionId)
        return redirect(rulesetHref(league.slug, context.params.revisionId), 303)
      } catch (error) {
        return renderConfigurationError(context, error)
      }
    },
    async clone(context) {
      let identity = context.get(ConfigurationActor)
      let league = context.get(ConfigurationLeague)
      try {
        let revision = await context.get(Configuration).cloneRulesetRevision(identity, league.id, context.params.revisionId)
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
