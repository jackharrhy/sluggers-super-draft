import {
  RulesetRevisionSchema,
  StatProfileRevisionSchema,
  TeamLineupRevisionSchema,
} from '@starworks/contracts'
import { createController } from 'remix/router'
import { redirect } from 'remix/response/redirect'
import type { RemixNode } from 'remix/ui'
import { ZodError } from 'zod'

import { Configuration, Identity, Platform } from '../../../middleware/platform.ts'
import { PlatformError } from '../../../platform/errors.ts'
import { routes } from '../../../routes.ts'
import { ConfigurationDashboardPage, OperationPreviewPage } from '../../../ui/configuration-dashboard-page.tsx'
import {
  RulesetRevisionPage,
  StatProfileRevisionPage,
  TeamLineupRevisionPage,
} from '../../../ui/configuration-revision-pages.tsx'
import { MessagePage } from '../../../ui/message-page.tsx'

export default createController(routes.leagues.configuration, {
  actions: {
    async dashboard(context) {
      let identity = context.get(Identity)
      let league = await context.get(Platform).viewLeague(context.params.leagueSlug, identity)
      if (!league) return notFound(context)
      context.structuredLog.bind({ leagueId: league.id })
      try {
        let dashboard = await context.get(Configuration).dashboard(identity, league.id)
        return context.render(<ConfigurationDashboardPage dashboard={dashboard} identity={identity!} league={league} />)
      } catch (error) {
        return renderConfigurationError(context, error)
      }
    },
    async createStatProfile(context) {
      let identity = context.get(Identity)
      let league = await context.get(Platform).viewLeague(context.params.leagueSlug, identity)
      if (!league) return notFound(context)
      try {
        let data = context.get(FormData)
        let revision = await context.get(Configuration).createStatProfileDraft(identity, league.id, {
          characterValues: readJson(data, 'characterValues', StatProfileRevisionSchema.shape.characterValues),
          definitions: readJson(data, 'definitions', StatProfileRevisionSchema.shape.definitions),
          name: readString(data, 'name'),
          slug: readString(data, 'slug'),
        })
        return redirect(routes.leagues.configuration.showStatProfile.href({ leagueSlug: league.slug, revisionId: revision.revisionId }), 303)
      } catch (error) {
        return renderConfigurationError(context, error)
      }
    },
    async showStatProfile(context) {
      let identity = context.get(Identity)
      let league = await context.get(Platform).viewLeague(context.params.leagueSlug, identity)
      if (!league) return notFound(context)
      try {
        let detail = await context.get(Configuration).getStatProfileRevision(identity, league.id, context.params.revisionId)
        return context.render(<StatProfileRevisionPage detail={detail} identity={identity!} league={league} />)
      } catch (error) {
        return renderConfigurationError(context, error)
      }
    },
    async updateStatProfile(context) {
      let identity = context.get(Identity)
      let league = await context.get(Platform).viewLeague(context.params.leagueSlug, identity)
      if (!league) return notFound(context)
      try {
        let data = context.get(FormData)
        await context.get(Configuration).updateStatProfileDraft(identity, league.id, context.params.revisionId, {
          characterValues: readJson(data, 'characterValues', StatProfileRevisionSchema.shape.characterValues),
          definitions: readJson(data, 'definitions', StatProfileRevisionSchema.shape.definitions),
          name: readString(data, 'name'),
        })
        return redirect(routes.leagues.configuration.showStatProfile.href({ leagueSlug: league.slug, revisionId: context.params.revisionId }), 303)
      } catch (error) {
        return renderConfigurationError(context, error)
      }
    },
    async publishStatProfile(context) {
      let identity = context.get(Identity)
      let league = await context.get(Platform).viewLeague(context.params.leagueSlug, identity)
      if (!league) return notFound(context)
      try {
        await context.get(Configuration).publishStatProfile(identity, league.id, context.params.revisionId)
        return redirect(routes.leagues.configuration.showStatProfile.href({ leagueSlug: league.slug, revisionId: context.params.revisionId }), 303)
      } catch (error) {
        return renderConfigurationError(context, error)
      }
    },
    async cloneStatProfile(context) {
      let identity = context.get(Identity)
      let league = await context.get(Platform).viewLeague(context.params.leagueSlug, identity)
      if (!league) return notFound(context)
      try {
        let revision = await context.get(Configuration).cloneStatProfileRevision(identity, league.id, context.params.revisionId)
        return redirect(routes.leagues.configuration.showStatProfile.href({ leagueSlug: league.slug, revisionId: revision.revisionId }), 303)
      } catch (error) {
        return renderConfigurationError(context, error)
      }
    },
    async createRuleset(context) {
      let identity = context.get(Identity)
      let league = await context.get(Platform).viewLeague(context.params.leagueSlug, identity)
      if (!league) return notFound(context)
      try {
        let data = context.get(FormData)
        let revision = await context.get(Configuration).createRulesetDraft(identity, league.id, {
          name: readString(data, 'name'),
          settings: readJson(data, 'settings', RulesetRevisionSchema.shape.settings),
          slug: readString(data, 'slug'),
        })
        return redirect(routes.leagues.configuration.showRuleset.href({ leagueSlug: league.slug, revisionId: revision.revisionId }), 303)
      } catch (error) {
        return renderConfigurationError(context, error)
      }
    },
    async showRuleset(context) {
      let identity = context.get(Identity)
      let league = await context.get(Platform).viewLeague(context.params.leagueSlug, identity)
      if (!league) return notFound(context)
      try {
        let detail = await context.get(Configuration).getRulesetRevision(identity, league.id, context.params.revisionId)
        return context.render(<RulesetRevisionPage detail={detail} identity={identity!} league={league} />)
      } catch (error) {
        return renderConfigurationError(context, error)
      }
    },
    async updateRuleset(context) {
      let identity = context.get(Identity)
      let league = await context.get(Platform).viewLeague(context.params.leagueSlug, identity)
      if (!league) return notFound(context)
      try {
        let data = context.get(FormData)
        await context.get(Configuration).updateRulesetDraft(identity, league.id, context.params.revisionId, {
          name: readString(data, 'name'),
          settings: readJson(data, 'settings', RulesetRevisionSchema.shape.settings),
        })
        return redirect(routes.leagues.configuration.showRuleset.href({ leagueSlug: league.slug, revisionId: context.params.revisionId }), 303)
      } catch (error) {
        return renderConfigurationError(context, error)
      }
    },
    async publishRuleset(context) {
      let identity = context.get(Identity)
      let league = await context.get(Platform).viewLeague(context.params.leagueSlug, identity)
      if (!league) return notFound(context)
      try {
        await context.get(Configuration).publishRuleset(identity, league.id, context.params.revisionId)
        return redirect(routes.leagues.configuration.showRuleset.href({ leagueSlug: league.slug, revisionId: context.params.revisionId }), 303)
      } catch (error) {
        return renderConfigurationError(context, error)
      }
    },
    async cloneRuleset(context) {
      let identity = context.get(Identity)
      let league = await context.get(Platform).viewLeague(context.params.leagueSlug, identity)
      if (!league) return notFound(context)
      try {
        let revision = await context.get(Configuration).cloneRulesetRevision(identity, league.id, context.params.revisionId)
        return redirect(routes.leagues.configuration.showRuleset.href({ leagueSlug: league.slug, revisionId: revision.revisionId }), 303)
      } catch (error) {
        return renderConfigurationError(context, error)
      }
    },
    async createLineup(context) {
      let identity = context.get(Identity)
      let league = await context.get(Platform).viewLeague(context.params.leagueSlug, identity)
      if (!league) return notFound(context)
      try {
        let data = context.get(FormData)
        let revision = await context.get(Configuration).createTeamLineupDraft(identity, league.id, context.params.teamId, {
          lineup: readJson(data, 'lineup', TeamLineupRevisionSchema.shape.lineup),
          rosterCharacterIds: readJson(data, 'rosterCharacterIds', TeamLineupRevisionSchema.shape.rosterCharacterIds),
        })
        return redirect(routes.leagues.configuration.showLineup.href({ leagueSlug: league.slug, revisionId: revision.lineupRevisionId, teamId: revision.teamId }), 303)
      } catch (error) {
        return renderConfigurationError(context, error)
      }
    },
    async showLineup(context) {
      let identity = context.get(Identity)
      let league = await context.get(Platform).viewLeague(context.params.leagueSlug, identity)
      if (!league) return notFound(context)
      try {
        let detail = await context.get(Configuration).getTeamLineupRevision(identity, league.id, context.params.teamId, context.params.revisionId)
        return context.render(<TeamLineupRevisionPage detail={detail} identity={identity!} league={league} />)
      } catch (error) {
        return renderConfigurationError(context, error)
      }
    },
    async updateLineup(context) {
      let identity = context.get(Identity)
      let league = await context.get(Platform).viewLeague(context.params.leagueSlug, identity)
      if (!league) return notFound(context)
      try {
        let data = context.get(FormData)
        await context.get(Configuration).updateTeamLineupDraft(identity, league.id, context.params.teamId, context.params.revisionId, {
          lineup: readJson(data, 'lineup', TeamLineupRevisionSchema.shape.lineup),
          rosterCharacterIds: readJson(data, 'rosterCharacterIds', TeamLineupRevisionSchema.shape.rosterCharacterIds),
        })
        return redirect(routes.leagues.configuration.showLineup.href({ leagueSlug: league.slug, revisionId: context.params.revisionId, teamId: context.params.teamId }), 303)
      } catch (error) {
        return renderConfigurationError(context, error)
      }
    },
    async publishLineup(context) {
      let identity = context.get(Identity)
      let league = await context.get(Platform).viewLeague(context.params.leagueSlug, identity)
      if (!league) return notFound(context)
      try {
        await context.get(Configuration).publishTeamLineup(identity, league.id, context.params.teamId, context.params.revisionId)
        return redirect(routes.leagues.configuration.showLineup.href({ leagueSlug: league.slug, revisionId: context.params.revisionId, teamId: context.params.teamId }), 303)
      } catch (error) {
        return renderConfigurationError(context, error)
      }
    },
    async cloneLineup(context) {
      let identity = context.get(Identity)
      let league = await context.get(Platform).viewLeague(context.params.leagueSlug, identity)
      if (!league) return notFound(context)
      try {
        let revision = await context.get(Configuration).cloneTeamLineupRevision(identity, league.id, context.params.teamId, context.params.revisionId)
        return redirect(routes.leagues.configuration.showLineup.href({ leagueSlug: league.slug, revisionId: revision.lineupRevisionId, teamId: revision.teamId }), 303)
      } catch (error) {
        return renderConfigurationError(context, error)
      }
    },
    async preview(context) {
      let identity = context.get(Identity)
      let league = await context.get(Platform).viewLeague(context.params.leagueSlug, identity)
      if (!league) return notFound(context)
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
        return context.render(<OperationPreviewPage bundle={bundle} identity={identity!} league={league} />)
      } catch (error) {
        return renderConfigurationError(context, error)
      }
    },
  },
})

function readString(data: globalThis.FormData, name: string): string {
  let value = data.get(name)
  if (typeof value !== 'string' || !value.trim()) {
    throw new PlatformError(`${name} is required`, 'invalid_input')
  }
  return value.trim()
}

function readJson<T>(
  data: globalThis.FormData,
  name: string,
  schema: { parse(value: unknown): T },
): T {
  let raw = readString(data, name)
  try {
    return schema.parse(JSON.parse(raw))
  } catch (error) {
    if (error instanceof ZodError || error instanceof SyntaxError) {
      throw new PlatformError(`${name} must be valid configuration JSON`, 'invalid_input')
    }
    throw error
  }
}

function notFound(context: { render(node: RemixNode, init?: ResponseInit): Response }) {
  return context.render(<MessagePage heading="League not found" message="This league is private or does not exist." />, { status: 404 })
}

function renderConfigurationError(
  context: { render(node: RemixNode, init?: ResponseInit): Response },
  error: unknown,
) {
  if (!(error instanceof PlatformError)) throw error
  let status = error.code === 'unauthorized'
    ? 401
    : error.code === 'forbidden'
      ? 403
      : error.code === 'not_found'
        ? 404
        : error.code === 'conflict'
          ? 409
          : 400
  return context.render(<MessagePage heading="Configuration unavailable" message={error.message} />, { status })
}
