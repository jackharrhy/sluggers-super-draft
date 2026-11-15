import { createController } from 'remix/router'

import { Identity, Platform, Telemetry } from '../../middleware/platform.ts'
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
      let seasons = await context.get(Telemetry).leagueOverview(identity, league.id)
      return context.render(<LeaguePage identity={identity} league={league} seasons={seasons} />)
    },
  },
})
