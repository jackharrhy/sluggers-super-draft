import type { Handle } from 'remix/ui'
import { css } from 'remix/ui'

import type { LeagueSummary, SessionIdentity } from '../platform/model.ts'
import { routes } from '../routes.ts'
import { AppShell, cardStyle } from './app-shell.tsx'

export function HomePage(
  handle: Handle<{ identity: SessionIdentity | null; leagues: LeagueSummary[] }>,
) {
  return () => {
    let { identity, leagues } = handle.props
    return (
      <AppShell identity={identity}>
        <section mix={heroStyle}>
          <p mix={eyebrowStyle}>Mario Super Sluggers league operations</p>
          <h1 mix={headingStyle}>One home for every Sluggers league.</h1>
          <p mix={ledeStyle}>
            Draft teams, publish custom stats and rules, run Dolphin matches, collect telemetry, and
            produce broadcasts without making yesterday&apos;s file formats tomorrow&apos;s platform.
          </p>
        </section>

        <section aria-labelledby="leagues-heading" mix={sectionStyle}>
          <div>
            <p mix={eyebrowStyle}>League directory</p>
            <h2 id="leagues-heading" mix={subheadingStyle}>Your leagues and public leagues</h2>
          </div>
          {leagues.length ? (
            <div mix={gridStyle}>
              {leagues.map((league) => (
                <article mix={cardStyle} key={league.id}>
                  <h3 mix={leagueHeadingStyle}>
                    <a href={routes.leagues.show.href({ leagueSlug: league.slug })}>{league.name}</a>
                  </h3>
                  <p mix={mutedStyle}>
                    {league.roles.length ? league.roles.join(', ') : 'Public league'}
                  </p>
                </article>
              ))}
            </div>
          ) : (
            <div mix={cardStyle}>
              <p mix={bodyStyle}>No public or assigned leagues are available yet.</p>
              <p mix={mutedStyle}>
                New leagues are created by the Starworks site administrator. Ask for an invitation
                in the community Discord; there is no public account registration.
              </p>
            </div>
          )}
        </section>
      </AppShell>
    )
  }
}

const heroStyle = css({ maxWidth: '880px', padding: '28px 0 12px' })
const eyebrowStyle = css({
  color: 'var(--text-soft)',
  fontFamily: 'var(--font-aurea)',
  fontSize: '15px',
  letterSpacing: '0.08em',
  margin: '0 0 12px',
  textTransform: 'uppercase',
})
const headingStyle = css({ fontFamily: 'var(--font-display)', fontSize: 'clamp(36px, 6vw, 58px)', lineHeight: 1.05, margin: 0, textShadow: '0 3px 0 rgb(30 41 86 / 0.22)' })
const subheadingStyle = css({ fontFamily: 'var(--font-display)', fontSize: '28px', margin: 0 })
const ledeStyle = css({ color: 'var(--text-soft)', fontSize: '18px', lineHeight: 1.6, margin: '22px 0 0', maxWidth: '760px' })
const sectionStyle = css({ display: 'grid', gap: '20px', marginTop: '52px' })
const gridStyle = css({ display: 'grid', gap: '16px', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' })
const leagueHeadingStyle = css({ fontSize: '22px', margin: '0 0 10px' })
const bodyStyle = css({ fontSize: '18px', margin: '0 0 8px' })
const mutedStyle = css({ color: 'var(--text-muted)', lineHeight: 1.6, margin: 0 })
