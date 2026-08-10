import { createController } from 'remix/router'
import { redirect } from 'remix/response/redirect'

import { Identity, Platform } from '../../middleware/platform.ts'
import { routes } from '../../routes.ts'
import { LeaguePage } from '../../ui/league-page.tsx'
import { MessagePage } from '../../ui/message-page.tsx'

export default createController(routes.leagues, {
  actions: {
    async show(context) {
      let identity = context.get(Identity)
      let league = await context.get(Platform).viewLeague(context.params.leagueSlug, identity)
      if (!league) {
        return context.render(
          <MessagePage heading="League not found" message="This league is private or does not exist." />,
          { status: 404 },
        )
      }
      context.structuredLog.bind({ leagueId: league.id })
      return context.render(<LeaguePage identity={identity} league={league} />)
    },
    async updatePublication(context) {
      let identity = context.get(Identity)
      let league = await context.get(Platform).viewLeague(context.params.leagueSlug, identity)
      if (!league) return new Response('Not Found', { status: 404 })
      context.structuredLog.bind({ leagueId: league.id })
      let data = context.get(FormData)
      try {
        await context.get(Platform).setPublicationPolicy(identity, league.id, {
          draftVisible: data.has('draftVisible'),
          leagueVisible: data.has('leagueVisible'),
          standingsVisible: data.has('standingsVisible'),
          statsVisible: data.has('statsVisible'),
        })
      } catch {
        return new Response('Forbidden', { status: identity ? 403 : 401 })
      }
      return redirect(routes.leagues.show.href({ leagueSlug: league.slug }), 303)
    },
  },
})
