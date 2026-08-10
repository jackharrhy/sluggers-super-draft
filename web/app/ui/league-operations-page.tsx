import type { Handle } from 'remix/ui'
import { css } from 'remix/ui'

import type { LeagueDetail, SessionIdentity } from '../platform/model.ts'
import { administrativeRoles } from '../platform/repository.ts'
import type { LeagueOperationsDashboard } from '../league-operations/service.ts'
import type { RunnerOperationsDashboard } from '../runner/admin-service.ts'
import { routes } from '../routes.ts'
import { AppShell, buttonStyle, cardStyle, inputStyle } from './app-shell.tsx'

interface LeagueOperationsPageProps {
  dashboard: RunnerOperationsDashboard
  error?: string
  identity: SessionIdentity
  league: LeagueDetail
  leagueOperations: LeagueOperationsDashboard
  oneTimeCredential?: string
}

export function LeagueOperationsPage(handle: Handle<LeagueOperationsPageProps>) {
  return () => {
    let { dashboard, error, identity, league, leagueOperations, oneTimeCredential } = handle.props
    let teams = dashboard.seasons.flatMap((season) => season.teams)
    let mayAdminister = identity.isSiteAdmin || league.roles.some((role) => administrativeRoles.has(role))
    return (
      <AppShell identity={identity} title={`${league.name} operations · Starworks`}>
        <header mix={heroStyle}>
          <div>
            <p mix={eyebrowStyle}>Match control</p>
            <h1 mix={headingStyle}>{league.name} operations</h1>
            <p mix={ledeStyle}>Schedule immutable attempts, enroll native stations, and inspect execution recovery from one tenant-scoped workspace.</p>
          </div>
          <nav mix={linkRowStyle} aria-label="League workspaces">
            <a href={routes.leagues.show.href({ leagueSlug: league.slug })}>League home</a>
            <a href={routes.leagues.drafts.dashboard.href({ leagueSlug: league.slug })}>Draft room</a>
            <a href={routes.leagues.configuration.dashboard.href({ leagueSlug: league.slug })}>Configuration</a>
          </nav>
        </header>

        {error ? <p role="alert" mix={errorStyle}>{error}</p> : null}
        <RosterOperations identity={identity} league={league} mayAdminister={mayAdminister} operations={leagueOperations} />
        {oneTimeCredential ? (
          <section mix={[cardStyle, credentialStyle]} aria-labelledby="credential-heading">
            <h2 id="credential-heading">Copy this credential now</h2>
            <p>It is shown once. Paste it into the Python runner; Starworks stores only its hash.</p>
            <code mix={codeStyle}>{oneTimeCredential}</code>
          </section>
        ) : null}

        {mayAdminister ? <>
        <div mix={twoColumnStyle}>
          <section mix={cardStyle} aria-labelledby="schedule-heading">
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
              <button type="submit" mix={buttonStyle}>Schedule match</button>
            </form>
          </section>

          <section mix={cardStyle} aria-labelledby="station-enrollment-heading">
            <h2 id="station-enrollment-heading">Enroll a runner station</h2>
            <p mix={mutedStyle}>Issue one credential with only match execution, artifact, heartbeat, and telemetry scopes.</p>
            <form action={routes.leagues.operations.issueCredential.href({ leagueSlug: league.slug })} method="post" mix={formStyle}>
              <label>Credential name<input name="name" required placeholder="Tournament desk one" mix={inputStyle} /></label>
              <button type="submit" mix={buttonStyle}>Issue station credential</button>
            </form>
          </section>
        </div>

        <section aria-labelledby="matches-heading" mix={sectionStyle}>
          <div mix={sectionHeadingStyle}>
            <div><p mix={eyebrowStyle}>Queue</p><h2 id="matches-heading">Matches and attempts</h2></div>
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
                  <li>#{attempt.attemptNumber} · {attempt.status}{attempt.failureKind ? ` · ${attempt.failureKind}` : ''}</li>
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
                  <label mix={wideStyle}>Required game-build SHA-256<input name="requiredGameBuildSha256" required pattern="[a-f0-9]{64}" placeholder="64 lowercase hexadecimal characters" mix={inputStyle} /></label>
                  <label mix={wideStyle}>Dynamic rule overrides<textarea name="dynamicRuleOverrides" rows={3} defaultValue="{}" mix={inputStyle} /></label>
                  <button type="submit" mix={buttonStyle}>Queue immutable attempt</button>
                </form>
              </article>
            )
          }) : <p mix={emptyStyle}>No matches are scheduled yet.</p>}
        </section>

        <section aria-labelledby="stations-heading" mix={sectionStyle}>
          <div mix={sectionHeadingStyle}><div><p mix={eyebrowStyle}>Native runner</p><h2 id="stations-heading">Stations</h2></div><span mix={countStyle}>{dashboard.stations.length} registered</span></div>
          <div mix={stationGridStyle}>
            {dashboard.stations.map((station) => (
              <article mix={cardStyle}>
                <h3>{station.name}</h3>
                <p mix={mutedStyle}>{station.status} · {station.runtimeState}</p>
                <p mix={mutedStyle}>Last heartbeat: {station.lastHeartbeatAt?.toLocaleString() ?? 'never'}</p>
                {station.status === 'active' ? <form action={routes.leagues.operations.revokeStation.href({ leagueSlug: league.slug, stationId: station.id })} method="post">
                  <button type="submit" mix={dangerStyle}>Revoke station</button>
                </form> : null}
              </article>
            ))}
            {!dashboard.stations.length ? <p mix={emptyStyle}>No station has enrolled with an issued credential.</p> : null}
          </div>
        </section>
        </> : null}
      </AppShell>
    )
  }
}

function RosterOperations(handle: Handle<{
  identity: SessionIdentity
  league: LeagueDetail
  mayAdminister: boolean
  operations: LeagueOperationsDashboard
}>) {
  return () => {
    let { identity, league, mayAdminister, operations } = handle.props
    let teams = operations.seasons.flatMap((season) => season.teams)
    let managedTeamIds = new Set(teams.filter((team) => team.managerPersonId === identity.personId).map((team) => team.id))
    return <>
      <section mix={sectionStyle} aria-labelledby="rosters-heading">
        <div mix={sectionHeadingStyle}>
          <div><p mix={eyebrowStyle}>Revisioned teams</p><h2 id="rosters-heading">Current rosters</h2></div>
          <span mix={countStyle}>{teams.length} teams</span>
        </div>
        <div mix={rosterGridStyle}>
          {teams.map((team) => <article mix={cardStyle}>
            <div mix={rosterHeadingStyle}><h3>{team.name}</h3>{managedTeamIds.has(team.id) ? <span mix={managedStyle}>Your team</span> : null}</div>
            {team.roster ? <><p mix={mutedStyle}>Published revision {team.roster.revisionNumber}</p><div mix={characterListStyle}>{team.roster.characterIds.map((characterId) => <code>{characterId}</code>)}</div></> : <p mix={mutedStyle}>No published roster yet.</p>}
          </article>)}
          {!teams.length ? <p mix={emptyStyle}>No league teams are configured.</p> : null}
        </div>
      </section>

      <div mix={twoColumnStyle}>
        <section mix={cardStyle} aria-labelledby="trade-offer-heading">
          <h2 id="trade-offer-heading">Offer a trade</h2>
          <p mix={mutedStyle}>One character ID per line. Ownership is revalidated when the other manager approves.</p>
          <form action={routes.leagues.operations.proposeTrade.href({ leagueSlug: league.slug })} method="post" mix={formStyle}>
            <label>Season<select name="seasonId" required mix={inputStyle}>{operations.seasons.map((season) => <option value={season.id}>{season.name}</option>)}</select></label>
            <label>Your team<select name="proposerTeamId" required mix={inputStyle}>{teams.map((team) => <option value={team.id}>{team.name}</option>)}</select></label>
            <label>Other team<select name="counterpartyTeamId" required defaultValue={teams[1]?.id ?? teams[0]?.id} mix={inputStyle}>{teams.map((team) => <option value={team.id}>{team.name}</option>)}</select></label>
            <label>You send<textarea name="proposerCharacterIds" rows={4} required placeholder="rmbe01-mario" mix={inputStyle} /></label>
            <label>You receive<textarea name="counterpartyCharacterIds" rows={4} required placeholder="rmbe01-peach" mix={inputStyle} /></label>
            <label>Message<textarea name="message" rows={2} placeholder="Why this works for both teams" mix={inputStyle} /></label>
            <button type="submit" mix={buttonStyle}>Send trade offer</button>
          </form>
        </section>

        <section mix={cardStyle} aria-labelledby="deadlines-heading">
          <h2 id="deadlines-heading">League deadlines</h2>
          {operations.deadlines.length ? <ul mix={deadlineListStyle}>{operations.deadlines.map((deadline) => <li><strong>{deadline.seasonName} · {deadline.kind}</strong><span>{deadline.closesAt.toLocaleString()}</span>{deadline.note ? <small>{deadline.note}</small> : null}</li>)}</ul> : <p mix={mutedStyle}>No transaction deadlines are configured.</p>}
          {mayAdminister ? <form action={routes.leagues.operations.setDeadline.href({ leagueSlug: league.slug })} method="post" mix={formStyle}>
            <label>Season<select name="seasonId" required mix={inputStyle}>{operations.seasons.map((season) => <option value={season.id}>{season.name}</option>)}</select></label>
            <label>Deadline type<select name="kind" defaultValue="trade" mix={inputStyle}><option value="trade">Trades</option><option value="roster">Roster changes</option><option value="lineup">Lineups</option></select></label>
            <label>Closes at<input type="datetime-local" name="closesAt" required mix={inputStyle} /></label>
            <label>Note<input name="note" placeholder="Postseason lock" mix={inputStyle} /></label>
            <button type="submit" mix={buttonStyle}>Set deadline</button>
          </form> : null}
        </section>
      </div>

      <section mix={sectionStyle} aria-labelledby="trades-heading">
        <div mix={sectionHeadingStyle}>
          <div><p mix={eyebrowStyle}>Approval queue</p><h2 id="trades-heading">Trades</h2></div>
          <span mix={countStyle}>{operations.trades.length} proposals</span>
        </div>
        <div mix={tradeListStyle}>
          {operations.trades.map((trade) => {
            let mayReview = mayAdminister || managedTeamIds.has(trade.counterpartyTeamId)
            let mayCancel = mayAdminister || trade.proposedByPersonId === identity.personId
            let outgoing = trade.items.filter((item) => item.fromTeamId === trade.proposerTeamId)
            let incoming = trade.items.filter((item) => item.fromTeamId === trade.counterpartyTeamId)
            return <article mix={[cardStyle, tradeCardStyle]}>
              <div mix={tradeHeadingStyle}><div><span mix={statusStyle}>{trade.status}</span><h3>{trade.proposerTeamName} ↔ {trade.counterpartyTeamName}</h3></div><small>{trade.proposedAt.toLocaleString()}</small></div>
              <div mix={tradeSidesStyle}>
                <div><strong>{trade.proposerTeamName} sends</strong>{outgoing.map((item) => <code>{item.characterId}</code>)}</div>
                <div><strong>{trade.counterpartyTeamName} sends</strong>{incoming.map((item) => <code>{item.characterId}</code>)}</div>
              </div>
              {trade.message ? <p>{trade.message}</p> : null}
              <p mix={mutedStyle}>{trade.approvals.length} of 2 team decisions recorded</p>
              {trade.status === 'pending' ? <div mix={tradeActionsStyle}>
                {mayReview ? <form action={routes.leagues.operations.reviewTrade.href({ leagueSlug: league.slug, proposalId: trade.id })} method="post" mix={reviewFormStyle}>
                  <input name="reason" placeholder="Optional decision note" mix={inputStyle} />
                  <button name="decision" value="approved" mix={buttonStyle}>Approve and apply</button>
                  <button name="decision" value="rejected" mix={dangerStyle}>Reject</button>
                </form> : null}
                {mayCancel ? <form action={routes.leagues.operations.cancelTrade.href({ leagueSlug: league.slug, proposalId: trade.id })} method="post"><button mix={secondaryButtonStyle}>Cancel offer</button></form> : null}
              </div> : null}
            </article>
          })}
          {!operations.trades.length ? <p mix={emptyStyle}>No trade proposals have been recorded.</p> : null}
        </div>
      </section>
    </>
  }
}

const eyebrowStyle = css({ color: '#f7c948', fontSize: '12px', fontWeight: 900, letterSpacing: '0.14em', margin: '0 0 8px', textTransform: 'uppercase' })
const headingStyle = css({ fontSize: 'clamp(42px, 7vw, 72px)', letterSpacing: '-0.06em', lineHeight: 0.95, margin: 0 })
const ledeStyle = css({ color: '#c9d4e9', fontSize: '18px', lineHeight: 1.6, maxWidth: '760px' })
const heroStyle = css({ display: 'grid', gap: '24px' })
const linkRowStyle = css({ display: 'flex', flexWrap: 'wrap', gap: '18px' })
const errorStyle = css({ background: '#4b1822', border: '1px solid #d75b70', borderRadius: '12px', marginTop: '28px', padding: '14px 18px' })
const credentialStyle = css({ borderColor: '#f7c948', marginTop: '28px' })
const codeStyle = css({ background: '#080b12', borderRadius: '8px', display: 'block', overflowWrap: 'anywhere', padding: '14px' })
const twoColumnStyle = css({ display: 'grid', gap: '24px', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 330px), 1fr))', marginTop: '32px' })
const formStyle = css({ display: 'grid', gap: '14px', marginTop: '18px', '& label': { display: 'grid', gap: '7px', fontWeight: 700 } })
const mutedStyle = css({ color: '#9faec8', lineHeight: 1.5 })
const sectionStyle = css({ marginTop: '56px' })
const sectionHeadingStyle = css({ alignItems: 'end', display: 'flex', gap: '20px', justifyContent: 'space-between', marginBottom: '18px', '& h2': { fontSize: '36px', margin: 0 } })
const countStyle = css({ color: '#9faec8', fontWeight: 800 })
const matchStyle = css({ display: 'grid', gap: '20px', marginBottom: '18px' })
const matchHeaderStyle = css({ alignItems: 'start', display: 'flex', gap: '20px', justifyContent: 'space-between', '& strong': { fontSize: '20px' } })
const statusStyle = css({ background: '#253553', borderRadius: '999px', padding: '6px 10px', whiteSpace: 'nowrap' })
const attemptListStyle = css({ color: '#c9d4e9', display: 'grid', gap: '6px', margin: 0 })
const queueFormStyle = css({ display: 'grid', gap: '14px', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 220px), 1fr))', '& label': { display: 'grid', gap: '7px', fontWeight: 700 } })
const wideStyle = css({ gridColumn: '1 / -1' })
const stationGridStyle = css({ display: 'grid', gap: '18px', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 260px), 1fr))' })
const dangerStyle = css({ background: '#7d2433', border: '1px solid #c44d61', borderRadius: '9px', color: '#fff', cursor: 'pointer', font: 'inherit', fontWeight: 800, marginTop: '12px', padding: '9px 12px' })
const emptyStyle = css({ border: '1px dashed #445171', borderRadius: '14px', color: '#9faec8', padding: '22px' })
const rosterGridStyle = css({ display: 'grid', gap: '18px', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 300px), 1fr))' })
const rosterHeadingStyle = css({ alignItems: 'center', display: 'flex', gap: '12px', justifyContent: 'space-between', '& h3': { fontSize: '24px', margin: 0 } })
const managedStyle = css({ background: '#123d32', borderRadius: '999px', color: '#8ee0bd', fontSize: '11px', fontWeight: 900, padding: '5px 8px', textTransform: 'uppercase' })
const characterListStyle = css({ display: 'flex', flexWrap: 'wrap', gap: '7px', marginTop: '14px', '& code': { background: '#0c1220', borderRadius: '7px', color: '#c9d4e9', fontSize: '12px', padding: '6px 8px' } })
const deadlineListStyle = css({ display: 'grid', gap: '10px', listStyle: 'none', margin: '16px 0 24px', padding: 0, '& li': { background: '#0c1220', borderRadius: '9px', display: 'grid', gap: '4px', padding: '11px' }, '& span, & small': { color: '#9faec8' } })
const tradeListStyle = css({ display: 'grid', gap: '18px' })
const tradeCardStyle = css({ display: 'grid', gap: '18px' })
const tradeHeadingStyle = css({ alignItems: 'start', display: 'flex', gap: '20px', justifyContent: 'space-between', '& h3': { fontSize: '23px', margin: '8px 0 0' }, '& small': { color: '#9faec8' } })
const tradeSidesStyle = css({ display: 'grid', gap: '14px', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', '& div': { background: '#0c1220', borderRadius: '10px', display: 'grid', gap: '8px', padding: '14px' }, '& code': { color: '#c9d4e9' }, '@media (max-width: 600px)': { gridTemplateColumns: '1fr' } })
const tradeActionsStyle = css({ alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: '12px' })
const reviewFormStyle = css({ alignItems: 'center', display: 'flex', flex: '1 1 600px', flexWrap: 'wrap', gap: '8px', '& input': { flex: '1 1 220px' } })
const secondaryButtonStyle = css({ background: '#253553', border: '1px solid #445171', borderRadius: '9px', color: '#f7f2e8', cursor: 'pointer', font: 'inherit', fontWeight: 800, padding: '9px 12px' })
