import { createController } from 'remix/router'
import { redirect } from 'remix/response/redirect'
import type { RemixNode } from 'remix/ui'

import { Content, Identity, Platform } from '../../../middleware/platform.ts'
import { PlatformError } from '../../../platform/errors.ts'
import { routes } from '../../../routes.ts'
import { ContentDashboardPage } from '../../../ui/content-dashboard-page.tsx'
import { MessagePage } from '../../../ui/message-page.tsx'

export default createController(routes.leagues.content, {
  actions: {
    async dashboard(context) {
      let identity = context.get(Identity)
      let league = await context.get(Platform).viewLeague(context.params.leagueSlug, identity)
      if (!league) return notFound(context)
      context.structuredLog.bind({ leagueId: league.id })
      try {
        let dashboard = await context.get(Content).dashboard(identity, league.id)
        return context.render(<ContentDashboardPage dashboard={dashboard} identity={identity!} league={league} />)
      } catch (error) {
        return renderError(context, error)
      }
    },
    async create(context) {
      let identity = context.get(Identity)
      let league = await context.get(Platform).viewLeague(context.params.leagueSlug, identity)
      if (!league) return notFound(context)
      try {
        let data = context.get(FormData)
        await context.get(Content).createDraft(identity, league.id, {
          adapterVersion: readString(data, 'adapterVersion'),
          mainDolSha256: readString(data, 'mainDolSha256'),
          name: readString(data, 'name'),
          rulesetRevisionId: readString(data, 'rulesetRevisionId'),
          slug: readString(data, 'slug'),
          statCharacterIds: lines(data, 'statCharacterIds'),
          statProfileRevisionId: readString(data, 'statProfileRevisionId'),
        })
        return dashboardRedirect(league.slug)
      } catch (error) {
        return renderError(context, error)
      }
    },
    async uploadAsset(context) {
      let identity = context.get(Identity)
      let league = await context.get(Platform).viewLeague(context.params.leagueSlug, identity)
      if (!league) return notFound(context)
      try {
        let data = context.get(FormData)
        let value = data.get('asset')
        if (!(value instanceof File) || !value.size) {
          throw new PlatformError('Choose a PNG or WebP source image', 'invalid_input')
        }
        await context.get(Content).uploadAsset(identity, league.id, {
          bytes: new Uint8Array(await value.arrayBuffer()),
          displayName: value.name,
          mediaType: value.type,
        })
        return dashboardRedirect(league.slug)
      } catch (error) {
        return renderError(context, error)
      }
    },
    async assignAsset(context) {
      let identity = context.get(Identity)
      let league = await context.get(Platform).viewLeague(context.params.leagueSlug, identity)
      if (!league) return notFound(context)
      try {
        let data = context.get(FormData)
        await context.get(Content).assignAsset(identity, league.id, context.params.revisionId, {
          assetSha256: readString(data, 'assetSha256'),
          characterId: readString(data, 'characterId'),
          slot: readString(data, 'slot'),
        })
        return dashboardRedirect(league.slug)
      } catch (error) {
        return renderError(context, error)
      }
    },
    async publish(context) {
      let identity = context.get(Identity)
      let league = await context.get(Platform).viewLeague(context.params.leagueSlug, identity)
      if (!league) return notFound(context)
      try {
        await context.get(Content).publish(identity, league.id, context.params.revisionId)
        return dashboardRedirect(league.slug)
      } catch (error) {
        return renderError(context, error)
      }
    },
    async clone(context) {
      let identity = context.get(Identity)
      let league = await context.get(Platform).viewLeague(context.params.leagueSlug, identity)
      if (!league) return notFound(context)
      try {
        await context.get(Content).clone(identity, league.id, context.params.revisionId)
        return dashboardRedirect(league.slug)
      } catch (error) {
        return renderError(context, error)
      }
    },
  },
})

function readString(data: FormData, name: string): string {
  let value = data.get(name)
  if (typeof value !== 'string') throw new PlatformError(`${name} is required`, 'invalid_input')
  return value
}

function lines(data: FormData, name: string): string[] {
  return readString(data, name).split(/\r?\n/).map((value) => value.trim()).filter(Boolean)
}

function dashboardRedirect(leagueSlug: string) {
  return redirect(routes.leagues.content.dashboard.href({ leagueSlug }), 303)
}

function renderError(
  context: { render(node: RemixNode, init?: ResponseInit): Response },
  error: unknown,
) {
  let message = error instanceof PlatformError ? error.message : 'The content-pack operation could not be completed.'
  let status = error instanceof PlatformError && error.code === 'forbidden' ? 403 : 400
  return context.render(<MessagePage heading="Content pack unavailable" message={message} />, { status })
}

function notFound(context: { render(node: RemixNode, init?: ResponseInit): Response }) {
  return context.render(<MessagePage heading="League not found" message="This league is not available to your account." />, { status: 404 })
}
