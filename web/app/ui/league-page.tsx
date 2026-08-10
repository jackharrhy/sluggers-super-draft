import type { Handle } from 'remix/ui'
import { css } from 'remix/ui'

import type { LeagueDetail, SessionIdentity } from '../platform/model.ts'
import { administrativeRoles } from '../platform/repository.ts'
import { routes } from '../routes.ts'
import { AppShell, buttonStyle, cardStyle } from './app-shell.tsx'

export function LeaguePage(
  handle: Handle<{ identity: SessionIdentity | null; league: LeagueDetail }>,
) {
  return () => {
    let { identity, league } = handle.props
    let mayAdminister = identity?.isSiteAdmin || league.roles.some((role) => administrativeRoles.has(role))
    return (
      <AppShell identity={identity} title={`${league.name} · Starworks`}>
        <section>
          <p mix={eyebrowStyle}>{league.publication.leagueVisible ? 'Public league' : 'Private league'}</p>
          <h1 mix={headingStyle}>{league.name}</h1>
          <p mix={ledeStyle}>
            Drafts, teams, stat profiles, rulesets, match operations, and broadcasts will live under
            this league boundary.
          </p>
        </section>
        {mayAdminister ? (
          <>
          <section mix={[cardStyle, settingsStyle]} aria-labelledby="configuration-heading">
            <div>
              <h2 id="configuration-heading" mix={subheadingStyle}>League configuration</h2>
              <p mix={mutedStyle}>Build versioned stat profiles, rulesets, rosters, and game-ready lineups.</p>
            </div>
            <a href={routes.leagues.configuration.dashboard.href({ leagueSlug: league.slug })}>Open configuration workspace</a>
          </section>
          <section mix={[cardStyle, settingsStyle]} aria-labelledby="operations-heading">
            <div>
              <h2 id="operations-heading" mix={subheadingStyle}>Match operations</h2>
              <p mix={mutedStyle}>Schedule games, queue immutable attempts, and manage native runner stations.</p>
            </div>
            <a href={routes.leagues.operations.dashboard.href({ leagueSlug: league.slug })}>Open operations workspace</a>
          </section>
          <section mix={[cardStyle, settingsStyle]} aria-labelledby="publication-heading">
            <div>
              <h2 id="publication-heading" mix={subheadingStyle}>Publication policy</h2>
              <p mix={mutedStyle}>Nothing becomes public simply because the league exists.</p>
            </div>
            <form action={routes.leagues.updatePublication.href({ leagueSlug: league.slug })} method="post" mix={formStyle}>
              <Checkbox name="leagueVisible" checked={league.publication.leagueVisible} label="League page" />
              <Checkbox name="standingsVisible" checked={league.publication.standingsVisible} label="Standings" />
              <Checkbox name="statsVisible" checked={league.publication.statsVisible} label="Statistics" />
              <Checkbox name="draftVisible" checked={league.publication.draftVisible} label="Draft" />
              <button type="submit" mix={buttonStyle}>Save publication policy</button>
            </form>
          </section>
          </>
        ) : null}
        {identity ? (
          <section mix={[cardStyle, settingsStyle]} aria-labelledby="draft-heading">
            <div>
              <h2 id="draft-heading" mix={subheadingStyle}>Draft room</h2>
              <p mix={mutedStyle}>Follow the live order, manage a private queue, and make server-authoritative picks.</p>
            </div>
            <a href={routes.leagues.drafts.dashboard.href({ leagueSlug: league.slug })}>Open draft workspace</a>
          </section>
        ) : null}
      </AppShell>
    )
  }
}

function Checkbox(handle: Handle<{ checked: boolean; label: string; name: string }>) {
  return () => (
    <label mix={checkboxStyle}>
      <input type="checkbox" name={handle.props.name} defaultChecked={handle.props.checked} />
      <span>{handle.props.label}</span>
    </label>
  )
}

const eyebrowStyle = css({ color: '#f7c948', fontSize: '13px', fontWeight: 800, letterSpacing: '0.12em', margin: '0 0 12px', textTransform: 'uppercase' })
const headingStyle = css({ fontSize: '64px', letterSpacing: '-0.055em', lineHeight: 1, margin: 0 })
const subheadingStyle = css({ fontSize: '30px', letterSpacing: '-0.04em', margin: '0 0 6px' })
const ledeStyle = css({ color: '#c9d4e9', fontSize: '18px', lineHeight: 1.65, maxWidth: '700px' })
const mutedStyle = css({ color: '#9faec8', margin: 0 })
const settingsStyle = css({ display: 'grid', gap: '28px', marginTop: '56px', maxWidth: '760px' })
const formStyle = css({ display: 'grid', gap: '14px', justifyItems: 'start' })
const checkboxStyle = css({ alignItems: 'center', display: 'flex', gap: '10px' })
