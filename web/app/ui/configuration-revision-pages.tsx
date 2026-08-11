import type { Handle, RemixNode } from 'remix/ui'
import { css } from 'remix/ui'

import type {
  RulesetRevisionDetail,
  StatProfileRevisionDetail,
  TeamLineupRevisionDetail,
} from '../configuration/service.ts'
import type { LeagueDetail, SessionIdentity } from '../platform/model.ts'
import { routes } from '../routes.ts'
import { characterHeadshotPath, displayCharacterName } from '../sluggers/characters.ts'
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
        returnHref={routes.leagues.configuration.statProfiles.href({ leagueSlug: league.slug })}
        returnLabel="Back to stats"
        revisionNumber={revision.revisionNumber}
        status={revision.status}
      >
        <IssueList issues={detail.issues.map((issue) => `${issue.code} · ${issue.path}`)} />
        <section aria-labelledby="characters-heading" mix={formStyle}>
          <div mix={sectionTitleStyle}>
            <h2 id="characters-heading" mix={sectionHeadingStyle}>Characters</h2>
            <span>{revision.characterValues.length}</span>
          </div>
          <div mix={characterGridStyle}>
            {revision.characterValues.map((character) => (
              <a
                href={routes.leagues.configuration.editStatProfileCharacter.href({
                  characterId: character.characterId,
                  leagueSlug: league.slug,
                  revisionId: revision.revisionId,
                })}
                mix={[cardStyle, characterLinkStyle]}
              >
                <img src={characterHeadshotPath(character.characterId)} alt="" />
                <span>
                  <strong>{displayCharacterName(character.characterId)}</strong>
                  <small>{Object.keys(character.values).length} values</small>
                </span>
              </a>
            ))}
          </div>
        </section>
        <section mix={[cardStyle, summaryStyle]} aria-labelledby="profile-shape-heading">
          <div mix={sectionTitleStyle}>
            <h2 id="profile-shape-heading" mix={sectionHeadingStyle}>Profile contents</h2>
            {revision.sluggersTuning ? <a href={routes.leagues.configuration.exportStatProfile.href(routeParams)}>Export Stat Editor v4</a> : null}
          </div>
          <dl mix={summaryGridStyle}>
            <div><dt>Character fields</dt><dd>{revision.definitions.length}</dd></div>
            <div><dt>Characters</dt><dd>{revision.characterValues.length}</dd></div>
            <div><dt>Chemistry cells</dt><dd>{revision.sluggersTuning ? 101 * 101 : 0}</dd></div>
            <div><dt>Trajectory tables</dt><dd>{revision.sluggersTuning?.trajectoryTables.length ?? 0}</dd></div>
          </dl>
        </section>
        <RevisionActions
          cloneAction={routes.leagues.configuration.cloneStatProfile.href(routeParams)}
          publishAction={routes.leagues.configuration.publishStatProfile.href(routeParams)}
          status={revision.status}
        />
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
        returnHref={routes.leagues.configuration.rulesets.href({ leagueSlug: league.slug })}
        returnLabel="Back to rules"
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
        ) : null}
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
        returnHref={routes.leagues.configuration.teams.href({ leagueSlug: league.slug })}
        returnLabel="Back to teams"
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
        ) : null}
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

function RevisionActions(handle: Handle<{
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

function IssueList(handle: Handle<{ issues: string[] }>) {
  return () => handle.props.issues.length ? (
    <section mix={[cardStyle, issueStyle]} aria-labelledby="issues-heading">
      <h2 id="issues-heading" mix={sectionHeadingStyle}>Validation issues</h2>
      <ul>{handle.props.issues.map((issue) => <li key={issue}>{issue}</li>)}</ul>
    </section>
  ) : null
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
              <td>{formatDate(row.createdAt)}</td>
              <td>{row.publishedAt ? formatDate(row.publishedAt) : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}

function formatDate(value: Date): string {
  return new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' }).format(value)
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

const heroStyle = css({ alignItems: 'end', display: 'flex', flexWrap: 'wrap', gap: '18px', justifyContent: 'space-between' })
const headingStyle = css({ fontFamily: 'var(--font-happiness)', fontSize: 'clamp(34px, 6vw, 52px)', lineHeight: 1.08, margin: 0 })
const revisionMetaStyle = css({ color: 'var(--text-muted)', margin: '8px 0 0', textTransform: 'capitalize' })
const contentStyle = css({ display: 'grid', gap: '28px', marginTop: '34px' })
const formStyle = css({ display: 'grid', gap: '18px' })
const fieldStyle = css({ display: 'grid', fontSize: '14px', fontWeight: 700, gap: '7px' })
const textareaStyle = css({ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: '12px', lineHeight: 1.5, resize: 'vertical' })
const sectionHeadingStyle = css({ fontSize: '24px', margin: 0 })
const panelHeadingStyle = css({ fontSize: '17px', margin: '0 0 14px' })
const actionsStyle = css({ alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: '18px', justifyContent: 'space-between', '& p': { color: 'var(--text-muted)', margin: '5px 0 0' } })
const issueStyle = css({ borderColor: 'var(--warning-border)', color: 'var(--warning-text)' })
const comparisonStyle = css({ display: 'grid', gap: '16px' })
const comparisonGridStyle = css({ display: 'grid', gap: '18px', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 380px), 1fr))' })
const emptyStyle = css({ color: 'var(--text-muted)' })
const codeStyle = css({ fontSize: '11px', lineHeight: 1.5, margin: 0, maxHeight: '480px', overflow: 'auto', whiteSpace: 'pre-wrap' })
const tableStyle = css({ borderCollapse: 'collapse', fontSize: '13px', width: '100%', '& th': { color: 'var(--text-muted)', textAlign: 'left' }, '& td, & th': { borderBottom: '1px solid var(--border)', padding: '10px 8px' } })
const sectionTitleStyle = css({ alignItems: 'baseline', display: 'flex', justifyContent: 'space-between', '& span': { color: 'var(--text-muted)' } })
const characterGridStyle = css({ display: 'grid', gap: '12px', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))' })
const characterLinkStyle = css({ alignItems: 'center', color: 'var(--text-primary) !important', display: 'grid', gap: '12px', gridTemplateColumns: '54px minmax(0, 1fr)', padding: '10px 14px', textDecoration: 'none', '& img': { height: '54px', objectFit: 'contain', width: '54px' }, '& span': { display: 'grid', gap: '3px', minWidth: 0 }, '& strong': { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, '& small': { color: 'var(--text-muted)', fontSize: '13px' }, '&:hover': { borderColor: 'var(--border-strong)', transform: 'translateY(-1px)' } })
const summaryStyle = css({ display: 'grid', gap: '16px' })
const summaryGridStyle = css({ display: 'grid', gap: '16px', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 140px), 1fr))', margin: 0, '& dt': { color: 'var(--text-muted)', fontSize: '13px' }, '& dd': { fontFamily: 'var(--font-display)', fontSize: '24px', margin: '4px 0 0' } })
