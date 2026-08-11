import type { Handle } from 'remix/ui'
import { css } from 'remix/ui'

import type { AdapterOperationBundle } from '@starworks/contracts'

import type { LeagueDetail, SessionIdentity } from '../platform/model.ts'
import { routes } from '../routes.ts'
import { AppShell } from './app-shell.tsx'

export function OperationPreviewPage(
  handle: Handle<{
    bundle: AdapterOperationBundle
    identity: SessionIdentity
    league: LeagueDetail
  }>,
) {
  return () => {
    let { bundle, identity, league } = handle.props
    return (
      <AppShell identity={identity} league={league} title={`Adapter preview · ${league.name} · Starworks`}>
        <header mix={headerStyle}>
          <div>
            <p mix={eyebrowStyle}>Adapter preview</p>
            <h1>{bundle.operations.length} operations</h1>
          </div>
          <a href={routes.leagues.configuration.dashboard.href({ leagueSlug: league.slug })}>Back to admin</a>
        </header>
        <pre mix={codeStyle}>{JSON.stringify(bundle, null, 2)}</pre>
      </AppShell>
    )
  }
}

const headerStyle = css({ alignItems: 'start', display: 'flex', gap: '32px', justifyContent: 'space-between', '& h1': { margin: 0 } })
const eyebrowStyle = css({ color: 'var(--text-soft)', fontFamily: 'var(--font-aurea)', fontSize: '14px', letterSpacing: '0.06em', margin: '0 0 8px', textTransform: 'uppercase' })
const codeStyle = css({ background: 'var(--surface-deep)', border: '1px solid var(--border)', borderRadius: '12px', fontSize: '12px', lineHeight: 1.5, marginTop: '32px', overflow: 'auto', padding: '22px' })
