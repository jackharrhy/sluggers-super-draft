import type { Handle } from 'remix/ui'
import { css } from 'remix/ui'

import type { ProvisionedLeague, SessionIdentity } from '../platform/model.ts'
import { routes } from '../routes.ts'
import { AppShell, buttonStyle, cardStyle, inputStyle } from './app-shell.tsx'

export function AdminLeaguePage(
  handle: Handle<{ error?: string; identity: SessionIdentity | null }>,
) {
  return () => (
    <AppShell identity={handle.props.identity} title="Create a league · Starworks">
      <section mix={contentStyle}>
        <div>
          <p mix={eyebrowStyle}>Site administration</p>
          <h1 mix={headingStyle}>Create a league</h1>
          <p mix={ledeStyle}>
            The league begins private. Its first administrator joins through a one-time Discord
            invitation; no email or public registration is involved.
          </p>
        </div>
        <form action={routes.admin.createLeague.href()} method="post" mix={[cardStyle, formStyle]}>
          {handle.props.error ? <p role="alert" mix={errorStyle}>{handle.props.error}</p> : null}
          <label mix={fieldStyle}>
            <span>League name</span>
            <input name="name" required minLength={2} maxLength={100} mix={inputStyle} />
          </label>
          <label mix={fieldStyle}>
            <span>URL slug</span>
            <input name="slug" required pattern="[a-z0-9]+(?:-[a-z0-9]+)*" maxLength={64} mix={inputStyle} />
          </label>
          <button type="submit" mix={buttonStyle}>Create private league</button>
        </form>
      </section>
    </AppShell>
  )
}

export function InvitationCreatedPage(
  handle: Handle<{
    identity: SessionIdentity
    inviteUrl: string
    provisioned: ProvisionedLeague
  }>,
) {
  return () => {
    let { identity, inviteUrl, provisioned } = handle.props
    return (
      <AppShell identity={identity} title="League created · Starworks">
        <section mix={contentStyle}>
          <div>
            <p mix={eyebrowStyle}>League created</p>
            <h1 mix={headingStyle}>{provisioned.league.name}</h1>
            <p mix={ledeStyle}>Private by default. Share the invitation below with its first administrator.</p>
          </div>
          <div mix={[cardStyle, formStyle]}>
            <label mix={fieldStyle}>
              <span>One-time Discord invitation</span>
              <input readOnly value={inviteUrl} mix={inputStyle} />
            </label>
            <p mix={smallStyle}>Expires {provisioned.invitationExpiresAt.toISOString()}.</p>
            <a href={routes.leagues.show.href({ leagueSlug: provisioned.league.slug })}>Open league settings</a>
          </div>
        </section>
      </AppShell>
    )
  }
}

const contentStyle = css({ display: 'grid', gap: '36px', gridTemplateColumns: 'minmax(0, 1fr) minmax(320px, 480px)', '@media (max-width: 800px)': { gridTemplateColumns: '1fr' } })
const eyebrowStyle = css({ color: '#f7c948', fontSize: '13px', fontWeight: 800, letterSpacing: '0.12em', margin: '0 0 12px', textTransform: 'uppercase' })
const headingStyle = css({ fontSize: '56px', letterSpacing: '-0.05em', lineHeight: 1, margin: 0 })
const ledeStyle = css({ color: '#c9d4e9', fontSize: '18px', lineHeight: 1.65, maxWidth: '620px' })
const formStyle = css({ alignSelf: 'start', display: 'grid', gap: '20px' })
const fieldStyle = css({ display: 'grid', fontWeight: 700, gap: '8px' })
const errorStyle = css({ background: '#541f2d', borderRadius: '8px', color: '#ffd7df', margin: 0, padding: '12px' })
const smallStyle = css({ color: '#9faec8', fontSize: '14px', margin: 0 })
