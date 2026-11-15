import type { Handle } from 'remix/ui'
import { css } from 'remix/ui'

import type { LeagueDetail, SessionIdentity } from '../platform/model.ts'
import { routes } from '../routes.ts'
import type { LeagueOverviewSeason } from '../telemetry/statistics.ts'
import { AppShell, cardStyle } from './app-shell.tsx'
import { PlayerLeaderList, StandingsTable } from './league-summary.tsx'

export function LeaguePage(handle: Handle<{
  identity: SessionIdentity | null
  league: LeagueDetail
  seasons: LeagueOverviewSeason[]
}>) {
  return () => {
    let { identity, league, seasons } = handle.props
    let current = seasons[0]
    let resultsHref = identity
      ? routes.leagues.operations.results.index.href({ leagueSlug: league.slug })
      : null
    let hasStandings = Boolean(current?.standings?.length)
    let hasPlayers = Boolean(current?.playerTotals && Object.keys(current.playerTotals).length)
    return (
      <AppShell identity={identity} league={league} title={`${league.name} · Starworks`}>
        <header mix={heroStyle}>
          <h1>{league.name}</h1>
          <p>{current?.name ?? 'League home'}</p>
        </header>

        {current && current.standings !== null ? (
          <section mix={sectionStyle} aria-labelledby="top-teams-heading">
            <h2 id="top-teams-heading">Top teams</h2>
            <div mix={cardStyle}>
              {hasStandings
                ? <StandingsTable standings={current.standings} limit={5} />
                : <p mix={emptyStyle}>No official results yet.</p>}
            </div>
            {resultsHref ? <a href={resultsHref} mix={moreLinkStyle}>See all standings</a> : null}
          </section>
        ) : null}

        {current && current.playerTotals !== null ? (
          <section mix={sectionStyle} aria-labelledby="top-players-heading">
            <h2 id="top-players-heading">Top players</h2>
            <div mix={cardStyle}>
              {hasPlayers
                ? <PlayerLeaderList playerTotals={current.playerTotals} limit={10} />
                : <p mix={emptyStyle}>Player leaders will appear after the first official result.</p>}
            </div>
            {resultsHref ? <a href={resultsHref} mix={moreLinkStyle}>See full leaderboard</a> : null}
          </section>
        ) : null}

        {!current || (current.standings === null && current.playerTotals === null) ? (
          <p mix={[cardStyle, emptyStyle]}>No league results have been published yet.</p>
        ) : null}
      </AppShell>
    )
  }
}

const heroStyle = css({ textAlign: 'center', '& h1': { fontFamily: 'var(--font-happiness)', fontSize: 'clamp(40px, 8vw, 64px)', lineHeight: 1, margin: '20px 0 8px' }, '& p': { color: 'var(--text-soft)', fontSize: '16px', margin: 0 } })
const sectionStyle = css({ marginTop: '42px', '& h2': { fontSize: '21px', margin: '0 0 14px' } })
const emptyStyle = css({ color: 'var(--text-muted)', margin: 0 })
const moreLinkStyle = css({ border: '1px solid var(--border-strong)', borderRadius: '6px', display: 'inline-block', fontSize: '13px', marginTop: '12px', padding: '8px 14px', textDecoration: 'none' })
