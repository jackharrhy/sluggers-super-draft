import { createController } from 'remix/router'

import { Identity, Platform } from '../../middleware/platform.ts'
import { PlatformError } from '../../platform/errors.ts'
import { routes } from '../../routes.ts'
import { AdminLeaguePage, InvitationCreatedPage } from '../../ui/admin-league-page.tsx'
import { MessagePage } from '../../ui/message-page.tsx'

export default createController(routes.admin, {
  actions: {
    newLeague(context) {
      let identity = context.get(Identity)
      if (!identity) {
        return context.render(
          <MessagePage heading="Sign in required" message="Use Discord to access site administration." />,
          { status: 401 },
        )
      }
      if (!identity.isSiteAdmin) {
        return context.render(
          <MessagePage heading="Access denied" message="Only a site administrator can create leagues." />,
          { status: 403 },
        )
      }
      return context.render(<AdminLeaguePage identity={identity} />)
    },
    async createLeague(context) {
      let identity = context.get(Identity)
      let data = context.get(FormData)
      try {
        let provisioned = await context.get(Platform).provisionLeague(identity, {
          name: String(data.get('name') ?? ''),
          slug: String(data.get('slug') ?? ''),
        })
        let inviteUrl = `${routes.auth.discord.href()}?${new URLSearchParams({ invite: provisioned.invitationToken })}`
        return context.render(
          <InvitationCreatedPage
            identity={identity!}
            inviteUrl={inviteUrl}
            provisioned={provisioned}
          />,
          { status: 201 },
        )
      } catch (error) {
        let platformError = error instanceof PlatformError ? error : null
        let status = platformError?.code === 'unauthorized' ? 401 : platformError?.code === 'forbidden' ? 403 : 400
        return context.render(
          <AdminLeaguePage
            error={platformError?.message ?? 'That league slug is already in use.'}
            identity={identity}
          />,
          { status },
        )
      }
    },
  },
})
