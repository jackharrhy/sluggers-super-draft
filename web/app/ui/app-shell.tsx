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
  background: 'var(--surface)',
  border: '1px solid var(--border)',
  borderRadius: '12px',
  boxShadow: '0 8px 24px rgb(15 23 42 / 0.12)',
  padding: '20px',
})

export const buttonStyle = css({
  background: 'var(--blue-950)',
  border: '1px solid var(--blue-800)',
  borderRadius: '7px',
  color: 'var(--text-primary)',
  cursor: 'pointer',
  fontFamily: 'var(--font-bolt)',
  fontWeight: 700,
  padding: '10px 15px',
  '&:hover': { background: 'var(--blue-900)', borderColor: 'var(--blue-50)' },
  '&:focus-visible': { outline: '3px solid var(--blue-50)', outlineOffset: '2px' },
})

export const inputStyle = css({
  background: 'var(--surface-soft)',
  border: '1px solid var(--border)',
  borderRadius: '7px',
  color: 'var(--text-primary)',
  font: 'inherit',
  padding: '9px 11px',
  width: '100%',
  '&:focus': { borderColor: 'var(--blue-50)', outline: '2px solid var(--blue-200)' },
  '&::placeholder': { color: 'var(--text-muted)' },
})

const pageStyle = css({
  background: 'linear-gradient(to bottom, var(--blue-600), transparent 72vh)',
  color: 'var(--text-primary)',
  fontFamily: 'var(--font-sans)',
  minHeight: '100vh',
  '& a': { color: 'var(--link)' },
})

const headerStyle = css({
  alignItems: 'center',
  borderBottom: '1px solid rgb(229 231 235 / 0.72)',
  display: 'flex',
  gap: '24px',
  justifyContent: 'space-between',
  margin: '0 auto',
  maxWidth: '1280px',
  padding: '16px 24px',
  '@media (max-width: 680px)': {
    alignItems: 'flex-start',
    flexDirection: 'column',
  },
})

const brandStyle = css({
  color: 'var(--text-primary) !important',
  fontFamily: 'var(--font-happiness)',
  fontSize: '22px',
  fontWeight: 800,
  textDecoration: 'none',
  textShadow: '0 2px 0 rgb(28 38 75 / 0.28)',
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
  color: 'var(--link)',
  cursor: 'pointer',
  font: 'inherit',
  padding: 0,
  textDecoration: 'underline',
})

const mainStyle = css({
  margin: '0 auto',
  maxWidth: '1280px',
  padding: '36px 24px 80px',
})
