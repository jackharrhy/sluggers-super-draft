import type { Handle } from 'remix/ui'
import { css } from 'remix/ui'

import type { SeasonStatistics } from '../telemetry/statistics.ts'
import { tableScrollerStyle, tableStyle } from './design-system.ts'
import { CharacterBadge } from './league-operations/character-badge.tsx'

export function StandingsTable(handle: Handle<{
  limit?: number
  standings: SeasonStatistics['standings']
}>) {
  return () => (
    <div mix={tableScrollerStyle}>
      <table mix={[tableStyle, standingsTableStyle]}>
        <thead><tr><th>#</th><th>Team</th><th>W</th><th>L</th><th>+/-</th><th>RD</th></tr></thead>
        <tbody>{handle.props.standings.slice(0, handle.props.limit).map((row, index) => (
          <tr>
            <td>{index + 1}</td>
            <td><strong>{row.teamName}</strong></td>
            <td mix={winStyle}>{row.wins}</td>
            <td mix={lossStyle}>{row.losses}</td>
            <td>{signed(row.wins - row.losses)}</td>
            <td>{signed(row.runsFor - row.runsAgainst)}</td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  )
}

export function PlayerLeaderList(handle: Handle<{
  limit?: number
  playerTotals: SeasonStatistics['playerTotals']
}>) {
  return () => {
    let leaders = Object.entries(handle.props.playerTotals)
      .sort(([, left], [, right]) => right.batting.hits - left.batting.hits || right.batting.homeRuns - left.batting.homeRuns)
      .slice(0, handle.props.limit)
    return leaders.length ? (
      <ol mix={leaderListStyle}>{leaders.map(([characterId, stats], index) => (
        <li>
          <span>{index + 1}</span>
          <CharacterBadge characterId={characterId} />
          <strong>{stats.batting.hits} H</strong>
          <small>{stats.batting.homeRuns} HR · {stats.batting.runsBattedIn} RBI</small>
        </li>
      ))}</ol>
    ) : null
  }
}

function signed(value: number): string {
  return value > 0 ? `+${value}` : String(value)
}

const standingsTableStyle = css({ textAlign: 'center', '& th, & td': { textAlign: 'center' }, '& th:nth-child(2), & td:nth-child(2)': { textAlign: 'left' } })
const winStyle = css({ color: 'var(--success-text)' })
const lossStyle = css({ color: 'var(--danger-text)' })
const leaderListStyle = css({ listStyle: 'none', margin: 0, padding: 0, '& li': { alignItems: 'center', borderTop: '1px solid var(--border)', display: 'grid', gap: '10px', gridTemplateColumns: '24px minmax(0, 1fr) auto auto', padding: '9px 0' }, '& > li > span': { color: 'var(--text-muted)', textAlign: 'center' }, '& small': { color: 'var(--text-muted)' }, '@media (max-width: 520px)': { '& li': { gridTemplateColumns: '20px minmax(0, 1fr) auto' }, '& small': { display: 'none' } } })
