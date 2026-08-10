import type { BroadcastOverlay } from '@starworks/contracts'

let root = document.querySelector<HTMLElement>('[data-broadcast-overlay]')
let endpoint = root?.dataset.endpoint

if (root && endpoint) {
  let refresh = async () => {
    try {
      let response = await fetch(endpoint, { cache: 'no-store' })
      if (!response.ok) throw new Error(`Overlay returned ${response.status}`)
      let overlay = await response.json() as BroadcastOverlay
      let away = overlay.teams.find((team) => team.side === 'away')!
      let home = overlay.teams.find((team) => team.side === 'home')!
      text('away-name', away.name)
      text('away-runs', away.runs)
      text('away-hits', away.hits)
      text('away-errors', away.errors)
      text('home-name', home.name)
      text('home-runs', home.runs)
      text('home-hits', home.hits)
      text('home-errors', home.errors)
      text('inning', overlay.inning && overlay.half ? `${overlay.half === 'top' ? '▲' : '▼'} ${overlay.inning}` : 'Pregame')
      text('match-status', overlay.match.status.replaceAll('_', ' '))
      text('recent-event', overlay.recentEvents[0]?.eventType.replaceAll('-', ' ') ?? 'Waiting for first pitch')
      text('overlay-health', 'live')
    } catch {
      text('overlay-health', 'feed offline')
    }
  }
  void refresh()
  window.setInterval(refresh, 1_000)
}

function text(id: string, value: string | number): void {
  let element = document.getElementById(id)
  if (element) element.textContent = String(value)
}
