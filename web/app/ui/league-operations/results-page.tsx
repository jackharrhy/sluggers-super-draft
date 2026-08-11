import type { Handle } from 'remix/ui'
import { css } from 'remix/ui'

import type { LeagueDetail, SessionIdentity } from '../../platform/model.ts'
import { scoringRoles } from '../../platform/repository.ts'
import { routes } from '../../routes.ts'
import { displayCharacterName } from '../../sluggers/characters.ts'
import {
  CORRECTABLE_CHARACTER_STATS,
  CORRECTABLE_TEAM_STATS,
  correctionTargetValue,
} from '../../telemetry/corrections.ts'
import type { CharacterBoxScore } from '../../telemetry/model.ts'
import type { TelemetryAttemptSummary } from '../../telemetry/service.ts'
import type { SeasonStatistics } from '../../telemetry/statistics.ts'
import { buttonStyle, cardStyle, inputStyle } from '../app-shell.tsx'
import { PlayerLeaderList, StandingsTable } from '../league-summary.tsx'
import { emptyStyle, mutedStyle, OperationsShell, SectionHeading, sectionStyle } from './workspace-page.tsx'

interface LeagueResultsPageProps {
  attempts: TelemetryAttemptSummary[]
  identity: SessionIdentity
  league: LeagueDetail
  seasons: Array<{ name: string; seasonId: string; statistics: SeasonStatistics }>
}

export function LeagueResultsPage(handle: Handle<LeagueResultsPageProps>) {
  return () => {
    let { attempts, identity, league, seasons } = handle.props
    let mayScore = identity.isSiteAdmin || league.roles.some((role) => scoringRoles.has(role))
    let official = latestAttemptPerMatch(attempts.filter((attempt) => attempt.attemptStatus === 'confirmed' && attempt.derivation))
    let review = latestAttemptPerMatch(attempts.filter((attempt) =>
      ['provisional', 'review'].includes(attempt.attemptStatus) && (attempt.health || attempt.derivation)))
    return (
      <OperationsShell heading="Results" identity={identity} league={league}>
        <section aria-labelledby="standings-heading">
          <SectionHeading id="standings-heading" heading="Standings" />
          <div mix={seasonGridStyle}>
            {seasons.map((season) => (
              <article mix={cardStyle}>
                <h3 mix={seasonHeadingStyle}>{season.name}</h3>
                {season.statistics.standings.length ? (
                  <StandingsTable standings={season.statistics.standings} />
                ) : <p mix={mutedStyle}>No official results yet.</p>}
              </article>
            ))}
          </div>
        </section>

        <section aria-labelledby="recent-results-heading" mix={sectionStyle}>
          <SectionHeading id="recent-results-heading" heading="Recent results" count={official.length} />
          <div mix={resultGridStyle}>
            {official.map((attempt) => <ResultCard attempt={attempt} />)}
            {!official.length ? <p mix={emptyStyle}>Completed games will appear here after their results are accepted.</p> : null}
          </div>
        </section>

        <section aria-labelledby="leaders-heading" mix={sectionStyle}>
          <SectionHeading id="leaders-heading" heading="Player leaders" />
          <div mix={leaderGridStyle}>
            {seasons.map((season) => <PlayerLeaders name={season.name} statistics={season.statistics} />)}
          </div>
        </section>

        {mayScore && review.length ? (
          <section aria-labelledby="review-heading" mix={sectionStyle}>
            <SectionHeading id="review-heading" heading="Needs review" count={review.length} />
            <div mix={reviewListStyle}>{review.map((attempt) => <ReviewCard attempt={attempt} league={league} />)}</div>
          </section>
        ) : null}
      </OperationsShell>
    )
  }
}

function ResultCard(handle: Handle<{ attempt: TelemetryAttemptSummary }>) {
  return () => {
    let { attempt } = handle.props
    let score = attempt.derivation!.boxScore
    return (
      <article mix={[cardStyle, resultCardStyle]}>
        <div mix={scoreRowStyle}>
          <div><strong>{attempt.awayTeamName}</strong><span>{score.teams.away.hits} H · {score.teams.away.errors} E</span></div>
          <b>{score.teams.away.runs}</b><i>–</i><b>{score.teams.home.runs}</b>
          <div><strong>{attempt.homeTeamName}</strong><span>{score.teams.home.hits} H · {score.teams.home.errors} E</span></div>
        </div>
        <p mix={resultMetaStyle}>{score.innings} innings · {resultReason(score.endedReason)}</p>
      </article>
    )
  }
}

function PlayerLeaders(handle: Handle<{ name: string; statistics: SeasonStatistics }>) {
  return () => {
    let hasLeaders = Object.keys(handle.props.statistics.playerTotals).length > 0
    return (
      <article mix={cardStyle}>
        <h3 mix={seasonHeadingStyle}>{handle.props.name}</h3>
        {hasLeaders ? <PlayerLeaderList limit={8} playerTotals={handle.props.statistics.playerTotals} /> : <p mix={mutedStyle}>No player totals yet.</p>}
      </article>
    )
  }
}

function ReviewCard(handle: Handle<{ attempt: TelemetryAttemptSummary; league: LeagueDetail }>) {
  return () => {
    let { attempt, league } = handle.props
    let score = attempt.derivation?.boxScore
    let requiresReview = attempt.health?.requiresReview || attempt.derivation?.status === 'review'
    let ready = attempt.derivation?.status === 'ready' && !requiresReview
    return (
      <article mix={[cardStyle, reviewCardStyle]}>
        <div mix={reviewHeadingStyle}>
          <div><h3>{attempt.awayTeamName} at {attempt.homeTeamName}</h3><p mix={mutedStyle}>Attempt {attempt.attemptNumber} · {attempt.attemptStatus}</p></div>
          <span mix={requiresReview ? problemStyle : pendingStyle}>{requiresReview ? 'review required' : 'provisional'}</span>
        </div>
        {score ? <div mix={compactScoreStyle}><strong>{attempt.awayTeamName} {score.teams.away.runs}</strong><span>–</span><strong>{score.teams.home.runs} {attempt.homeTeamName}</strong></div> : null}
        {attempt.health?.issues.length ? <ul mix={issueListStyle}>{attempt.health.issues.map((issue) => <li>{issue}</li>)}</ul> : null}
        <div mix={actionRowStyle}>
          {attempt.health ? <form action={routes.leagues.operations.results.derive.href({ leagueSlug: league.slug, attemptId: attempt.attemptId })} method="post"><button mix={secondaryButtonStyle}>Rebuild result</button></form> : null}
          {ready && ['provisional', 'review'].includes(attempt.attemptStatus) ? <form action={routes.leagues.operations.results.confirm.href({ leagueSlug: league.slug, attemptId: attempt.attemptId })} method="post"><button mix={buttonStyle}>Confirm result</button></form> : null}
        </div>
        {score && ['provisional', 'review'].includes(attempt.attemptStatus) ? (
          <details>
            <summary>Record a scorer correction</summary>
            <form action={routes.leagues.operations.results.correct.href({ leagueSlug: league.slug, attemptId: attempt.attemptId })} method="post" mix={correctionFormStyle}>
              <label>Statistic<select name="correctionTarget" required mix={inputStyle}>{correctionOptions(attempt).map((option) => <option value={option.value}>{option.label}</option>)}</select></label>
              <label>Corrected value<input name="afterValue" type="number" min="0" required mix={inputStyle} /></label>
              <label mix={wideStyle}>Reason<input name="reason" minLength={3} required mix={inputStyle} /></label>
              <button type="submit" mix={secondaryButtonStyle}>Save correction</button>
            </form>
          </details>
        ) : null}
        {attempt.corrections.length ? <ul mix={correctionListStyle}>{attempt.corrections.map((correction) => <li><strong>{correctionLabel(attempt, correction.entityType, correction.entityId, correction.statPath)}</strong><span>{correction.beforeValue} → {correction.afterValue}</span><small>{correction.reason}</small></li>)}</ul> : null}
      </article>
    )
  }
}

function correctionOptions(attempt: TelemetryAttemptSummary): Array<{ label: string; value: string }> {
  let score = attempt.derivation!.boxScore
  let teamOptions = [
    [attempt.awayTeamName, score.teams.away],
    [attempt.homeTeamName, score.teams.home],
  ] as const
  let options = teamOptions.flatMap(([name, team]) => [
    ...CORRECTABLE_TEAM_STATS.map((stat) => correctionOption(
      name,
      'team',
      team.teamId,
      stat.path,
      team[stat.path],
    )),
  ])
  for (let [characterId, stats] of Object.entries(score.characters)) {
    let name = displayCharacterName(characterId)
    for (let stat of CORRECTABLE_CHARACTER_STATS) {
      options.push(correctionOption(name, 'character', characterId, stat.path, characterStatValue(stats, stat.path)))
    }
  }
  return options
}

function correctionOption(label: string, entityType: 'team' | 'character', entityId: string, statPath: string, current: number) {
  return { label: `${label} · ${statLabel(statPath)} (currently ${current})`, value: correctionTargetValue(entityType, entityId, statPath, current) }
}

function characterStatValue(stats: CharacterBoxScore, path: string): number {
  if (path === 'batting.hits') return stats.batting.hits
  if (path === 'batting.homeRuns') return stats.batting.homeRuns
  if (path === 'batting.runsBattedIn') return stats.batting.runsBattedIn
  if (path === 'running.runs') return stats.running.runs
  return stats.fielding.errors
}

function correctionLabel(attempt: TelemetryAttemptSummary, entityType: 'team' | 'character', entityId: string, statPath: string): string {
  let entity = entityType === 'character'
    ? displayCharacterName(entityId)
    : entityId === attempt.homeTeamId ? attempt.homeTeamName : attempt.awayTeamName
  return `${entity} · ${statLabel(statPath)}`
}

function statLabel(path: string): string {
  return [...CORRECTABLE_TEAM_STATS, ...CORRECTABLE_CHARACTER_STATS].find((stat) => stat.path === path)?.label ?? path
}

function resultReason(reason: string | null): string {
  if (reason === 'mercy') return 'Mercy rule'
  if (reason === 'forfeit') return 'Forfeit'
  if (reason === 'quit') return 'Game ended early'
  return 'Final'
}

function latestAttemptPerMatch(attempts: TelemetryAttemptSummary[]): TelemetryAttemptSummary[] {
  let seen = new Set<string>()
  return attempts.filter((attempt) => {
    if (seen.has(attempt.matchId)) return false
    seen.add(attempt.matchId)
    return true
  })
}

const seasonGridStyle = css({ display: 'grid', gap: '18px', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 520px), 1fr))' })
const seasonHeadingStyle = css({ fontSize: '22px', margin: '0 0 16px' })
const resultGridStyle = css({ display: 'grid', gap: '14px' })
const resultCardStyle = css({ display: 'grid', gap: '14px' })
const scoreRowStyle = css({ alignItems: 'center', display: 'grid', gap: '14px', gridTemplateColumns: 'minmax(0, 1fr) auto auto auto minmax(0, 1fr)', '& > div': { display: 'grid', gap: '3px' }, '& > div:last-child': { textAlign: 'right' }, '& span': { color: 'var(--text-muted)', fontSize: '13px' }, '& b': { color: 'var(--accent-yellow)', fontFamily: 'var(--font-display)', fontSize: '36px' }, '& i': { color: 'var(--text-muted)', fontStyle: 'normal', fontSize: '22px' }, '@media (max-width: 620px)': { gap: '8px', '& b': { fontSize: '28px' }, '& strong': { fontSize: '14px' } } })
const resultMetaStyle = css({ borderTop: '1px solid var(--border)', color: 'var(--text-muted)', margin: 0, paddingTop: '12px', textAlign: 'center' })
const leaderGridStyle = css({ display: 'grid', gap: '18px', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 420px), 1fr))' })
const reviewListStyle = css({ display: 'grid', gap: '16px' })
const reviewCardStyle = css({ display: 'grid', gap: '16px' })
const reviewHeadingStyle = css({ alignItems: 'start', display: 'flex', gap: '16px', justifyContent: 'space-between', '& h3': { fontSize: '22px', margin: 0 }, '& p': { margin: '6px 0 0' } })
const problemStyle = css({ background: 'var(--danger-surface)', borderRadius: '999px', color: 'var(--danger-text)', fontSize: '11px', fontWeight: 900, padding: '5px 8px', textTransform: 'uppercase' })
const pendingStyle = css({ background: 'var(--surface-strong)', borderRadius: '999px', fontSize: '11px', fontWeight: 900, padding: '5px 8px', textTransform: 'uppercase' })
const compactScoreStyle = css({ alignItems: 'center', background: 'var(--surface-deep)', borderRadius: '10px', display: 'flex', gap: '12px', justifyContent: 'center', padding: '13px' })
const issueListStyle = css({ background: 'var(--danger-surface)', border: '1px solid var(--danger-border)', borderRadius: '10px', color: 'var(--danger-text)', display: 'grid', gap: '6px', margin: 0, padding: '14px 14px 14px 34px' })
const actionRowStyle = css({ alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: '10px' })
const secondaryButtonStyle = css({ background: 'var(--surface-strong)', border: '1px solid var(--border-strong)', borderRadius: '7px', color: 'var(--text-primary)', cursor: 'pointer', font: 'inherit', fontWeight: 800, padding: '9px 12px' })
const correctionFormStyle = css({ display: 'grid', gap: '12px', gridTemplateColumns: 'minmax(0, 2fr) minmax(120px, 1fr)', marginTop: '14px', '& label': { display: 'grid', gap: '6px', fontWeight: 700 }, '@media (max-width: 620px)': { gridTemplateColumns: '1fr' } })
const wideStyle = css({ gridColumn: '1 / -1' })
const correctionListStyle = css({ borderTop: '1px solid var(--border)', display: 'grid', gap: '8px', listStyle: 'none', margin: 0, padding: '14px 0 0', '& li': { display: 'grid', gap: '4px' }, '& span': { color: 'var(--accent-yellow)', fontWeight: 800 }, '& small': { color: 'var(--text-muted)' } })
