import type { Handle } from 'remix/ui'
import { css } from 'remix/ui'

import type { LeagueOperationsDashboard } from '../../league-operations/service.ts'
import type { LeagueDetail, SessionIdentity } from '../../platform/model.ts'
import { routes } from '../../routes.ts'
import { buttonStyle, cardStyle, inputStyle } from '../app-shell.tsx'
import { dangerButtonStyle, secondaryButtonStyle } from '../design-system.ts'
import { CharacterBadge } from './character-badge.tsx'
import { OperationsShell } from './workspace-page.tsx'

export function LeagueTeamsPage(handle: Handle<{
  identity: SessionIdentity
  league: LeagueDetail
  mayAdminister: boolean
  operations: LeagueOperationsDashboard
}>) {
  return () => {
    let { identity, league, mayAdminister, operations } = handle.props
    let teams = operations.seasons.flatMap((season) => season.teams)
    let managedTeamIds = new Set(teams.filter((team) => team.managerPersonId === identity.personId).map((team) => team.id))
    return <OperationsShell heading="Teams" identity={identity} league={league}>
      <section mix={sectionStyle} aria-labelledby="rosters-heading">
        <div mix={sectionHeadingStyle}>
          <h2 id="rosters-heading">Current rosters</h2>
          <span mix={countStyle}>{teams.length} teams</span>
        </div>
        <div mix={rosterGridStyle}>
          {teams.map((team) => <article mix={cardStyle}>
            <div mix={rosterHeadingStyle}><h3>{team.name}</h3>{managedTeamIds.has(team.id) ? <span mix={managedStyle}>Your team</span> : null}</div>
            {team.roster ? <><p mix={mutedStyle}>Published revision {team.roster.revisionNumber}</p><div mix={characterListStyle}>{team.roster.characterIds.map((characterId) => <CharacterBadge characterId={characterId} />)}</div></> : <p mix={mutedStyle}>No published roster yet.</p>}
          </article>)}
          {!teams.length ? <p mix={emptyStyle}>No league teams are configured.</p> : null}
        </div>
      </section>

      <div mix={twoColumnStyle}>
        <section mix={cardStyle} aria-labelledby="trade-offer-heading">
          <h2 id="trade-offer-heading">Offer a trade</h2>
          <form action={routes.leagues.operations.teams.proposeTrade.href({ leagueSlug: league.slug })} method="post" mix={formStyle}>
            <label>Season<select name="seasonId" required mix={inputStyle}>{operations.seasons.map((season) => <option value={season.id}>{season.name}</option>)}</select></label>
            <label>Your team<select name="proposerTeamId" required mix={inputStyle}>{teams.map((team) => <option value={team.id}>{team.name}</option>)}</select></label>
            <label>Other team<select name="counterpartyTeamId" required mix={inputStyle}>{teams.map((team, index) => <option value={team.id} selected={index === (teams.length > 1 ? 1 : 0)}>{team.name}</option>)}</select></label>
            <CharacterChoices legend="Players you send" name="proposerCharacterIds" teams={teams} />
            <CharacterChoices legend="Players you receive" name="counterpartyCharacterIds" teams={teams} />
            <label>Message<textarea name="message" rows={2} mix={inputStyle} /></label>
            <button type="submit" mix={buttonStyle}>Send trade offer</button>
          </form>
        </section>

        <section mix={cardStyle} aria-labelledby="deadlines-heading">
          <h2 id="deadlines-heading">League deadlines</h2>
          {operations.deadlines.length ? <ul mix={deadlineListStyle}>{operations.deadlines.map((deadline) => <li><strong>{deadline.seasonName} · {deadline.kind}</strong><span>{deadline.closesAt.toLocaleString()}</span>{deadline.note ? <small>{deadline.note}</small> : null}</li>)}</ul> : <p mix={mutedStyle}>No transaction deadlines are configured.</p>}
          {mayAdminister ? <form action={routes.leagues.operations.teams.setDeadline.href({ leagueSlug: league.slug })} method="post" mix={formStyle}>
            <label>Season<select name="seasonId" required mix={inputStyle}>{operations.seasons.map((season) => <option value={season.id}>{season.name}</option>)}</select></label>
            <label>Deadline type<select name="kind" mix={inputStyle}><option value="trade" selected>Trades</option><option value="roster">Roster changes</option><option value="lineup">Lineups</option></select></label>
            <label>Closes at<input type="datetime-local" name="closesAt" required mix={inputStyle} /></label>
            <label>Note<input name="note" placeholder="Postseason lock" mix={inputStyle} /></label>
            <button type="submit" mix={buttonStyle}>Set deadline</button>
          </form> : null}
        </section>
      </div>

      <section mix={sectionStyle} aria-labelledby="trades-heading">
        <div mix={sectionHeadingStyle}>
          <h2 id="trades-heading">Trades</h2>
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
                <div><strong>{trade.proposerTeamName} sends</strong>{outgoing.map((item) => <CharacterBadge characterId={item.characterId} />)}</div>
                <div><strong>{trade.counterpartyTeamName} sends</strong>{incoming.map((item) => <CharacterBadge characterId={item.characterId} />)}</div>
              </div>
              {trade.message ? <p>{trade.message}</p> : null}
              <p mix={mutedStyle}>{trade.approvals.length} of 2 team decisions recorded</p>
              {trade.status === 'pending' ? <div mix={tradeActionsStyle}>
                {mayReview ? <form action={routes.leagues.operations.teams.reviewTrade.href({ leagueSlug: league.slug, proposalId: trade.id })} method="post" mix={reviewFormStyle}>
                  <input name="reason" placeholder="Optional decision note" mix={inputStyle} />
                  <button name="decision" value="approved" mix={buttonStyle}>Approve and apply</button>
                  <button name="decision" value="rejected" mix={dangerButtonStyle}>Reject</button>
                </form> : null}
                {mayCancel ? <form action={routes.leagues.operations.teams.cancelTrade.href({ leagueSlug: league.slug, proposalId: trade.id })} method="post"><button mix={secondaryButtonStyle}>Cancel offer</button></form> : null}
              </div> : null}
            </article>
          })}
          {!operations.trades.length ? <p mix={emptyStyle}>No trade proposals have been recorded.</p> : null}
        </div>
      </section>
    </OperationsShell>
  }
}

function CharacterChoices(handle: Handle<{
  legend: string
  name: string
  teams: Array<{ name: string; roster: { characterIds: string[] } | null }>
}>) {
  return () => (
    <fieldset mix={characterChoicesStyle}>
      <legend>{handle.props.legend}</legend>
      {handle.props.teams.map((team) => team.roster ? (
        <div>
          <strong>{team.name}</strong>
          <div mix={choiceGridStyle}>
            {team.roster.characterIds.map((characterId) => (
              <label>
                <input type="checkbox" name={handle.props.name} value={characterId} />
                <CharacterBadge characterId={characterId} />
              </label>
            ))}
          </div>
        </div>
      ) : null)}
    </fieldset>
  )
}

const sectionStyle = css({ marginTop: '56px' })
const sectionHeadingStyle = css({ alignItems: 'end', display: 'flex', gap: '20px', justifyContent: 'space-between', marginBottom: '18px', '& h2': { fontSize: '36px', margin: 0 } })
const countStyle = css({ color: 'var(--text-muted)', fontWeight: 800 })
const mutedStyle = css({ color: 'var(--text-muted)', lineHeight: 1.5 })
const emptyStyle = css({ border: '1px dashed var(--border-strong)', borderRadius: '14px', color: 'var(--text-muted)', padding: '22px' })
const twoColumnStyle = css({ display: 'grid', gap: '24px', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 330px), 1fr))', marginTop: '32px' })
const formStyle = css({ display: 'grid', gap: '14px', marginTop: '18px', '& label': { display: 'grid', gap: '7px', fontWeight: 700 } })
const rosterGridStyle = css({ display: 'grid', gap: '18px', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 300px), 1fr))' })
const rosterHeadingStyle = css({ alignItems: 'center', display: 'flex', gap: '12px', justifyContent: 'space-between', '& h3': { fontSize: '24px', margin: 0 } })
const managedStyle = css({ color: 'var(--success-text)', fontSize: '11px', fontWeight: 900, textTransform: 'uppercase' })
const characterListStyle = css({ display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '14px' })
const characterChoicesStyle = css({ border: '1px solid var(--border)', borderRadius: '10px', display: 'grid', gap: '16px', margin: 0, padding: '14px', '& legend': { fontWeight: 800, padding: '0 6px' }, '& > div': { display: 'grid', gap: '8px' } })
const choiceGridStyle = css({ display: 'grid', gap: '7px', gridTemplateColumns: 'repeat(auto-fit, minmax(145px, 1fr))', '& label': { alignItems: 'center', background: 'var(--surface-deep)', borderRadius: '8px', cursor: 'pointer', display: 'flex', gap: '8px', padding: '7px' } })
const deadlineListStyle = css({ display: 'grid', gap: '10px', listStyle: 'none', margin: '16px 0 24px', padding: 0, '& li': { background: 'var(--surface-deep)', borderRadius: '9px', display: 'grid', gap: '4px', padding: '11px' }, '& span, & small': { color: 'var(--text-muted)' } })
const tradeListStyle = css({ display: 'grid', gap: '18px' })
const tradeCardStyle = css({ display: 'grid', gap: '18px' })
const tradeHeadingStyle = css({ alignItems: 'start', display: 'flex', gap: '20px', justifyContent: 'space-between', '& h3': { fontSize: '23px', margin: '8px 0 0' }, '& small': { color: 'var(--text-muted)' } })
const statusStyle = css({ color: 'var(--text-muted)', fontSize: '11px', fontWeight: 900, textTransform: 'uppercase', whiteSpace: 'nowrap' })
const tradeSidesStyle = css({ display: 'grid', gap: '14px', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', '& div': { background: 'var(--surface-deep)', borderRadius: '10px', display: 'grid', gap: '8px', padding: '14px' }, '@media (max-width: 600px)': { gridTemplateColumns: '1fr' } })
const tradeActionsStyle = css({ alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: '12px' })
const reviewFormStyle = css({ alignItems: 'center', display: 'flex', flex: '1 1 600px', flexWrap: 'wrap', gap: '8px', '& input': { flex: '1 1 220px' } })
