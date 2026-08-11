import type { Handle } from 'remix/ui'
import { css } from 'remix/ui'

import type { NotificationDashboard } from '../../notifications/service.ts'
import type { LeagueDetail, SessionIdentity } from '../../platform/model.ts'
import type { RunnerStationDashboard } from '../../runner/admin-service.ts'
import { routes } from '../../routes.ts'
import { buttonStyle, cardStyle, inputStyle } from '../app-shell.tsx'
import { emptyStyle, mutedStyle, OperationsShell, SectionHeading, sectionStyle } from './workspace-page.tsx'

export function LeagueAdminPage(handle: Handle<{
  dashboard: RunnerStationDashboard
  identity: SessionIdentity
  league: LeagueDetail
  notification: NotificationDashboard
  oneTimeCredential?: string
}>) {
  return () => {
    let { dashboard, identity, league, notification, oneTimeCredential } = handle.props
    return (
      <OperationsShell heading="Admin" identity={identity} league={league}>
        {oneTimeCredential ? (
          <section mix={[cardStyle, credentialStyle]} aria-labelledby="credential-heading">
            <h2 id="credential-heading">Runner credential</h2>
            <p>Copy this once and paste it into the station. Starworks stores only its hash.</p>
            <code mix={credentialCodeStyle}>{oneTimeCredential}</code>
          </section>
        ) : null}

        <div mix={adminGridStyle}>
          <section mix={cardStyle} aria-labelledby="publication-heading">
            <h2 id="publication-heading">Public access</h2>
            <p mix={mutedStyle}>Choose what visitors can see without joining the league.</p>
            <form action={routes.leagues.operations.admin.updatePublication.href({ leagueSlug: league.slug })} method="post" mix={formStyle}>
              <Checkbox name="leagueVisible" checked={league.publication.leagueVisible} label="League home" />
              <Checkbox name="standingsVisible" checked={league.publication.standingsVisible} label="Standings" />
              <Checkbox name="statsVisible" checked={league.publication.statsVisible} label="Player statistics" />
              <Checkbox name="draftVisible" checked={league.publication.draftVisible} label="Draft" />
              <button type="submit" mix={buttonStyle}>Save public access</button>
            </form>
          </section>

          <section mix={cardStyle} aria-labelledby="discord-heading">
            <h2 id="discord-heading">Discord</h2>
            <p mix={mutedStyle}>{notification.channelId
              ? `${notification.sent} sent · ${notification.pending} pending · ${notification.failed} failed`
              : 'No league channel is connected.'}</p>
            {!notification.botConfigured ? <p mix={warningStyle}>Discord delivery is disabled on this server.</p> : null}
            <form action={routes.leagues.operations.admin.configureDiscord.href({ leagueSlug: league.slug })} method="post" mix={formStyle}>
              <label>Channel ID<input name="channelId" pattern="[0-9]{17,20}" defaultValue={notification.channelId ?? ''} mix={inputStyle} /></label>
              <button type="submit" mix={buttonStyle}>Save channel</button>
            </form>
            {notification.pending || notification.failed ? (
              <form action={routes.leagues.operations.admin.retryDiscord.href({ leagueSlug: league.slug })} method="post">
                <button type="submit" mix={secondaryButtonStyle}>Retry queued messages</button>
              </form>
            ) : null}
          </section>

          <section mix={cardStyle} aria-labelledby="enrollment-heading">
            <h2 id="enrollment-heading">Add a runner</h2>
            <p mix={mutedStyle}>Issue one credential for a Dolphin station.</p>
            <form action={routes.leagues.operations.admin.issueCredential.href({ leagueSlug: league.slug })} method="post" mix={formStyle}>
              <label>Station name<input name="name" required mix={inputStyle} /></label>
              <button type="submit" mix={buttonStyle}>Issue credential</button>
            </form>
          </section>
        </div>

        <section aria-labelledby="stations-heading" mix={sectionStyle}>
          <SectionHeading id="stations-heading" heading="Runner stations" count={dashboard.stations.length} />
          <div mix={stationGridStyle}>
            {dashboard.stations.map((station) => (
              <article mix={[cardStyle, stationStyle]}>
                <div mix={stationHeadingStyle}><h3>{station.name}</h3><span>{station.status}</span></div>
                <p mix={mutedStyle}>Last heartbeat: {station.lastHeartbeatAt?.toLocaleString() ?? 'never'}</p>
                {Object.keys(station.componentHealth).length ? <ul mix={healthListStyle}>
                  {Object.entries(station.componentHealth).map(([component, state]) => <li><span>{component}</span><strong>{state}</strong></li>)}
                </ul> : null}
                {station.status === 'active' ? <form action={routes.leagues.operations.admin.revokeStation.href({ leagueSlug: league.slug, stationId: station.id })} method="post">
                  <button type="submit" mix={dangerStyle}>Revoke station</button>
                </form> : null}
              </article>
            ))}
            {!dashboard.stations.length ? <p mix={emptyStyle}>No runner stations have enrolled.</p> : null}
          </div>
        </section>

        <section aria-labelledby="audit-heading" mix={sectionStyle}>
          <SectionHeading id="audit-heading" heading="Recent activity" count={dashboard.audit.length} />
          <ol mix={activityListStyle}>
            {dashboard.audit.map((record) => (
              <li>
                <strong>{activityName(record.action)}</strong>
                <span>{record.actorDisplayName ?? 'Starworks'} · {record.occurredAt.toLocaleString()}</span>
              </li>
            ))}
            {!dashboard.audit.length ? <li mix={emptyStyle}>No administrative activity yet.</li> : null}
          </ol>
        </section>
      </OperationsShell>
    )
  }
}

function Checkbox(handle: Handle<{ checked: boolean; label: string; name: string }>) {
  return () => (
    <label data-checkbox mix={checkboxStyle}>
      <input type="checkbox" name={handle.props.name} defaultChecked={handle.props.checked} />
      <span>{handle.props.label}</span>
    </label>
  )
}

function activityName(action: string): string {
  return action.split('.').map((part) => part.replaceAll('_', ' ')).join(' · ')
}

const credentialStyle = css({ borderColor: 'var(--accent-yellow)', marginBottom: '24px' })
const credentialCodeStyle = css({ background: 'var(--surface-deep)', borderRadius: '8px', display: 'block', overflowWrap: 'anywhere', padding: '14px' })
const adminGridStyle = css({ display: 'grid', gap: '20px', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 330px), 1fr))', '& h2': { marginTop: 0 } })
const formStyle = css({ display: 'grid', gap: '12px', marginTop: '18px', '& label:not([data-checkbox])': { display: 'grid', gap: '7px', fontWeight: 700 } })
const checkboxStyle = css({ alignItems: 'center', display: 'flex', fontWeight: 500, gap: '9px' })
const warningStyle = css({ color: 'var(--warning-text)' })
const secondaryButtonStyle = css({ background: 'var(--surface-strong)', border: '1px solid var(--border-strong)', borderRadius: '7px', color: 'var(--text-primary)', cursor: 'pointer', font: 'inherit', fontWeight: 800, marginTop: '12px', padding: '9px 12px' })
const stationGridStyle = css({ display: 'grid', gap: '16px', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 260px), 1fr))' })
const stationStyle = css({ display: 'grid', gap: '12px' })
const stationHeadingStyle = css({ alignItems: 'center', display: 'flex', gap: '12px', justifyContent: 'space-between', '& h3': { fontSize: '21px', margin: 0 }, '& span': { background: 'var(--surface-strong)', borderRadius: '999px', fontSize: '11px', fontWeight: 800, padding: '5px 8px', textTransform: 'uppercase' } })
const healthListStyle = css({ display: 'grid', gap: '7px', listStyle: 'none', margin: 0, padding: 0, '& li': { alignItems: 'center', background: 'var(--surface-deep)', borderRadius: '8px', display: 'flex', justifyContent: 'space-between', padding: '7px 9px' }, '& span': { color: 'var(--text-muted)', textTransform: 'capitalize' }, '& strong': { color: 'var(--success-text)', fontSize: '11px', textTransform: 'uppercase' } })
const dangerStyle = css({ background: 'var(--danger-button)', border: '1px solid var(--danger-border)', borderRadius: '7px', color: 'var(--text-primary)', cursor: 'pointer', font: 'inherit', fontWeight: 800, padding: '9px 12px' })
const activityListStyle = css({ borderTop: '1px solid var(--border)', listStyle: 'none', margin: 0, padding: 0, '& li': { borderBottom: '1px solid var(--border)', display: 'grid', gap: '4px', padding: '12px 4px' }, '& span': { color: 'var(--text-muted)', fontSize: '14px' } })
