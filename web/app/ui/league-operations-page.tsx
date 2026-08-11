import type { Handle } from 'remix/ui'
import { css } from 'remix/ui'

import type { LeagueDetail, SessionIdentity } from '../platform/model.ts'
import { administrativeRoles, runnerOperationRoles, scoringRoles } from '../platform/repository.ts'
import type { LeagueOperationsDashboard } from '../league-operations/service.ts'
import type { NotificationDashboard } from '../notifications/service.ts'
import type { RunnerOperationsDashboard } from '../runner/admin-service.ts'
import type { SeasonStatistics, TelemetryAttemptSummary } from '../telemetry/service.ts'
import { routes } from '../routes.ts'
import { AppShell, buttonStyle, cardStyle, inputStyle } from './app-shell.tsx'
import { TelemetryOperations } from './league-operations/telemetry-page.tsx'
import { TeamsOperationsPage } from './league-operations/teams-page.tsx'

interface LeagueOperationsPageProps {
  dashboard: RunnerOperationsDashboard
  error?: string
  identity: SessionIdentity
  league: LeagueDetail
  leagueOperations: LeagueOperationsDashboard
  notificationDashboard: NotificationDashboard
  oneTimeCredential?: string
  page: 'admin' | 'matches' | 'teams'
  seasonStatistics: Array<{ name: string; seasonId: string; statistics: SeasonStatistics }>
  telemetry: TelemetryAttemptSummary[]
}

export function LeagueOperationsPage(handle: Handle<LeagueOperationsPageProps>) {
  return () => {
    let { dashboard, error, identity, league, leagueOperations, notificationDashboard, oneTimeCredential, page, seasonStatistics, telemetry } = handle.props
    let teams = dashboard.seasons.flatMap((season) => season.teams)
    let mayAdminister = identity.isSiteAdmin || league.roles.some((role) => administrativeRoles.has(role))
    let mayOperateRunner = identity.isSiteAdmin || league.roles.some((role) => runnerOperationRoles.has(role))
    let mayScore = identity.isSiteAdmin || league.roles.some((role) => scoringRoles.has(role))
    return (
      <AppShell identity={identity} league={league} title={`${pageHeading(page)} · ${league.name} · Starworks`}>
        <header mix={heroStyle}>
          <h1 mix={headingStyle}>{pageHeading(page)}</h1>
          <span>{league.name}</span>
        </header>

        {error ? <p role="alert" mix={errorStyle}>{error}</p> : null}
        {page === 'admin' ? <section mix={[cardStyle, notificationStyle]} aria-labelledby="discord-notifications-heading">
          <div>
            <h2 id="discord-notifications-heading">Discord delivery</h2>
            <p mix={mutedStyle}>
              {notificationDashboard.channelId
                ? `Channel ${notificationDashboard.channelId} · ${notificationDashboard.sent} sent · ${notificationDashboard.pending} pending · ${notificationDashboard.failed} failed`
                : 'No league channel configured. Starworks continues normally without notification delivery.'}
            </p>
            {!notificationDashboard.botConfigured
              ? <p mix={warningStyle}>The server has no Discord bot token; configured messages remain in the durable outbox.</p>
              : null}
          </div>
          {mayAdminister ? <div mix={notificationActionsStyle}>
            <form action={routes.leagues.operations.configureDiscord.href({ leagueSlug: league.slug })} method="post" mix={inlineFormStyle}>
              <label>Discord channel ID<input name="channelId" pattern="[0-9]{17,20}" defaultValue={notificationDashboard.channelId ?? ''} placeholder="Leave blank to disable" mix={inputStyle} /></label>
              <button type="submit" mix={buttonStyle}>Save Discord channel</button>
            </form>
            {notificationDashboard.pending || notificationDashboard.failed ? (
              <form action={routes.leagues.operations.retryDiscord.href({ leagueSlug: league.slug })} method="post">
                <button type="submit" mix={secondaryButtonStyle}>Retry queued messages</button>
              </form>
            ) : null}
          </div> : null}
        </section> : null}
        {page === 'teams' ? <TeamsOperationsPage identity={identity} league={league} mayAdminister={mayAdminister} operations={leagueOperations} /> : null}
        {page === 'admin' && oneTimeCredential ? (
          <section mix={[cardStyle, credentialStyle]} aria-labelledby="credential-heading">
            <h2 id="credential-heading">Copy this credential now</h2>
            <p>It is shown once. Paste it into the Python runner; Starworks stores only its hash.</p>
            <code mix={codeStyle}>{oneTimeCredential}</code>
          </section>
        ) : null}

        {mayOperateRunner && page !== 'teams' ? <>
        <div mix={twoColumnStyle}>
          {page === 'matches' ? <section mix={cardStyle} aria-labelledby="schedule-heading">
            <h2 id="schedule-heading">Schedule a match</h2>
            <form action={routes.leagues.operations.scheduleMatch.href({ leagueSlug: league.slug })} method="post" mix={formStyle}>
              <label>Season<select name="seasonId" required mix={inputStyle}>
                {dashboard.seasons.map((season) => <option value={season.id}>{season.name}</option>)}
              </select></label>
              <label>Home team<select name="homeTeamId" required defaultValue={teams[0]?.id} mix={inputStyle}>
                {teams.map((team) => <option value={team.id}>{team.name}</option>)}
              </select></label>
              <label>Away team<select name="awayTeamId" required defaultValue={teams[1]?.id ?? teams[0]?.id} mix={inputStyle}>
                {teams.map((team) => <option value={team.id}>{team.name}</option>)}
              </select></label>
              <label>Scheduled time<input type="datetime-local" name="scheduledAt" mix={inputStyle} /></label>
              <label>Venue<select name="venueId" mix={inputStyle}>
                <option value="">No league venue</option>
                {dashboard.venues.map((venue) => <option value={venue.id}>{venue.name}{venue.gameVenueId ? ` · ${venue.gameVenueId}` : ''}</option>)}
              </select></label>
              <button type="submit" mix={buttonStyle}>Schedule match</button>
            </form>
          </section> : null}

          {page === 'admin' ? <section mix={cardStyle} aria-labelledby="station-enrollment-heading">
            <h2 id="station-enrollment-heading">Enroll a runner station</h2>
            <p mix={mutedStyle}>Issue one credential with only match execution, artifact, heartbeat, and telemetry scopes.</p>
            <form action={routes.leagues.operations.issueCredential.href({ leagueSlug: league.slug })} method="post" mix={formStyle}>
              <label>Credential name<input name="name" required placeholder="Tournament desk one" mix={inputStyle} /></label>
              <button type="submit" mix={buttonStyle}>Issue station credential</button>
            </form>
          </section> : null}
        </div>

        {page === 'matches' ? <section aria-labelledby="matches-heading" mix={sectionStyle}>
          <div mix={sectionHeadingStyle}>
            <h2 id="matches-heading">Matches and attempts</h2>
            <span mix={countStyle}>{dashboard.matches.length} scheduled</span>
          </div>
          {dashboard.matches.length ? dashboard.matches.map((match) => {
            let home = teams.find((team) => team.id === match.homeTeamId)
            let away = teams.find((team) => team.id === match.awayTeamId)
            return (
              <article mix={[cardStyle, matchStyle]}>
                <div mix={matchHeaderStyle}>
                  <div><strong>{match.awayTeamName} at {match.homeTeamName}</strong><p mix={mutedStyle}>{match.scheduledAt?.toLocaleString() ?? 'Time not set'} · {match.status}</p></div>
                  <span mix={statusStyle}>{match.attempts.length} attempt{match.attempts.length === 1 ? '' : 's'}</span>
                </div>
                {match.attempts.length ? <ol mix={attemptListStyle}>{match.attempts.map((attempt) => (
                  <li>#{attempt.attemptNumber} · {attempt.status}{attempt.failureKind ? ` · ${attempt.failureKind}` : ''} · build <code>{attempt.requiredGameBuildSha256.slice(0, 12)}</code></li>
                ))}</ol> : null}
                <form action={routes.leagues.operations.queueAttempt.href({ leagueSlug: league.slug, matchId: match.id })} method="post" mix={queueFormStyle}>
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
                    <option value="">Runtime-only / stock assets</option>
                    {dashboard.contentPacks.map((pack) => <option value={pack.id}>{pack.name} · revision {pack.revisionNumber}</option>)}
                  </select></label>
                  <label>Game stadium<input name="gameStadiumId" required defaultValue="mario-stadium" pattern="[a-z0-9][a-z0-9-]{0,63}" mix={inputStyle} /></label>
                  <label mix={wideStyle}>Required game-build SHA-256<input name="requiredGameBuildSha256" required pattern="[a-f0-9]{64}" defaultValue={match.attempts.at(-1)?.requiredGameBuildSha256} placeholder="64 lowercase hexadecimal characters" mix={inputStyle} /></label>
                  <label mix={wideStyle}>Dynamic rule overrides<textarea name="dynamicRuleOverrides" rows={3} defaultValue="{}" mix={inputStyle} /></label>
                  <button type="submit" mix={buttonStyle}>Queue immutable attempt</button>
                </form>
              </article>
            )
          }) : <p mix={emptyStyle}>No matches are scheduled yet.</p>}
        </section> : null}

        {page === 'admin' ? <section aria-labelledby="stations-heading" mix={sectionStyle}>
          <div mix={sectionHeadingStyle}><h2 id="stations-heading">Stations</h2><span mix={countStyle}>{dashboard.stations.length} registered</span></div>
          <div mix={stationGridStyle}>
            {dashboard.stations.map((station) => (
              <article mix={cardStyle}>
                <h3>{station.name}</h3>
                <p mix={mutedStyle}>{station.status} · {station.runtimeState}</p>
                <p mix={mutedStyle}>Last heartbeat: {station.lastHeartbeatAt?.toLocaleString() ?? 'never'}</p>
                {Object.keys(station.componentHealth).length ? <ul mix={healthListStyle} aria-label="Runner component health">
                  {Object.entries(station.componentHealth).map(([component, state]) => <li><span>{component}</span><strong>{state}</strong></li>)}
                </ul> : null}
                {station.status === 'active' ? <form action={routes.leagues.operations.revokeStation.href({ leagueSlug: league.slug, stationId: station.id })} method="post">
                  <button type="submit" mix={dangerStyle}>Revoke station</button>
                </form> : null}
              </article>
            ))}
            {!dashboard.stations.length ? <p mix={emptyStyle}>No station has enrolled with an issued credential.</p> : null}
          </div>
        </section> : null}

        {page === 'admin' ? <section aria-labelledby="audit-heading" mix={sectionStyle}>
          <div mix={sectionHeadingStyle}>
            <h2 id="audit-heading">Audit history</h2>
            <span mix={countStyle}>Latest {dashboard.audit.length}</span>
          </div>
          <ol mix={auditListStyle}>
            {dashboard.audit.map((record) => <li mix={cardStyle}>
              <div mix={matchHeaderStyle}>
                <div><strong>{record.action}</strong><p mix={mutedStyle}>{record.actorDisplayName ?? 'System'} · {record.occurredAt.toLocaleString()}</p></div>
                <code>{record.targetType}</code>
              </div>
              <p mix={mutedStyle}>Target <code>{record.targetId}</code></p>
              {Object.keys(record.metadata).length ? <pre mix={codeStyle}>{JSON.stringify(record.metadata, null, 2)}</pre> : null}
            </li>)}
            {!dashboard.audit.length ? <li mix={emptyStyle}>No audited changes have been recorded.</li> : null}
          </ol>
        </section> : null}
        </> : null}
        {page === 'matches' ? <TelemetryOperations
          attempts={telemetry}
          league={league}
          mayAdminister={mayScore}
          seasonStatistics={seasonStatistics}
        /> : null}
      </AppShell>
    )
  }
}

function pageHeading(page: LeagueOperationsPageProps['page']): string {
  if (page === 'teams') return 'Teams'
  if (page === 'admin') return 'Admin'
  return 'Matches'
}

const headingStyle = css({ fontFamily: 'var(--font-display)', fontSize: 'clamp(34px, 5vw, 48px)', lineHeight: 1.08, margin: 0 })
const heroStyle = css({ alignItems: 'baseline', display: 'flex', gap: '16px', '& span': { color: 'var(--text-muted)' } })
const errorStyle = css({ background: 'var(--danger-surface)', border: '1px solid var(--danger-border)', borderRadius: '12px', marginTop: '28px', padding: '14px 18px' })
const credentialStyle = css({ borderColor: 'var(--accent-yellow)', marginTop: '28px' })
const notificationStyle = css({ display: 'grid', gap: '18px', marginTop: '28px' })
const notificationActionsStyle = css({ alignItems: 'end', display: 'flex', flexWrap: 'wrap', gap: '12px' })
const inlineFormStyle = css({ alignItems: 'end', display: 'flex', flex: '1 1 520px', flexWrap: 'wrap', gap: '10px', '& label': { display: 'grid', flex: '1 1 240px', fontWeight: 700, gap: '7px' } })
const warningStyle = css({ color: 'var(--warning-text)', marginBottom: 0 })
const codeStyle = css({ background: 'var(--surface-deep)', borderRadius: '8px', display: 'block', overflowWrap: 'anywhere', padding: '14px' })
const twoColumnStyle = css({ display: 'grid', gap: '24px', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 330px), 1fr))', marginTop: '32px' })
const formStyle = css({ display: 'grid', gap: '14px', marginTop: '18px', '& label': { display: 'grid', gap: '7px', fontWeight: 700 } })
const mutedStyle = css({ color: 'var(--text-muted)', lineHeight: 1.5 })
const sectionStyle = css({ marginTop: '56px' })
const sectionHeadingStyle = css({ alignItems: 'end', display: 'flex', gap: '20px', justifyContent: 'space-between', marginBottom: '18px', '& h2': { fontSize: '36px', margin: 0 } })
const countStyle = css({ color: 'var(--text-muted)', fontWeight: 800 })
const matchStyle = css({ display: 'grid', gap: '20px', marginBottom: '18px' })
const matchHeaderStyle = css({ alignItems: 'start', display: 'flex', gap: '20px', justifyContent: 'space-between', '& strong': { fontSize: '20px' } })
const statusStyle = css({ background: 'var(--surface-strong)', borderRadius: '999px', padding: '6px 10px', whiteSpace: 'nowrap' })
const attemptListStyle = css({ color: 'var(--text-soft)', display: 'grid', gap: '6px', margin: 0 })
const queueFormStyle = css({ display: 'grid', gap: '14px', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 220px), 1fr))', '& label': { display: 'grid', gap: '7px', fontWeight: 700 } })
const wideStyle = css({ gridColumn: '1 / -1' })
const stationGridStyle = css({ display: 'grid', gap: '18px', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 260px), 1fr))' })
const healthListStyle = css({ display: 'grid', gap: '7px', listStyle: 'none', margin: '12px 0 0', padding: 0, '& li': { alignItems: 'center', background: 'var(--surface-deep)', borderRadius: '8px', display: 'flex', justifyContent: 'space-between', padding: '7px 9px' }, '& span': { color: 'var(--text-muted)', textTransform: 'capitalize' }, '& strong': { color: 'var(--success-text)', fontSize: '11px', textTransform: 'uppercase' } })
const auditListStyle = css({ display: 'grid', gap: '12px', listStyle: 'none', margin: 0, padding: 0, '& li': { display: 'grid', gap: '8px' }, '& p': { margin: 0 } })
const dangerStyle = css({ background: 'var(--danger-button)', border: '1px solid var(--danger-border)', borderRadius: '9px', color: 'var(--text-primary)', cursor: 'pointer', font: 'inherit', fontWeight: 800, marginTop: '12px', padding: '9px 12px' })
const emptyStyle = css({ border: '1px dashed var(--border-strong)', borderRadius: '14px', color: 'var(--text-muted)', padding: '22px' })
const secondaryButtonStyle = css({ background: 'var(--surface-strong)', border: '1px solid var(--border-strong)', borderRadius: '9px', color: 'var(--text-primary)', cursor: 'pointer', font: 'inherit', fontWeight: 800, padding: '9px 12px' })
