import type { Handle, RemixNode } from 'remix/ui'
import { css } from 'remix/ui'

import type { LeagueDetail, SessionIdentity } from '../platform/model.ts'
import { administrativeRoles } from '../platform/repository.ts'
import { routes } from '../routes.ts'
import { Document } from './document.tsx'
import {
  cardStyle,
  inputStyle,
  linkButtonStyle,
  primaryButtonStyle,
} from './design-system.ts'

export { cardStyle, inputStyle } from './design-system.ts'
export const buttonStyle = primaryButtonStyle

export function AppShell(
  handle: Handle<{
    children?: RemixNode
    identity?: SessionIdentity | null
    league?: LeagueDetail
    title?: string
  }>,
) {
  return () => {
    let { children, identity = null, league, title } = handle.props
    let isMember = Boolean(identity && (identity.isSiteAdmin || league?.roles.length))
    let mayAdminister = Boolean(identity && league
      && (identity.isSiteAdmin || league.roles.some((role) => administrativeRoles.has(role))))
    return (
      <Document title={title}>
        <div mix={pageStyle}>
          <header mix={headerStyle}>
            <a href={routes.home.href()} mix={brandStyle}>Starworks</a>
            {league ? (
              <nav mix={leagueNavStyle} aria-label={`${league.name} navigation`}>
                <a href={routes.leagues.show.href({ leagueSlug: league.slug })}>Home</a>
                {isMember ? <>
                  <a href={routes.leagues.drafts.dashboard.href({ leagueSlug: league.slug })}>Drafts</a>
                  <a href={routes.leagues.operations.teams.index.href({ leagueSlug: league.slug })}>Teams</a>
                  <a href={routes.leagues.operations.matches.index.href({ leagueSlug: league.slug })}>Matches</a>
                  <a href={routes.leagues.operations.results.index.href({ leagueSlug: league.slug })}>Results</a>
                </> : null}
                {mayAdminister ? <>
                  <a href={routes.leagues.configuration.statProfiles.index.href({ leagueSlug: league.slug })}>Stats</a>
                  <a href={routes.leagues.configuration.rulesets.index.href({ leagueSlug: league.slug })}>Rules</a>
                  <a href={routes.leagues.operations.admin.index.href({ leagueSlug: league.slug })}>Admin</a>
                </> : null}
              </nav>
            ) : null}
            <nav mix={navStyle} aria-label="Account">
              {identity ? (
                <>
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

const pageStyle = css({
  background: 'linear-gradient(to bottom, var(--blue-600), transparent 72vh)',
  color: 'var(--text-primary)',
  fontFamily: 'var(--font-sans)',
  minHeight: '100vh',
  '& a': { color: 'var(--link)', fontWeight: 800, textDecoration: 'none' },
  '& a:hover': { color: 'var(--accent-yellow)' },
  '& a:focus-visible': { outline: '2px solid currentColor', outlineOffset: '3px' },
})

const headerStyle = css({
  alignItems: 'center',
  borderBottom: '1px solid rgb(229 231 235 / 0.72)',
  display: 'grid',
  gap: '24px',
  gridTemplateColumns: 'auto minmax(0, 1fr) auto',
  margin: '0 auto',
  maxWidth: '1280px',
  padding: '16px 24px',
  width: '100%',
  '@media (max-width: 820px)': {
    gridTemplateColumns: 'auto minmax(0, 1fr)',
    '& nav[aria-label="Account"]': { gridColumn: '2' },
  },
  '@media (max-width: 680px)': {
    alignItems: 'flex-start',
    gridTemplateColumns: '1fr',
    '& nav[aria-label="Account"]': { gridColumn: '1' },
  },
})

const leagueNavStyle = css({
  alignItems: 'center',
  display: 'flex',
  flexWrap: 'wrap',
  gap: '10px 20px',
  minWidth: 0,
  '& a': { color: 'var(--text-soft)', textDecoration: 'none' },
  '& a:hover': { color: 'var(--text-primary)' },
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
  '& > span': { maxWidth: '190px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
})

const mainStyle = css({
  margin: '0 auto',
  maxWidth: '1280px',
  padding: '36px 24px 80px',
  width: '100%',
})
