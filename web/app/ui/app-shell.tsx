import type { Handle, RemixNode } from 'remix/ui'
import { css } from 'remix/ui'

import type { SessionIdentity } from '../platform/model.ts'
import { routes } from '../routes.ts'
import { Document } from './document.tsx'

export function AppShell(
  handle: Handle<{
    children?: RemixNode
    identity?: SessionIdentity | null
    title?: string
  }>,
) {
  return () => {
    let { children, identity = null, title } = handle.props
    return (
      <Document title={title}>
        <div mix={pageStyle}>
          <header mix={headerStyle}>
            <a href={routes.home.href()} mix={brandStyle}>Starworks</a>
            <nav mix={navStyle} aria-label="Account">
              {identity ? (
                <>
                  <span>{identity.displayName}</span>
                  {identity.isSiteAdmin ? <a href={routes.admin.newLeague.href()}>Create league</a> : null}
                  <form action={routes.auth.logout.href()} method="post">
                    <button type="submit" mix={linkButtonStyle}>Sign out</button>
                  </form>
                </>
              ) : (
                <a href={routes.auth.discord.href()}>Sign in with Discord</a>
              )}
            </nav>
          </header>
          <main mix={mainStyle}>{children}</main>
        </div>
      </Document>
    )
  }
}

export const cardStyle = css({
  background: '#151c2d',
  border: '1px solid #2d3955',
  borderRadius: '18px',
  padding: '24px',
})

export const buttonStyle = css({
  background: '#f7c948',
  border: 0,
  borderRadius: '10px',
  color: '#182035',
  cursor: 'pointer',
  font: 'inherit',
  fontWeight: 800,
  padding: '11px 16px',
})

export const inputStyle = css({
  background: '#0c1220',
  border: '1px solid #445171',
  borderRadius: '9px',
  color: '#f7f2e8',
  font: 'inherit',
  padding: '10px 12px',
  width: '100%',
})

const pageStyle = css({
  background: 'radial-gradient(circle at top, #243255 0, #0b1020 48%, #070a12 100%)',
  color: '#f7f2e8',
  fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  minHeight: '100vh',
  '& a': { color: '#78d5ff' },
})

const headerStyle = css({
  alignItems: 'center',
  borderBottom: '1px solid #26324b',
  display: 'flex',
  gap: '24px',
  justifyContent: 'space-between',
  margin: '0 auto',
  maxWidth: '1120px',
  padding: '20px 24px',
})

const brandStyle = css({
  color: '#f7c948 !important',
  fontSize: '24px',
  fontWeight: 900,
  letterSpacing: '-0.04em',
  textDecoration: 'none',
  textTransform: 'uppercase',
})

const navStyle = css({
  alignItems: 'center',
  display: 'flex',
  flexWrap: 'wrap',
  gap: '16px',
  justifyContent: 'flex-end',
})

const linkButtonStyle = css({
  background: 'transparent',
  border: 0,
  color: '#78d5ff',
  cursor: 'pointer',
  font: 'inherit',
  padding: 0,
  textDecoration: 'underline',
})

const mainStyle = css({
  margin: '0 auto',
  maxWidth: '1120px',
  padding: '64px 24px 96px',
})
