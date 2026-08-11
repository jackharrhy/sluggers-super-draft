import type { Handle, RemixNode } from 'remix/ui'
import { css } from 'remix/ui'

import type { LeagueDetail, SessionIdentity } from '../platform/model.ts'
import { AppShell, buttonStyle, cardStyle } from './app-shell.tsx'

export function RevisionShell(handle: Handle<{
  children?: RemixNode
  heading: string
  identity: SessionIdentity
  kind: string
  league: LeagueDetail
  returnHref: string
  returnLabel: string
  revisionNumber: number
  status: 'draft' | 'published'
}>) {
  return () => {
    let { children, heading, identity, kind, league, returnHref, returnLabel, revisionNumber, status } = handle.props
    return (
      <AppShell identity={identity} league={league} title={`${heading} · ${league.name} · Starworks`}>
        <header mix={heroStyle}>
          <div>
            <h1 mix={headingStyle}>{heading}</h1>
            <p mix={revisionMetaStyle}>{kind} · Revision {revisionNumber} · {status}</p>
          </div>
          <a href={returnHref}>{returnLabel}</a>
        </header>
        <div mix={contentStyle}>{children}</div>
      </AppShell>
    )
  }
}

export function RevisionActions(handle: Handle<{
  cloneAction: string
  publishAction: string
  status: 'draft' | 'published'
}>) {
  return () => (
    <section mix={[cardStyle, actionsStyle]} aria-label="Revision actions">
      <div>
        <strong>{handle.props.status === 'draft' ? 'Draft revision' : 'Published revision'}</strong>
        <p>{handle.props.status === 'draft' ? 'Publish when every change is ready for league use.' : 'Published revisions are immutable. Clone this one to make changes.'}</p>
      </div>
      {handle.props.status === 'draft' ? (
        <form action={handle.props.publishAction} method="post">
          <button type="submit" mix={buttonStyle}>Publish and lock revision</button>
        </form>
      ) : (
        <form action={handle.props.cloneAction} method="post">
          <button type="submit" mix={buttonStyle}>Clone into new draft</button>
        </form>
      )}
    </section>
  )
}

export function IssueList(handle: Handle<{ issues: string[] }>) {
  return () => handle.props.issues.length ? (
    <section mix={[cardStyle, issueStyle]} aria-labelledby="issues-heading">
      <h2 id="issues-heading" mix={sectionHeadingStyle}>Needs attention</h2>
      <ul>{handle.props.issues.map((issue) => <li key={issue}>{issue}</li>)}</ul>
    </section>
  ) : null
}

export function RevisionHistory(handle: Handle<{
  rows: Array<{
    createdAt: Date
    id: string
    publishedAt: Date | null
    revisionNumber: number
    status: 'draft' | 'published'
  }>
}>) {
  return () => (
    <section mix={[cardStyle, historyStyle]} aria-labelledby="history-heading">
      <h2 id="history-heading" mix={sectionHeadingStyle}>Revision history</h2>
      <div mix={tableScrollerStyle}>
        <table mix={tableStyle}>
          <thead><tr><th>Revision</th><th>Status</th><th>Created</th><th>Published</th></tr></thead>
          <tbody>
            {handle.props.rows.map((row) => (
              <tr key={row.id}>
                <td>{row.revisionNumber}</td>
                <td>{row.status}</td>
                <td>{formatDate(row.createdAt)}</td>
                <td>{row.publishedAt ? formatDate(row.publishedAt) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function formatDate(value: Date): string {
  return new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' }).format(value)
}

export const sectionHeadingStyle = css({ fontSize: '24px', margin: 0 })
const heroStyle = css({ alignItems: 'end', display: 'flex', flexWrap: 'wrap', gap: '18px', justifyContent: 'space-between' })
const headingStyle = css({ fontFamily: 'var(--font-happiness)', fontSize: 'clamp(34px, 6vw, 52px)', lineHeight: 1.08, margin: 0 })
const revisionMetaStyle = css({ color: 'var(--text-muted)', margin: '8px 0 0', textTransform: 'capitalize' })
const contentStyle = css({ display: 'grid', gap: '28px', marginTop: '34px' })
const actionsStyle = css({ alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: '18px', justifyContent: 'space-between', '& p': { color: 'var(--text-muted)', margin: '5px 0 0' } })
const issueStyle = css({ borderColor: 'var(--warning-border)', color: 'var(--warning-text)' })
const historyStyle = css({ display: 'grid', gap: '18px' })
const tableScrollerStyle = css({ overflowX: 'auto' })
const tableStyle = css({ borderCollapse: 'collapse', fontSize: '13px', minWidth: '520px', width: '100%', '& th': { color: 'var(--text-muted)', textAlign: 'left' }, '& td, & th': { borderBottom: '1px solid var(--border)', padding: '10px 8px' } })
