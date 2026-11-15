import type { Handle } from 'remix/ui'
import { css } from 'remix/ui'

import { characterHeadshotPath, displayCharacterName } from '../sluggers/characters.ts'
import { primaryButtonStyle } from './design-system.ts'

type FieldPosition = '1B' | '2B' | '3B' | 'C' | 'CF' | 'LF' | 'P' | 'RF' | 'SS'

interface MatchTeam {
  captainCharacterId: string
  manager: string
  name: string
}

interface MatchSummary {
  away: MatchTeam
  awayScore?: number
  home: MatchTeam
  homeScore?: number
  label: string
  status: 'final' | 'live' | 'upcoming'
}

export function TradeComposerPattern() {
  return () => (
    <article mix={patternCardStyle}>
      <div mix={patternHeadingStyle}>
        <div><h3>Trade proposal</h3><p>Choose the players that change teams.</p></div>
        <span mix={openStatusStyle}>Open</span>
      </div>
      <div mix={tradeTeamsStyle}>
        <TradeRoster
          name="Mario Fireballs"
          captain="mario"
          players={['mario', 'luigi', 'peach', 'daisy', 'yoshi']}
          selected={['peach']}
        />
        <TradeRoster
          name="Wario Muscles"
          captain="wario"
          players={['wario', 'waluigi', 'boo', 'king-boo', 'bowser-jr']}
          selected={['boo']}
        />
      </div>
      <div mix={tradePreviewStyle}>
        <div><small>Mario sends</small><PlayerToken characterId="peach" /></div>
        <b aria-hidden="true">⇄</b>
        <div><small>Wario sends</small><PlayerToken characterId="boo" /></div>
      </div>
      <div mix={patternActionsStyle}>
        <button type="button" mix={primaryButtonStyle}>Send trade offer</button>
        <span>Both managers must approve.</span>
      </div>
    </article>
  )
}

function TradeRoster(handle: Handle<{
  captain: string
  name: string
  players: string[]
  selected: string[]
}>) {
  return () => (
    <fieldset mix={tradeRosterStyle}>
      <legend>{handle.props.name}</legend>
      <div>
        {handle.props.players.map((characterId) => {
          let captain = characterId === handle.props.captain
          let selected = handle.props.selected.includes(characterId)
          return (
            <button
              type="button"
              aria-pressed={selected}
              disabled={captain}
              mix={playerChoiceStyle}
              data-selected={selected ? 'true' : undefined}
            >
              <PlayerToken characterId={characterId} captain={captain} />
              <small>{captain ? 'Captain' : selected ? 'Selected' : 'Available'}</small>
            </button>
          )
        })}
      </div>
    </fieldset>
  )
}

export function LineupPattern() {
  return () => {
    let battingOrder = ['mario', 'peach', 'luigi', 'yoshi', 'daisy', 'birdo', 'toad', 'toadette', 'bowser']
    let fielding: Array<{ characterId: string; position: FieldPosition }> = [
      { characterId: 'daisy', position: 'LF' },
      { characterId: 'yoshi', position: 'CF' },
      { characterId: 'birdo', position: 'RF' },
      { characterId: 'luigi', position: 'SS' },
      { characterId: 'toad', position: '2B' },
      { characterId: 'mario', position: 'P' },
      { characterId: 'peach', position: '3B' },
      { characterId: 'bowser', position: '1B' },
      { characterId: 'toadette', position: 'C' },
    ]
    return (
      <article mix={patternCardStyle}>
        <div mix={patternHeadingStyle}>
          <div><h3>Mario Fireballs lineup</h3><p>Batting order and defensive alignment.</p></div>
          <span mix={readyStatusStyle}>Ready</span>
        </div>
        <ol mix={battingOrderStyle} aria-label="Batting order">
          {battingOrder.map((characterId, index) => (
            <li><b>{index + 1}</b><PlayerToken characterId={characterId} captain={characterId === 'mario'} compact /></li>
          ))}
        </ol>
        <div mix={fieldStyle} aria-label="Defensive fielding positions">
          <svg viewBox="0 0 320 300" aria-hidden="true">
            <path d="M 16 132 Q 160 -35 304 132 L 160 286 Z" />
            <path d="M 93 155 L 160 88 L 227 155 L 160 222 Z" />
          </svg>
          {fielding.map(({ characterId, position }) => (
            <div mix={fieldPositionStyle} style={{ gridArea: fieldGridAreas[position] }}>
              <PlayerToken characterId={characterId} captain={characterId === 'mario'} compact />
              <b>{position}</b>
            </div>
          ))}
        </div>
      </article>
    )
  }
}

export function MatchDayPattern() {
  return () => {
    let matches: MatchSummary[] = [
      {
        away: { captainCharacterId: 'mario', manager: 'Jack', name: 'Mario Fireballs' },
        awayScore: 4,
        home: { captainCharacterId: 'wario', manager: 'Noran', name: 'Wario Muscles' },
        homeScore: 3,
        label: 'Mario Stadium · 5th inning',
        status: 'live',
      },
      {
        away: { captainCharacterId: 'yoshi', manager: 'Evan', name: 'Yoshi Eggs' },
        home: { captainCharacterId: 'donkey-kong', manager: 'Daisy', name: 'DK Wilds' },
        label: 'Bowser Jr. Playroom · 8:30 PM',
        status: 'upcoming',
      },
      {
        away: { captainCharacterId: 'peach', manager: 'Maya', name: 'Peach Monarchs' },
        awayScore: 2,
        home: { captainCharacterId: 'bowser', manager: 'Sam', name: 'Bowser Monsters' },
        homeScore: 7,
        label: 'Bowser Castle · Final',
        status: 'final',
      },
    ]
    return (
      <article mix={patternCardStyle}>
        <div mix={matchDayHeadingStyle}>
          <div><h3>Mushroom League · Week 4</h3><p>Saturday, August 22</p></div>
          <span mix={liveStatusStyle}>One live</span>
        </div>
        <div mix={matchListStyle}>{matches.map((match) => <MatchRow match={match} />)}</div>
      </article>
    )
  }
}

function MatchRow(handle: Handle<{ match: MatchSummary }>) {
  return () => {
    let { match } = handle.props
    let hasScore = match.awayScore !== undefined && match.homeScore !== undefined
    return (
      <div mix={matchRowStyle} data-status={match.status}>
        <span mix={matchMetaStyle}>{match.label}</span>
        <MatchTeam team={match.away} align="right" />
        <div mix={scoreStyle}>
          {hasScore ? <><b>{match.awayScore}</b><span>–</span><b>{match.homeScore}</b></> : <strong>VS</strong>}
        </div>
        <MatchTeam team={match.home} align="left" />
        <span mix={matchStatusStyle}>{match.status}</span>
      </div>
    )
  }
}

function MatchTeam(handle: Handle<{ align: 'left' | 'right'; team: MatchTeam }>) {
  return () => (
    <div mix={matchTeamStyle} data-align={handle.props.align}>
      <PlayerToken characterId={handle.props.team.captainCharacterId} compact />
      <span><strong>{handle.props.team.name}</strong><small>{handle.props.team.manager}</small></span>
    </div>
  )
}

function PlayerToken(handle: Handle<{
  captain?: boolean
  characterId: string
  compact?: boolean
}>) {
  return () => (
    <span mix={playerTokenStyle} data-compact={handle.props.compact ? 'true' : undefined}>
      <span>
        <img src={characterHeadshotPath(handle.props.characterId)} alt="" />
        {handle.props.captain ? <b title="Captain">C</b> : null}
      </span>
      <strong>{displayCharacterName(handle.props.characterId)}</strong>
    </span>
  )
}

const fieldGridAreas: Record<FieldPosition, string> = {
  LF: '1 / 1 / 2 / 2', CF: '1 / 4 / 2 / 5', RF: '1 / 7 / 2 / 8',
  SS: '2 / 3 / 3 / 4', '2B': '2 / 5 / 3 / 6', P: '3 / 4 / 4 / 5',
  '3B': '4 / 2 / 5 / 3', '1B': '4 / 6 / 5 / 7', C: '5 / 4 / 6 / 5',
}

const patternCardStyle = css({ background: 'var(--paper)', border: '2px solid var(--sluggers-ink)', borderRadius: '8px', boxShadow: '4px 4px 0 var(--sluggers-ink)', color: 'var(--ink)', display: 'grid', gap: '18px', padding: '20px' })
const patternHeadingStyle = css({ alignItems: 'start', display: 'flex', gap: '14px', justifyContent: 'space-between', '& h3': { fontSize: '24px', margin: 0 }, '& p': { color: 'var(--ink-muted)', margin: '5px 0 0' } })
const openStatusStyle = css({ color: 'var(--mario-blue-700)', fontSize: '11px', fontWeight: 900, textTransform: 'uppercase' })
const readyStatusStyle = css({ color: 'var(--luigi-green-700)', fontSize: '11px', fontWeight: 900, textTransform: 'uppercase' })
const liveStatusStyle = css({ background: 'var(--luigi-green-100)', border: '1px solid var(--luigi-green-600)', borderRadius: '999px', color: 'var(--luigi-green-900)', fontSize: '11px', fontWeight: 900, padding: '5px 9px', textTransform: 'uppercase' })
const tradeTeamsStyle = css({ display: 'grid', gap: '14px', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', '@media (max-width: 720px)': { gridTemplateColumns: '1fr' } })
const tradeRosterStyle = css({ border: '1px solid var(--paper-border)', borderRadius: '7px', margin: 0, padding: '12px', '& legend': { fontFamily: 'var(--font-display)', fontSize: '16px', padding: '0 6px' }, '& > div': { display: 'grid', gap: '7px', gridTemplateColumns: 'repeat(5, minmax(0, 1fr))' } })
const playerChoiceStyle = css({ background: 'var(--baseball-100)', border: '2px solid transparent', borderRadius: '6px', color: 'var(--ink)', cursor: 'pointer', display: 'grid', gap: '4px', justifyItems: 'center', minWidth: 0, padding: '7px 4px', '&:not(:disabled):hover': { background: 'var(--mario-blue-50)', borderColor: 'var(--mario-blue-300)' }, '&[data-selected="true"]': { background: 'var(--mario-blue-100)', borderColor: 'var(--mario-blue-600)' }, '&:disabled': { cursor: 'not-allowed', filter: 'grayscale(.7)', opacity: 0.55 }, '& small': { fontSize: '9px', fontWeight: 800 } })
const tradePreviewStyle = css({ alignItems: 'center', background: 'var(--baseball-100)', border: '1px solid var(--paper-border)', borderRadius: '7px', display: 'grid', gap: '14px', gridTemplateColumns: '1fr auto 1fr', padding: '12px', '& > div': { alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: '8px' }, '& > div:last-child': { justifyContent: 'end' }, '& small': { color: 'var(--ink-muted)', fontWeight: 800 }, '& > b': { color: 'var(--mario-blue-600)', fontSize: '24px' } })
const patternActionsStyle = css({ alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: '12px', '& span': { color: 'var(--ink-muted)', fontSize: '12px' } })
const playerTokenStyle = css({ alignItems: 'center', display: 'inline-flex', gap: '7px', minWidth: 0, '& > span': { flex: '0 0 auto', height: '42px', position: 'relative', width: '42px' }, '& img': { height: '100%', objectFit: 'contain', width: '100%' }, '& > span > b': { alignItems: 'center', background: 'var(--sluggers-red-600)', borderRadius: '999px', color: 'white', display: 'flex', fontSize: '8px', height: '15px', justifyContent: 'center', left: '-3px', position: 'absolute', top: '-3px', width: '15px' }, '& > strong': { fontSize: '12px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, '&[data-compact="true"]': { display: 'grid', gap: '2px', justifyItems: 'center', '& > span': { height: '34px', width: '34px' }, '& > strong': { fontSize: '9px', maxWidth: '54px' } } })
const battingOrderStyle = css({ display: 'grid', gap: '5px', gridTemplateColumns: 'repeat(9, minmax(54px, 1fr))', listStyle: 'none', margin: 0, overflowX: 'auto', padding: '2px 0 7px', '& li': { alignItems: 'center', display: 'grid', gap: '2px', justifyItems: 'center' }, '& li > b': { color: 'var(--daisy-yellow-700)', fontSize: '11px' } })
const fieldStyle = css({ aspectRatio: '1.06', display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gridTemplateRows: 'repeat(5, 1fr)', justifySelf: 'center', maxWidth: '400px', padding: '20px', position: 'relative', width: '100%', '& > svg': { height: '100%', inset: 0, position: 'absolute', width: '100%' }, '& > svg path:first-child': { fill: 'var(--luigi-green-100)', stroke: 'var(--luigi-green-700)', strokeWidth: 3 }, '& > svg path:last-child': { fill: 'var(--baseball-300)', stroke: 'var(--baseball-700)', strokeWidth: 2 } })
const fieldPositionStyle = css({ alignItems: 'center', display: 'flex', flexDirection: 'column', justifyContent: 'center', position: 'relative', zIndex: 1, '& > b': { background: 'var(--paper)', border: '1px solid var(--paper-border)', borderRadius: '999px', fontSize: '9px', lineHeight: 1, padding: '3px 5px' } })
const matchDayHeadingStyle = css({ alignItems: 'center', display: 'flex', gap: '16px', justifyContent: 'space-between', '& h3': { fontSize: '24px', margin: 0 }, '& p': { color: 'var(--ink-muted)', margin: '5px 0 0' } })
const matchListStyle = css({ border: '1px solid var(--paper-border)', borderRadius: '7px', overflow: 'hidden' })
const matchRowStyle = css({ alignItems: 'center', display: 'grid', gap: '12px', gridTemplateColumns: 'minmax(0, 1fr) auto minmax(0, 1fr)', minHeight: '96px', padding: '24px 14px 12px', position: 'relative', '& + &': { borderTop: '1px solid var(--paper-border)' }, '&[data-status="live"]': { background: 'var(--luigi-green-50)' }, '@media (max-width: 620px)': { gap: '6px', paddingInline: '8px' } })
const matchMetaStyle = css({ color: 'var(--ink-muted)', fontSize: '10px', left: '12px', position: 'absolute', top: '7px' })
const matchStatusStyle = css({ color: 'var(--ink-muted)', fontSize: '9px', fontWeight: 900, position: 'absolute', right: '12px', textTransform: 'uppercase', top: '7px' })
const matchTeamStyle = css({ alignItems: 'center', display: 'flex', gap: '8px', minWidth: 0, '&[data-align="right"]': { flexDirection: 'row-reverse', textAlign: 'right' }, '& > span': { display: 'grid', minWidth: 0 }, '& > span strong': { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, '& > span small': { color: 'var(--ink-muted)' }, '@media (max-width: 620px)': { '& > span strong': { fontSize: '11px' }, '& > span small': { display: 'none' } } })
const scoreStyle = css({ alignItems: 'center', display: 'flex', gap: '7px', justifyContent: 'center', minWidth: '72px', '& b': { color: 'var(--mario-blue-700)', fontFamily: 'var(--font-display)', fontSize: '28px' }, '& span': { color: 'var(--ink-muted)' }, '& strong': { color: 'var(--ink-muted)', fontSize: '12px' } })
