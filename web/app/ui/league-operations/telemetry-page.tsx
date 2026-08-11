import type { Handle } from 'remix/ui'
import { css } from 'remix/ui'

import type { LeagueDetail } from '../../platform/model.ts'
import { routes } from '../../routes.ts'
import type { SeasonStatistics, TelemetryAttemptSummary } from '../../telemetry/service.ts'
import { buttonStyle, cardStyle, inputStyle } from '../app-shell.tsx'
import { CharacterBadge } from './character-badge.tsx'

export function TelemetryOperations(handle: Handle<{
  attempts: TelemetryAttemptSummary[]
  league: LeagueDetail
  mayAdminister: boolean
  seasonStatistics: Array<{ name: string; seasonId: string; statistics: SeasonStatistics }>
}>) {
  return () => {
    let { attempts, league, mayAdminister, seasonStatistics } = handle.props
    return <>
      <section mix={sectionStyle} aria-labelledby="telemetry-heading">
        <div mix={sectionHeadingStyle}>
          <h2 id="telemetry-heading">Game telemetry</h2>
          <span mix={countStyle}>{attempts.length} attempts</span>
        </div>
        <div mix={telemetryListStyle}>
          {attempts.map((attempt) => {
            let derivation = attempt.derivation
            let score = derivation?.boxScore
            let requiresReview = attempt.health?.requiresReview || derivation?.status === 'review'
            let ready = derivation?.status === 'ready' && !requiresReview
            return <article mix={[cardStyle, telemetryCardStyle]}>
              <div mix={matchHeaderStyle}>
                <div>
                  <span mix={requiresReview ? reviewStatusStyle : healthyStatusStyle}>
                    {requiresReview ? 'review required' : attempt.health ? 'stream healthy' : 'awaiting telemetry'}
                  </span>
                  <h3 mix={telemetryTitleStyle}>{attempt.awayTeamName} at {attempt.homeTeamName}</h3>
                  <p mix={mutedStyle}>Attempt #{attempt.attemptNumber} · {attempt.attemptStatus} · match {attempt.matchStatus}</p>
                </div>
                {attempt.health ? <div mix={sequenceStyle}><strong>{attempt.health.eventCount}</strong><small>events · seq {attempt.health.firstSequence}–{attempt.health.lastSequence}</small></div> : null}
              </div>
              {attempt.health?.issues.length ? <ul mix={issueListStyle}>{attempt.health.issues.map((issue) => <li>{issue}</li>)}</ul> : null}
              {score && derivation ? <div mix={boxScoreStyle}>
                <div><strong>{attempt.awayTeamName}</strong><b>{score.teams.away.runs}</b><span>{score.teams.away.hits} H · {score.teams.away.errors} E</span></div>
                <div><strong>{attempt.homeTeamName}</strong><b>{score.teams.home.runs}</b><span>{score.teams.home.hits} H · {score.teams.home.errors} E</span></div>
                <small>Current derivation · {derivation.correctionCount} correction{derivation.correctionCount === 1 ? '' : 's'} · {score.innings} inning{score.innings === 1 ? '' : 's'}</small>
              </div> : <p mix={emptyStyle}>No derived box score yet.</p>}
              {attempt.corrections.length ? <details><summary>{attempt.corrections.length} correction receipt{attempt.corrections.length === 1 ? '' : 's'}</summary><ol mix={receiptListStyle}>{attempt.corrections.map((correction) => <li><code>{correction.entityType}:{correction.entityId}.{correction.statPath}</code><span>{correction.beforeValue} → {correction.afterValue}</span><small>{correction.reason} · {correction.createdAt.toLocaleString()}</small></li>)}</ol></details> : null}
              {mayAdminister ? <div mix={telemetryActionsStyle}>
                {attempt.health ? <form action={routes.leagues.operations.deriveTelemetry.href({ leagueSlug: league.slug, attemptId: attempt.attemptId })} method="post"><button mix={secondaryButtonStyle}>Regenerate box score</button></form> : null}
                {ready && ['provisional', 'review'].includes(attempt.attemptStatus) ? <form action={routes.leagues.operations.confirmTelemetry.href({ leagueSlug: league.slug, attemptId: attempt.attemptId })} method="post"><button mix={buttonStyle}>Confirm official result</button></form> : null}
              </div> : null}
              {mayAdminister && derivation && ['provisional', 'review'].includes(attempt.attemptStatus) ? <details>
                <summary>Add an audited scorer correction</summary>
                <form action={routes.leagues.operations.correctTelemetry.href({ leagueSlug: league.slug, attemptId: attempt.attemptId })} method="post" mix={correctionFormStyle}>
                  <label>Entity type<select name="entityType" mix={inputStyle}><option value="team">Team</option><option value="character">Character</option></select></label>
                  <label>Team or character ID<input name="entityId" required placeholder={attempt.awayTeamId} mix={inputStyle} /></label>
                  <label>Stat path<input name="statPath" required placeholder="hits" mix={inputStyle} /></label>
                  <label>Current value<input name="beforeValue" type="number" min="0" required mix={inputStyle} /></label>
                  <label>Corrected value<input name="afterValue" type="number" min="0" required mix={inputStyle} /></label>
                  <label mix={wideStyle}>Reason<input name="reason" minLength={3} required placeholder="Official scorer ruling" mix={inputStyle} /></label>
                  <button type="submit" mix={secondaryButtonStyle}>Record correction and rebuild</button>
                </form>
              </details> : null}
            </article>
          })}
          {!attempts.length ? <p mix={emptyStyle}>No match attempts have emitted telemetry.</p> : null}
        </div>
      </section>

      <section mix={sectionStyle} aria-labelledby="season-stats-heading">
        <div mix={sectionHeadingStyle}><h2 id="season-stats-heading">Standings and player totals</h2></div>
        <div mix={statisticsGridStyle}>
          {seasonStatistics.map((season) => <article mix={cardStyle}>
            <h3 mix={statisticsTitleStyle}>{season.name}</h3>
            {season.statistics.standings.length ? <div mix={tableScrollerStyle}><table mix={statisticsTableStyle}><thead><tr><th>Team</th><th>W</th><th>L</th><th>RF</th><th>RA</th></tr></thead><tbody>{season.statistics.standings.map((row) => <tr><td>{row.teamName}</td><td>{row.wins}</td><td>{row.losses}</td><td>{row.runsFor}</td><td>{row.runsAgainst}</td></tr>)}</tbody></table></div> : <p mix={mutedStyle}>No confirmed results yet.</p>}
            {Object.keys(season.statistics.playerTotals).length ? <details><summary>Player totals</summary><div mix={tableScrollerStyle}><table mix={statisticsTableStyle}><thead><tr><th>Character</th><th>H</th><th>HR</th><th>RBI</th><th>R</th><th>K</th></tr></thead><tbody>{Object.entries(season.statistics.playerTotals).map(([characterId, stats]) => <tr><td><CharacterBadge characterId={characterId} /></td><td>{stats.batting.hits}</td><td>{stats.batting.homeRuns}</td><td>{stats.batting.runsBattedIn}</td><td>{stats.running.runs}</td><td>{stats.batting.strikeouts}</td></tr>)}</tbody></table></div></details> : null}
          </article>)}
        </div>
      </section>
    </>
  }
}

const sectionStyle = css({ marginTop: '56px' })
const sectionHeadingStyle = css({ alignItems: 'end', display: 'flex', gap: '20px', justifyContent: 'space-between', marginBottom: '18px', '& h2': { fontSize: '36px', margin: 0 } })
const countStyle = css({ color: 'var(--text-muted)', fontWeight: 800 })
const mutedStyle = css({ color: 'var(--text-muted)', lineHeight: 1.5 })
const matchHeaderStyle = css({ alignItems: 'start', display: 'flex', gap: '20px', justifyContent: 'space-between', '& strong': { fontSize: '20px' } })
const emptyStyle = css({ border: '1px dashed var(--border-strong)', borderRadius: '14px', color: 'var(--text-muted)', padding: '22px' })
const telemetryListStyle = css({ display: 'grid', gap: '18px', marginTop: '20px' })
const telemetryCardStyle = css({ display: 'grid', gap: '18px' })
const telemetryTitleStyle = css({ fontSize: '24px', margin: '12px 0 0' })
const healthyStatusStyle = css({ background: 'var(--success-surface)', borderRadius: '999px', color: 'var(--success-text)', display: 'inline-block', fontSize: '11px', fontWeight: 900, padding: '5px 8px', textTransform: 'uppercase' })
const reviewStatusStyle = css({ background: 'var(--danger-surface)', borderRadius: '999px', color: 'var(--danger-text)', display: 'inline-block', fontSize: '11px', fontWeight: 900, padding: '5px 8px', textTransform: 'uppercase' })
const sequenceStyle = css({ alignItems: 'end', display: 'grid', justifyItems: 'end', '& strong': { fontSize: '30px' }, '& small': { color: 'var(--text-muted)' } })
const issueListStyle = css({ background: 'var(--danger-surface)', border: '1px solid var(--danger-border)', borderRadius: '10px', color: 'var(--danger-text)', display: 'grid', gap: '6px', margin: 0, padding: '14px 14px 14px 34px' })
const boxScoreStyle = css({ background: 'var(--surface-deep)', borderRadius: '12px', display: 'grid', gap: '10px', padding: '16px', '& div': { alignItems: 'center', display: 'grid', gap: '12px', gridTemplateColumns: 'minmax(0, 1fr) auto auto' }, '& b': { color: 'var(--accent-yellow)', fontSize: '28px' }, '& span, & small': { color: 'var(--text-muted)' } })
const telemetryActionsStyle = css({ alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: '10px' })
const correctionFormStyle = css({ display: 'grid', gap: '12px', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 190px), 1fr))', marginTop: '14px', '& label': { display: 'grid', gap: '6px', fontWeight: 700 } })
const wideStyle = css({ gridColumn: '1 / -1' })
const receiptListStyle = css({ display: 'grid', gap: '10px', paddingLeft: '22px', '& li': { display: 'grid', gap: '4px' }, '& span': { color: 'var(--accent-yellow)', fontWeight: 800 }, '& small': { color: 'var(--text-muted)' } })
const statisticsGridStyle = css({ display: 'grid', gap: '18px', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 380px), 1fr))' })
const statisticsTitleStyle = css({ fontSize: '24px', margin: '0 0 16px' })
const tableScrollerStyle = css({ overflowX: 'auto' })
const statisticsTableStyle = css({ borderCollapse: 'collapse', minWidth: '100%', textAlign: 'left', '& th, & td': { borderBottom: '1px solid var(--surface-strong)', padding: '9px 12px' }, '& th': { color: 'var(--text-muted)', fontSize: '11px', letterSpacing: '0.08em', textTransform: 'uppercase' } })
const secondaryButtonStyle = css({ background: 'var(--surface-strong)', border: '1px solid var(--border-strong)', borderRadius: '9px', color: 'var(--text-primary)', cursor: 'pointer', font: 'inherit', fontWeight: 800, padding: '9px 12px' })
