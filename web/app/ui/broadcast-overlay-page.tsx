import type { BroadcastOverlay } from '@starworks/contracts'
import type { Handle } from 'remix/ui'
import { css } from 'remix/ui'

import { routes } from '../routes.ts'
import { Document } from './document.tsx'

export function BroadcastOverlayPage(handle: Handle<{ overlay: BroadcastOverlay }>) {
  return () => {
    let { overlay } = handle.props
    let away = overlay.teams.find((team) => team.side === 'away')!
    let home = overlay.teams.find((team) => team.side === 'home')!
    let endpoint = routes.broadcastData.href({
      leagueSlug: overlay.league.slug,
      matchId: overlay.match.id,
    })
    return <Document
      title={`${away.name} at ${home.name} · Starworks`}
      head={<script type="module" src={routes.assets.href({ path: 'app/assets/broadcast-overlay.ts' })}></script>}
    >
      <main mix={stageStyle} data-broadcast-overlay data-endpoint={endpoint}>
        <section mix={scoreboardStyle} aria-label="Live game score">
          <div mix={teamStyle}><span id="away-name">{away.name}</span><strong id="away-runs">{away.runs}</strong><small><b id="away-hits">{away.hits}</b> H · <b id="away-errors">{away.errors}</b> E</small></div>
          <div mix={gameStateStyle}><span id="inning">{inningLabel(overlay)}</span><small id="match-status">{overlay.match.status.replaceAll('_', ' ')}</small></div>
          <div mix={teamStyle}><span id="home-name">{home.name}</span><strong id="home-runs">{home.runs}</strong><small><b id="home-hits">{home.hits}</b> H · <b id="home-errors">{home.errors}</b> E</small></div>
        </section>
        <section mix={tickerStyle}><span>Recent</span><strong id="recent-event">{recentLabel(overlay)}</strong></section>
        <p id="overlay-health" mix={healthStyle}>live</p>
      </main>
    </Document>
  }
}

function inningLabel(overlay: BroadcastOverlay): string {
  if (!overlay.inning || !overlay.half) return 'Pregame'
  return `${overlay.half === 'top' ? '▲' : '▼'} ${overlay.inning}`
}

function recentLabel(overlay: BroadcastOverlay): string {
  let event = overlay.recentEvents[0]
  return event ? event.eventType.replaceAll('-', ' ') : 'Waiting for first pitch'
}

const stageStyle = css({ background: 'transparent', color: '#fff', display: 'grid', fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif', gap: '10px', margin: '24px', maxWidth: '920px', textShadow: '0 2px 8px #000' })
const scoreboardStyle = css({ alignItems: 'stretch', background: 'linear-gradient(135deg, rgba(10,16,31,.96), rgba(28,42,73,.96))', border: '2px solid rgba(247,201,72,.85)', borderRadius: '18px', boxShadow: '0 12px 40px rgba(0,0,0,.45)', display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 150px minmax(0, 1fr)', overflow: 'hidden' })
const teamStyle = css({ alignItems: 'center', display: 'grid', gap: '4px', gridTemplateColumns: 'minmax(0, 1fr) auto', padding: '18px 22px', '& span': { fontSize: '22px', fontWeight: 900, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, '& strong': { color: '#f7c948', fontSize: '44px', gridRow: 'span 2' }, '& small': { color: '#c9d4e9' } })
const gameStateStyle = css({ alignContent: 'center', background: 'rgba(0,0,0,.28)', display: 'grid', justifyItems: 'center', padding: '12px', textTransform: 'uppercase', '& span': { color: '#78d5ff', fontSize: '24px', fontWeight: 900 }, '& small': { color: '#c9d4e9', fontWeight: 800, letterSpacing: '.08em' } })
const tickerStyle = css({ alignItems: 'center', background: 'rgba(10,16,31,.93)', borderRadius: '12px', display: 'flex', gap: '14px', padding: '10px 16px', '& span': { color: '#f7c948', fontSize: '11px', fontWeight: 900, letterSpacing: '.12em', textTransform: 'uppercase' }, '& strong': { textTransform: 'capitalize' } })
const healthStyle = css({ background: '#123d32', borderRadius: '999px', color: '#8ee0bd', fontSize: '10px', fontWeight: 900, justifySelf: 'end', margin: 0, padding: '5px 9px', textTransform: 'uppercase' })
