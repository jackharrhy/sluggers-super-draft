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

const stageStyle = css({ background: 'transparent', color: 'var(--text-primary)', display: 'grid', fontFamily: 'var(--font-sans)', gap: '10px', margin: '24px', maxWidth: '920px', textShadow: '0 2px 8px rgb(0 0 0)' })
const scoreboardStyle = css({ alignItems: 'stretch', background: 'var(--surface-strong)', border: '2px solid var(--border-strong)', borderRadius: '12px', boxShadow: '0 12px 40px rgb(0 0 0 / 0.4)', display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 150px minmax(0, 1fr)', overflow: 'hidden' })
const teamStyle = css({ alignItems: 'center', display: 'grid', gap: '4px', gridTemplateColumns: 'minmax(0, 1fr) auto', padding: '18px 22px', '& span': { fontFamily: 'var(--font-display)', fontSize: '22px', fontWeight: 800, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, '& strong': { color: 'var(--text-primary)', fontFamily: 'var(--font-display)', fontSize: '44px', gridRow: 'span 2' }, '& small': { color: 'var(--text-soft)' } })
const gameStateStyle = css({ alignContent: 'center', background: 'var(--surface-deep)', display: 'grid', justifyItems: 'center', padding: '12px', textTransform: 'uppercase', '& span': { color: 'var(--text-primary)', fontFamily: 'var(--font-display)', fontSize: '24px', fontWeight: 800 }, '& small': { color: 'var(--text-soft)', fontFamily: 'var(--font-aurea)', letterSpacing: '.08em' } })
const tickerStyle = css({ alignItems: 'center', background: 'var(--surface-deep)', border: '1px solid var(--border)', borderRadius: '10px', display: 'flex', gap: '14px', padding: '10px 16px', '& span': { color: 'var(--text-soft)', fontFamily: 'var(--font-aurea)', fontSize: '11px', letterSpacing: '.08em', textTransform: 'uppercase' }, '& strong': { textTransform: 'capitalize' } })
const healthStyle = css({ color: 'var(--success-text)', fontSize: '10px', fontWeight: 900, justifySelf: 'end', margin: 0, textTransform: 'uppercase' })
