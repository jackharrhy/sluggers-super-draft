import { createController } from 'remix/router'
import { redirect } from 'remix/response/redirect'
import type { RemixNode } from 'remix/ui'

import { Draft, Identity, Notifications, Platform } from '../../../middleware/platform.ts'
import { PlatformError } from '../../../platform/errors.ts'
import type { LeagueDetail, SessionIdentity } from '../../../platform/model.ts'
import type { DraftApplication } from '../../../draft/service.ts'
import { publishBestEffort } from '../../../notifications/publish.ts'
import { routes } from '../../../routes.ts'
import { DraftDashboardPage, DraftRoomPage } from '../../../ui/draft-pages.tsx'
import { MessagePage } from '../../../ui/message-page.tsx'

export default createController(routes.leagues.drafts, {
  actions: {
    async dashboard(context) {
      let identity = context.get(Identity)
      let league = await context.get(Platform).viewLeague(context.params.leagueSlug, identity)
      if (!league) return notFound(context)
      context.structuredLog.bind({ leagueId: league.id })
      try {
        let dashboard = await context.get(Draft).dashboard(identity, league.id)
        return context.render(<DraftDashboardPage dashboard={dashboard} identity={identity!} league={league} />)
      } catch (error) {
        return draftUnavailable(context, error)
      }
    },
    async create(context) {
      let identity = context.get(Identity)
      let league = await context.get(Platform).viewLeague(context.params.leagueSlug, identity)
      if (!league) return notFound(context)
      try {
        let data = context.get(FormData)
        let created = await context.get(Draft).createDraft(identity, league.id, {
          gameId: readString(data, 'gameId'),
          name: readString(data, 'name'),
          orderMode: readOrderMode(data),
          pickSeconds: readNumber(data, 'pickSeconds'),
          rounds: readNumber(data, 'rounds'),
          seasonId: readString(data, 'seasonId'),
          slotTeamIds: data.getAll('slotTeamIds').map(String).map((value) => value.trim()).filter(Boolean),
          statProfileRevisionId: readString(data, 'statProfileRevisionId'),
        })
        return redirect(routes.leagues.drafts.room.href({ draftId: created.id, leagueSlug: league.slug }), 303)
      } catch (error) {
        return renderDashboardError(context, identity, league, error)
      }
    },
    async room(context) {
      let identity = context.get(Identity)
      let league = await context.get(Platform).viewLeague(context.params.leagueSlug, identity)
      if (!league) return notFound(context)
      context.structuredLog.bind({ leagueId: league.id })
      try {
        let room = await context.get(Draft).getDraftRoom(identity, league.id, context.params.draftId)
        return context.render(<DraftRoomPage identity={identity!} league={league} room={room} />)
      } catch (error) {
        return draftUnavailable(context, error)
      }
    },
    async start(context) {
      let identity = context.get(Identity)
      let league = await context.get(Platform).viewLeague(context.params.leagueSlug, identity)
      if (!league) return notFound(context)
      return mutateRoom({
        draft: context.get(Draft), draftId: context.params.draftId, identity, league,
        operation: (draft) => draft.startDraft(identity, league.id, context.params.draftId),
        render: (node, init) => context.render(node, init),
      })
    },
    async pick(context) {
      let identity = context.get(Identity)
      let league = await context.get(Platform).viewLeague(context.params.leagueSlug, identity)
      if (!league) return notFound(context)
      return mutateRoom({
        draft: context.get(Draft), draftId: context.params.draftId, identity, league,
        operation: async (draft) => {
          let data = context.get(FormData)
          let pick = await draft.makePick(identity, league.id, context.params.draftId, {
            characterId: readString(data, 'characterId'),
            expectedVersion: readNumber(data, 'expectedVersion'),
            reason: readString(data, 'reason', false) || undefined,
          })
          await publishBestEffort(context.get(Notifications), league.id, {
            dedupeKey: `draft-pick:${pick.id}`,
            eventType: 'draft.pick_committed',
            message: `🌟 ${league.name} draft pick #${pick.pickNumber}: ${pick.characterId} joined team ${pick.teamId}.`,
          }, context.structuredLog)
          return pick
        },
        render: (node, init) => context.render(node, init),
      })
    },
    async pause(context) {
      let identity = context.get(Identity)
      let league = await context.get(Platform).viewLeague(context.params.leagueSlug, identity)
      if (!league) return notFound(context)
      return mutateRoom({
        draft: context.get(Draft), draftId: context.params.draftId, identity, league,
        operation: (draft) => draft.pauseDraft(identity, league.id, context.params.draftId),
        render: (node, init) => context.render(node, init),
      })
    },
    async resume(context) {
      let identity = context.get(Identity)
      let league = await context.get(Platform).viewLeague(context.params.leagueSlug, identity)
      if (!league) return notFound(context)
      return mutateRoom({
        draft: context.get(Draft), draftId: context.params.draftId, identity, league,
        operation: (draft) => draft.resumeDraft(identity, league.id, context.params.draftId),
        render: (node, init) => context.render(node, init),
      })
    },
    async automaticPick(context) {
      let identity = context.get(Identity)
      let league = await context.get(Platform).viewLeague(context.params.leagueSlug, identity)
      if (!league) return notFound(context)
      return mutateRoom({
        draft: context.get(Draft), draftId: context.params.draftId, identity, league,
        operation: (draft) => draft.automaticPickAfterExpiry(identity, league.id, context.params.draftId),
        render: (node, init) => context.render(node, init),
      })
    },
    async reversePick(context) {
      let identity = context.get(Identity)
      let league = await context.get(Platform).viewLeague(context.params.leagueSlug, identity)
      if (!league) return notFound(context)
      return mutateRoom({
        draft: context.get(Draft), draftId: context.params.draftId, identity, league,
        operation: (draft) => draft.reverseLatestPick(
          identity,
          league.id,
          context.params.draftId,
          readString(context.get(FormData), 'reason'),
        ),
        render: (node, init) => context.render(node, init),
      })
    },
    async updateQueue(context) {
      let identity = context.get(Identity)
      let league = await context.get(Platform).viewLeague(context.params.leagueSlug, identity)
      if (!league) return notFound(context)
      return mutateRoom({
        draft: context.get(Draft), draftId: context.params.draftId, identity, league,
        operation: (draft) => draft.updateQueue(
          identity,
          league.id,
          context.params.draftId,
          context.params.teamId,
          {
            characterIds: context.get(FormData).getAll('characterId').map(String).map((value) => value.trim()).filter(Boolean),
          },
        ),
        render: (node, init) => context.render(node, init),
      })
    },
  },
})

async function mutateRoom(
  input: {
    draft: DraftApplication
    draftId: string
    identity: SessionIdentity | null
    league: LeagueDetail
    operation: (draft: DraftApplication) => Promise<unknown>
    render(node: RemixNode, init?: ResponseInit): Response
  },
) {
  try {
    await input.operation(input.draft)
    return redirect(routes.leagues.drafts.room.href({
      draftId: input.draftId,
      leagueSlug: input.league.slug,
    }), 303)
  } catch (error) {
    try {
      let room = await input.draft.getDraftRoom(input.identity, input.league.id, input.draftId)
      let message = error instanceof PlatformError ? error.message : 'The draft action could not be completed.'
      let status = error instanceof PlatformError && error.code === 'forbidden' ? 403 : 400
      return input.render(<DraftRoomPage error={message} identity={input.identity!} league={input.league} room={room} />, { status })
    } catch {
      return draftUnavailable(input, error)
    }
  }
}

async function renderDashboardError(
  context: DraftRenderContext,
  identity: SessionIdentity | null,
  league: LeagueDetail,
  error: unknown,
) {
  let dashboard = await context.get(Draft).dashboard(identity, league.id)
  let message = error instanceof PlatformError ? error.message : 'The draft could not be created.'
  let status = error instanceof PlatformError && error.code === 'forbidden' ? 403 : 400
  return context.render(<DraftDashboardPage dashboard={dashboard} error={message} identity={identity!} league={league} />, { status })
}

function readString(data: FormData, name: string, required = true): string {
  let value = String(data.get(name) ?? '').trim()
  if (required && !value) throw new PlatformError(`${name} is required`, 'invalid_input')
  return value
}

function readNumber(data: FormData, name: string): number {
  let value = Number(readString(data, name))
  if (!Number.isFinite(value)) throw new PlatformError(`${name} must be a number`, 'invalid_input')
  return value
}

function readOrderMode(data: FormData): 'linear' | 'snake' {
  let value = readString(data, 'orderMode')
  if (value !== 'linear' && value !== 'snake') throw new PlatformError('Draft order mode is invalid', 'invalid_input')
  return value
}

function draftUnavailable(context: { render(node: RemixNode, init?: ResponseInit): Response }, error: unknown) {
  let message = error instanceof PlatformError ? error.message : 'The draft workspace is unavailable.'
  let status = error instanceof PlatformError && error.code === 'forbidden' ? 403 : 400
  return context.render(<MessagePage heading="Draft workspace unavailable" message={message} />, { status })
}

function notFound(context: { render(node: RemixNode, init?: ResponseInit): Response }) {
  return context.render(<MessagePage heading="League not found" message="This league is private or does not exist." />, { status: 404 })
}

interface DraftRenderContext {
  get(key: typeof Draft): DraftApplication
  render(node: RemixNode, init?: ResponseInit): Response
}
