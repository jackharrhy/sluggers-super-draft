import type { Handle } from 'remix/ui'
import { css } from 'remix/ui'

import type { LeagueDetail, SessionIdentity } from '../../platform/model.ts'
import type { RunnerMatchDashboard } from '../../runner/admin-service.ts'
import { routes } from '../../routes.ts'
import { buttonStyle, cardStyle, inputStyle } from '../app-shell.tsx'
import { emptyStyle, mutedStyle, OperationsShell, SectionHeading, sectionStyle } from './workspace-page.tsx'

export function LeagueMatchesPage(handle: Handle<{
  dashboard: RunnerMatchDashboard
  identity: SessionIdentity
  league: LeagueDetail
  mayOperate: boolean
}>) {
  return () => {
    let { dashboard, identity, league, mayOperate } = handle.props
    let teams = dashboard.seasons.flatMap((season) => season.teams)
    let matches = dashboard.matches.filter((match) => ['scheduled', 'in_progress'].includes(match.status))
    return (
      <OperationsShell heading="Matches" identity={identity} league={league}>
        {!mayOperate ? (
          <p mix={emptyStyle}>Match scheduling and runner attempts are available to commissioners and runner operators.</p>
        ) : <>
          <section mix={[cardStyle, scheduleStyle]} aria-labelledby="schedule-heading">
            <div>
              <h2 id="schedule-heading">Schedule a match</h2>
              <p mix={mutedStyle}>Choose the teams and time. Game configuration is selected when the runner attempt is queued.</p>
            </div>
            <form action={routes.leagues.operations.matches.schedule.href({ leagueSlug: league.slug })} method="post" mix={formStyle}>
              <label>Season<select name="seasonId" required mix={inputStyle}>
                {dashboard.seasons.map((season) => <option value={season.id}>{season.name}</option>)}
              </select></label>
              <label>Home team<select name="homeTeamId" required mix={inputStyle}>
                {teams.map((team, index) => <option value={team.id} selected={index === 0}>{team.name}</option>)}
              </select></label>
              <label>Away team<select name="awayTeamId" required mix={inputStyle}>
                {teams.map((team, index) => <option value={team.id} selected={index === (teams.length > 1 ? 1 : 0)}>{team.name}</option>)}
              </select></label>
              <label>Scheduled time<input type="datetime-local" name="scheduledAt" mix={inputStyle} /></label>
              <label>Venue<select name="venueId" mix={inputStyle}>
                <option value="">No league venue</option>
                {dashboard.venues.map((venue) => <option value={venue.id}>{venue.name}</option>)}
              </select></label>
              <button type="submit" mix={buttonStyle}>Schedule match</button>
            </form>
          </section>

          <section aria-labelledby="matches-heading" mix={sectionStyle}>
            <SectionHeading id="matches-heading" heading="Schedule" count={matches.length} />
            <div mix={matchListStyle}>
              {matches.map((match) => {
                let home = teams.find((team) => team.id === match.homeTeamId)
                let away = teams.find((team) => team.id === match.awayTeamId)
                return (
                  <article mix={[cardStyle, matchStyle]}>
                    <div mix={matchHeadingStyle}>
                      <div>
                        <h3>{match.awayTeamName} at {match.homeTeamName}</h3>
                        <p mix={mutedStyle}>{match.scheduledAt?.toLocaleString() ?? 'Time not set'}</p>
                      </div>
                      <span mix={statusStyle}>{match.status}</span>
                    </div>
                    {match.attempts.length ? (
                      <ol mix={attemptListStyle}>{match.attempts.map((attempt) => (
                        <li><strong>Attempt {attempt.attemptNumber}</strong><span>{attempt.status}{attempt.failureKind ? ` · ${attempt.failureKind}` : ''}</span></li>
                      ))}</ol>
                    ) : <p mix={mutedStyle}>No runner attempt has been queued.</p>}
                    <details>
                      <summary>Queue runner attempt</summary>
                      <form action={routes.leagues.operations.matches.queueAttempt.href({ leagueSlug: league.slug, matchId: match.id })} method="post" mix={queueFormStyle}>
                        <label>Home lineup<select name="homeLineupRevisionId" required mix={inputStyle}>
                          {home?.lineups.map((lineup) => <option value={lineup.id}>{home.name} · revision {lineup.revisionNumber}</option>)}
                        </select></label>
                        <label>Away lineup<select name="awayLineupRevisionId" required mix={inputStyle}>
                          {away?.lineups.map((lineup) => <option value={lineup.id}>{away.name} · revision {lineup.revisionNumber}</option>)}
                        </select></label>
                        <label>Stat profile<select name="statProfileRevisionId" required mix={inputStyle}>
                          {dashboard.statProfiles.map((profile) => <option value={profile.id}>{profile.name} · revision {profile.revisionNumber}</option>)}
                        </select></label>
                        <label>Ruleset<select name="rulesetRevisionId" required mix={inputStyle}>
                          {dashboard.rulesets.map((ruleset) => <option value={ruleset.id}>{ruleset.name} · revision {ruleset.revisionNumber}</option>)}
                        </select></label>
                        <label>Content pack<select name="contentPackRevisionId" mix={inputStyle}>
                          <option value="">Stock assets</option>
                          {dashboard.contentPacks.map((pack) => <option value={pack.id}>{pack.name} · revision {pack.revisionNumber}</option>)}
                        </select></label>
                        <label>Stadium<input name="gameStadiumId" required defaultValue="mario-stadium" pattern="[a-z0-9][a-z0-9-]{0,63}" mix={inputStyle} /></label>
                        <label mix={wideStyle}>Game build SHA-256<input name="requiredGameBuildSha256" required pattern="[a-f0-9]{64}" defaultValue={match.attempts.at(-1)?.requiredGameBuildSha256} mix={inputStyle} /></label>
                        <button type="submit" mix={buttonStyle}>Queue attempt</button>
                      </form>
                    </details>
                  </article>
                )
              })}
              {!matches.length ? <p mix={emptyStyle}>No matches are waiting to run.</p> : null}
            </div>
          </section>
        </>}
      </OperationsShell>
    )
  }
}

const scheduleStyle = css({ display: 'grid', gap: '18px', maxWidth: '900px', '& h2': { margin: 0 } })
const formStyle = css({ display: 'grid', gap: '14px', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 200px), 1fr))', '& label': { display: 'grid', gap: '7px', fontWeight: 700 } })
const matchListStyle = css({ display: 'grid', gap: '16px' })
const matchStyle = css({ display: 'grid', gap: '18px' })
const matchHeadingStyle = css({ alignItems: 'start', display: 'flex', gap: '18px', justifyContent: 'space-between', '& h3': { fontSize: '23px', margin: 0 }, '& p': { margin: '6px 0 0' } })
const statusStyle = css({ background: 'var(--surface-strong)', borderRadius: '999px', fontSize: '12px', fontWeight: 800, padding: '6px 10px', textTransform: 'capitalize', whiteSpace: 'nowrap' })
const attemptListStyle = css({ display: 'grid', gap: '7px', listStyle: 'none', margin: 0, padding: 0, '& li': { alignItems: 'center', background: 'var(--surface-deep)', borderRadius: '8px', display: 'flex', gap: '14px', justifyContent: 'space-between', padding: '9px 11px' }, '& span': { color: 'var(--text-muted)' } })
const queueFormStyle = css({ display: 'grid', gap: '14px', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 210px), 1fr))', marginTop: '16px', '& label': { display: 'grid', gap: '7px', fontWeight: 700 } })
const wideStyle = css({ gridColumn: '1 / -1' })
