import { createController } from 'remix/router'
import { redirect } from 'remix/response/redirect'

import { Notifications, Platform, RunnerAdmin } from '../../../../middleware/platform.ts'
import type { NotificationApplication, NotificationDashboard } from '../../../../notifications/service.ts'
import { PlatformError } from '../../../../platform/errors.ts'
import type { SessionIdentity } from '../../../../platform/model.ts'
import { routes } from '../../../../routes.ts'
import { LeagueAdminPage } from '../../../../ui/league-operations/admin-page.tsx'
import {
  OperationsActor,
  OperationsLeague,
  operationsLeague,
  readString,
  renderOperationsError,
} from '../http.tsx'

export default createController(routes.leagues.operations.admin, {
  middleware: [operationsLeague()],
  actions: {
    async index(context) {
      let identity = context.get(OperationsActor)
      let league = context.get(OperationsLeague)
      try {
        let [dashboard, notification] = await Promise.all([
          context.get(RunnerAdmin).stationDashboard(identity, league.id),
          loadNotification(context.get(Notifications), identity, league.id),
        ])
        return context.render(<LeagueAdminPage dashboard={dashboard} identity={identity} league={league} notification={notification} />)
      } catch (error) {
        return renderOperationsError(context, error)
      }
    },

    async updatePublication(context) {
      let identity = context.get(OperationsActor)
      let league = context.get(OperationsLeague)
      try {
        let data = context.get(FormData)
        await context.get(Platform).setPublicationPolicy(identity, league.id, {
          draftVisible: data.has('draftVisible'),
          leagueVisible: data.has('leagueVisible'),
          standingsVisible: data.has('standingsVisible'),
          statsVisible: data.has('statsVisible'),
        })
        return adminRedirect(league.slug)
      } catch (error) {
        return renderOperationsError(context, error)
      }
    },

    async configureDiscord(context) {
      let identity = context.get(OperationsActor)
      let league = context.get(OperationsLeague)
      try {
        let notifications = context.get(Notifications)
        if (!notifications) throw new PlatformError('Discord notifications are unavailable', 'external_service')
        let channelId = readString(context.get(FormData), 'channelId', false)
        await notifications.configure(identity, league.id, { channelId: channelId || null })
        return adminRedirect(league.slug)
      } catch (error) {
        return renderOperationsError(context, error)
      }
    },

    async retryDiscord(context) {
      let identity = context.get(OperationsActor)
      let league = context.get(OperationsLeague)
      try {
        let notifications = context.get(Notifications)
        if (!notifications) throw new PlatformError('Discord notifications are unavailable', 'external_service')
        await notifications.retry(identity, league.id)
        return adminRedirect(league.slug)
      } catch (error) {
        return renderOperationsError(context, error)
      }
    },

    async issueCredential(context) {
      let identity = context.get(OperationsActor)
      let league = context.get(OperationsLeague)
      try {
        let issued = await context.get(Platform).issueRunnerCredential(identity, league.id, {
          name: readString(context.get(FormData), 'name'),
          scopes: ['artifacts:read', 'heartbeat:write', 'runs:claim', 'runs:read', 'telemetry:write'],
        })
        let [dashboard, notification] = await Promise.all([
          context.get(RunnerAdmin).stationDashboard(identity, league.id),
          loadNotification(context.get(Notifications), identity, league.id),
        ])
        return context.render(
          <LeagueAdminPage dashboard={dashboard} identity={identity} league={league} notification={notification} oneTimeCredential={issued.credential} />,
          { status: 201 },
        )
      } catch (error) {
        return renderOperationsError(context, error)
      }
    },

    async revokeStation(context) {
      let identity = context.get(OperationsActor)
      let league = context.get(OperationsLeague)
      try {
        await context.get(RunnerAdmin).revokeStation(identity, league.id, context.params.stationId)
        return adminRedirect(league.slug)
      } catch (error) {
        return renderOperationsError(context, error)
      }
    },
  },
})

async function loadNotification(
  notifications: NotificationApplication | null,
  identity: SessionIdentity,
  leagueId: string,
): Promise<NotificationDashboard> {
  return notifications
    ? notifications.dashboard(identity, leagueId)
    : { botConfigured: false, channelId: null, failed: 0, pending: 0, sent: 0 }
}

function adminRedirect(leagueSlug: string) {
  return redirect(routes.leagues.operations.admin.index.href({ leagueSlug }), 303)
}
