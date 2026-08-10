import type { Handle, RemixNode } from 'remix/ui'
import { css } from 'remix/ui'

import type {
  RulesetRevisionDetail,
  StatProfileRevisionDetail,
  TeamLineupRevisionDetail,
} from '../configuration/service.ts'
import type { LeagueDetail, SessionIdentity } from '../platform/model.ts'
import { routes } from '../routes.ts'
import { AppShell, buttonStyle, cardStyle, inputStyle } from './app-shell.tsx'

interface RevisionPageProps<TDetail> {
  detail: TDetail
  identity: SessionIdentity
  league: LeagueDetail
}

export function StatProfileRevisionPage(handle: Handle<RevisionPageProps<StatProfileRevisionDetail>>) {
  return () => {
    let { detail, identity, league } = handle.props
    let revision = detail.revision
    let routeParams = { leagueSlug: league.slug, revisionId: revision.revisionId }
    return (
      <RevisionShell
        identity={identity}
        league={league}
        heading={revision.name}
        kind="Stat profile"
        revisionNumber={revision.revisionNumber}
        status={revision.status}
      >
        <IssueList issues={detail.issues.map((issue) => `${issue.code} · ${issue.path}`)} />
        {revision.status === 'draft' ? (
          <form action={routes.leagues.configuration.updateStatProfile.href(routeParams)} method="post" mix={[cardStyle, formStyle]}>
            <TextField label="Revision name" name="name" value={revision.name} />
            <JsonEditor label="Stat definitions" name="definitions" value={revision.definitions} />
            <JsonEditor label="Character values" name="characterValues" value={revision.characterValues} />
            <button type="submit" mix={buttonStyle}>Save draft</button>
          </form>
        ) : <LockedNotice />}
        <RevisionActions
          cloneAction={routes.leagues.configuration.cloneStatProfile.href(routeParams)}
          publishAction={routes.leagues.configuration.publishStatProfile.href(routeParams)}
          status={revision.status}
        />
        <Comparison current={{ definitions: revision.definitions, characterValues: revision.characterValues }} previous={detail.basedOnRevision ? { definitions: detail.basedOnRevision.definitions, characterValues: detail.basedOnRevision.characterValues } : null} />
        <History rows={detail.history} />
      </RevisionShell>
    )
  }
}

export function RulesetRevisionPage(handle: Handle<RevisionPageProps<RulesetRevisionDetail>>) {
  return () => {
    let { detail, identity, league } = handle.props
    let revision = detail.revision
    let routeParams = { leagueSlug: league.slug, revisionId: revision.revisionId }
    let issues = revision.settings
      .filter((setting) => setting.loadPhase !== 'web-only' && !setting.gameplayTarget)
      .map((setting) => `missing-gameplay-target · ${setting.key}`)
    return (
      <RevisionShell
        identity={identity}
        league={league}
        heading={revision.name}
        kind="Ruleset"
        revisionNumber={revision.revisionNumber}
        status={revision.status}
      >
        <IssueList issues={issues} />
        {revision.status === 'draft' ? (
          <form action={routes.leagues.configuration.updateRuleset.href(routeParams)} method="post" mix={[cardStyle, formStyle]}>
            <TextField label="Revision name" name="name" value={revision.name} />
            <JsonEditor label="Rule settings" name="settings" value={revision.settings} />
            <button type="submit" mix={buttonStyle}>Save draft</button>
          </form>
        ) : <LockedNotice />}
        <RevisionActions
          cloneAction={routes.leagues.configuration.cloneRuleset.href(routeParams)}
          publishAction={routes.leagues.configuration.publishRuleset.href(routeParams)}
          status={revision.status}
        />
        <Comparison current={revision.settings} previous={detail.basedOnRevision?.settings ?? null} />
        <History rows={detail.history} />
      </RevisionShell>
    )
  }
}

export function TeamLineupRevisionPage(handle: Handle<RevisionPageProps<TeamLineupRevisionDetail>>) {
  return () => {
    let { detail, identity, league } = handle.props
    let revision = detail.revision
    let routeParams = {
      leagueSlug: league.slug,
      revisionId: revision.lineupRevisionId,
      teamId: revision.teamId,
    }
    return (
      <RevisionShell
        identity={identity}
        league={league}
        heading={`Team lineup r${revision.lineupRevisionNumber}`}
        kind="Roster and lineup"
        revisionNumber={revision.lineupRevisionNumber}
        status={revision.status}
      >
        <IssueList issues={detail.issues} />
        {revision.status === 'draft' ? (
          <form action={routes.leagues.configuration.updateLineup.href(routeParams)} method="post" mix={[cardStyle, formStyle]}>
            <JsonEditor label="Roster character IDs" name="rosterCharacterIds" value={revision.rosterCharacterIds} />
            <JsonEditor label="Effective lineup" name="lineup" value={revision.lineup} />
            <button type="submit" mix={buttonStyle}>Save draft</button>
          </form>
        ) : <LockedNotice />}
        <RevisionActions
          cloneAction={routes.leagues.configuration.cloneLineup.href(routeParams)}
          publishAction={routes.leagues.configuration.publishLineup.href(routeParams)}
          status={revision.status}
        />
        <Comparison
          current={{ rosterCharacterIds: revision.rosterCharacterIds, lineup: revision.lineup }}
          previous={detail.basedOnRevision ? { rosterCharacterIds: detail.basedOnRevision.rosterCharacterIds, lineup: detail.basedOnRevision.lineup } : null}
        />
        <History rows={detail.history} />
      </RevisionShell>
    )
  }
}

function RevisionShell(handle: Handle<{
  children?: RemixNode
  heading: string
  identity: SessionIdentity
  kind: string
  league: LeagueDetail
  revisionNumber: number
  status: 'draft' | 'published'
}>) {
  return () => {
    let { children, heading, identity, kind, league, revisionNumber, status } = handle.props
    return (
      <AppShell identity={identity} title={`${heading} · ${league.name} · Starworks`}>
        <header mix={heroStyle}>
          <div>
            <p mix={eyebrowStyle}>{kind} · revision {revisionNumber}</p>
            <h1 mix={headingStyle}>{heading}</h1>
            <span mix={status === 'published' ? publishedStyle : draftStyle}>{status}</span>
          </div>
          <a href={routes.leagues.configuration.dashboard.href({ leagueSlug: league.slug })}>All configuration</a>
        </header>
        <div mix={contentStyle}>{children}</div>
      </AppShell>
    )
  }
}

function RevisionActions(handle: Handle<{
  cloneAction: string
  publishAction: string
  status: 'draft' | 'published'
}>) {
  return () => (
    <section mix={actionsStyle} aria-label="Revision actions">
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

function LockedNotice() {
  return () => (
    <section mix={[cardStyle, lockedStyle]}>
      <strong>Published revision</strong>
      <span>This snapshot is immutable. Clone it to make the next revision.</span>
    </section>
  )
}

function IssueList(handle: Handle<{ issues: string[] }>) {
  return () => handle.props.issues.length ? (
    <section mix={[cardStyle, issueStyle]} aria-labelledby="issues-heading">
      <h2 id="issues-heading" mix={sectionHeadingStyle}>Validation issues</h2>
      <ul>{handle.props.issues.map((issue) => <li key={issue}>{issue}</li>)}</ul>
    </section>
  ) : (
    <p mix={validStyle}>This revision passes semantic validation.</p>
  )
}

function Comparison(handle: Handle<{ current: unknown; previous: unknown | null }>) {
  return () => (
    <section mix={comparisonStyle} aria-labelledby="comparison-heading">
      <h2 id="comparison-heading" mix={sectionHeadingStyle}>Revision comparison</h2>
      <div mix={comparisonGridStyle}>
        <JsonPanel heading="Current revision" value={handle.props.current} />
        {handle.props.previous ? <JsonPanel heading="Based on" value={handle.props.previous} /> : (
          <article mix={[cardStyle, emptyStyle]}>This is the first revision.</article>
        )}
      </div>
    </section>
  )
}

function JsonPanel(handle: Handle<{ heading: string; value: unknown }>) {
  return () => (
    <article mix={cardStyle}>
      <h3 mix={panelHeadingStyle}>{handle.props.heading}</h3>
      <pre mix={codeStyle}>{JSON.stringify(handle.props.value, null, 2)}</pre>
    </article>
  )
}

function History(handle: Handle<{ rows: Array<{ id: string; revisionNumber: number; status: 'draft' | 'published'; createdAt: Date; publishedAt: Date | null }> }>) {
  return () => (
    <section mix={[cardStyle, formStyle]} aria-labelledby="history-heading">
      <h2 id="history-heading" mix={sectionHeadingStyle}>Revision history</h2>
      <table mix={tableStyle}>
        <thead><tr><th>Revision</th><th>Status</th><th>Created</th><th>Published</th></tr></thead>
        <tbody>
          {handle.props.rows.map((row) => (
            <tr key={row.id}>
              <td>{row.revisionNumber}</td>
              <td>{row.status}</td>
              <td>{row.createdAt.toISOString()}</td>
              <td>{row.publishedAt?.toISOString() ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}

function TextField(handle: Handle<{ label: string; name: string; value: string }>) {
  return () => (
    <label mix={fieldStyle}>
      <span>{handle.props.label}</span>
      <input required name={handle.props.name} defaultValue={handle.props.value} mix={inputStyle} />
    </label>
  )
}

function JsonEditor(handle: Handle<{ label: string; name: string; value: unknown }>) {
  return () => (
    <label mix={fieldStyle}>
      <span>{handle.props.label}</span>
      <textarea required name={handle.props.name} defaultValue={JSON.stringify(handle.props.value, null, 2)} rows={18} mix={[inputStyle, textareaStyle]} />
    </label>
  )
}

const heroStyle = css({ alignItems: 'start', display: 'flex', gap: '32px', justifyContent: 'space-between' })
const eyebrowStyle = css({ color: '#f7c948', fontSize: '12px', fontWeight: 800, letterSpacing: '0.14em', margin: '0 0 10px', textTransform: 'uppercase' })
const headingStyle = css({ fontSize: '48px', letterSpacing: '-0.05em', lineHeight: 1.05, margin: '0 0 16px' })
const contentStyle = css({ display: 'grid', gap: '28px', marginTop: '44px' })
const formStyle = css({ display: 'grid', gap: '18px' })
const fieldStyle = css({ display: 'grid', fontSize: '14px', fontWeight: 700, gap: '7px' })
const textareaStyle = css({ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: '12px', lineHeight: 1.5, resize: 'vertical' })
const sectionHeadingStyle = css({ fontSize: '24px', margin: 0 })
const panelHeadingStyle = css({ fontSize: '17px', margin: '0 0 14px' })
const actionsStyle = css({ display: 'flex', gap: '14px' })
const lockedStyle = css({ display: 'grid', gap: '6px', '& span': { color: '#b9c5dc' } })
const issueStyle = css({ borderColor: '#8d5f36', color: '#ffd39f' })
const validStyle = css({ background: '#163d35', border: '1px solid #2b7563', borderRadius: '12px', color: '#8ff0cc', fontWeight: 700, margin: 0, padding: '14px 18px' })
const comparisonStyle = css({ display: 'grid', gap: '16px' })
const comparisonGridStyle = css({ display: 'grid', gap: '18px', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 380px), 1fr))' })
const emptyStyle = css({ color: '#9faec8' })
const codeStyle = css({ fontSize: '11px', lineHeight: 1.5, margin: 0, maxHeight: '480px', overflow: 'auto', whiteSpace: 'pre-wrap' })
const tableStyle = css({ borderCollapse: 'collapse', fontSize: '13px', width: '100%', '& th': { color: '#9faec8', textAlign: 'left' }, '& td, & th': { borderBottom: '1px solid #2d3955', padding: '10px 8px' } })
const publishedStyle = css({ background: '#163d35', borderRadius: '999px', color: '#8ff0cc', display: 'inline-block', fontSize: '11px', fontWeight: 800, padding: '5px 9px', textTransform: 'uppercase' })
const draftStyle = css({ background: '#443719', borderRadius: '999px', color: '#f7d778', display: 'inline-block', fontSize: '11px', fontWeight: 800, padding: '5px 9px', textTransform: 'uppercase' })
