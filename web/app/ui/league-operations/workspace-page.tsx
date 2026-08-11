import type { Handle, RemixNode } from 'remix/ui'
import { css } from 'remix/ui'

import type { LeagueDetail, SessionIdentity } from '../../platform/model.ts'
import { AppShell } from '../app-shell.tsx'

export function OperationsShell(handle: Handle<{
  children?: RemixNode
  heading: string
  identity: SessionIdentity
  league: LeagueDetail
}>) {
  return () => (
    <AppShell
      identity={handle.props.identity}
      league={handle.props.league}
      title={`${handle.props.heading} · ${handle.props.league.name} · Starworks`}
    >
      <header mix={pageHeaderStyle}>
        <h1>{handle.props.heading}</h1>
        <span>{handle.props.league.name}</span>
      </header>
      <div mix={pageContentStyle}>{handle.props.children}</div>
    </AppShell>
  )
}

export function SectionHeading(handle: Handle<{
  count?: string | number
  heading: string
  id: string
}>) {
  return () => (
    <div mix={sectionHeadingStyle}>
      <h2 id={handle.props.id}>{handle.props.heading}</h2>
      {handle.props.count === undefined ? null : <span>{handle.props.count}</span>}
    </div>
  )
}

export const emptyStyle = css({
  border: '1px dashed var(--border-strong)',
  borderRadius: '12px',
  color: 'var(--text-muted)',
  padding: '20px',
})

export const mutedStyle = css({ color: 'var(--text-muted)', lineHeight: 1.5 })
export const sectionStyle = css({ marginTop: '44px' })

const pageHeaderStyle = css({
  alignItems: 'baseline',
  display: 'flex',
  gap: '16px',
  '& h1': {
    fontFamily: 'var(--font-display)',
    fontSize: 'clamp(34px, 5vw, 48px)',
    lineHeight: 1.08,
    margin: 0,
  },
  '& span': { color: 'var(--text-muted)' },
})

const pageContentStyle = css({ marginTop: '30px' })

const sectionHeadingStyle = css({
  alignItems: 'end',
  display: 'flex',
  gap: '20px',
  justifyContent: 'space-between',
  marginBottom: '18px',
  '& h2': { fontSize: '30px', margin: 0 },
  '& span': { color: 'var(--text-muted)', fontWeight: 800 },
})
