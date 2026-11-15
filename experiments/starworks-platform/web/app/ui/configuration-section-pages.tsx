import type { Handle, RemixNode } from 'remix/ui'
import { css } from 'remix/ui'

import type { ConfigurationDashboard, RevisionSummary } from '../configuration/service.ts'
import type { LeagueDetail, SessionIdentity } from '../platform/model.ts'
import { routes } from '../routes.ts'
import { SLUGGERS_ADAPTER_VERSION } from '../runner/adapter-version.ts'
import { AppShell, buttonStyle, cardStyle, inputStyle } from './app-shell.tsx'

interface ConfigurationPageProps {
  dashboard: ConfigurationDashboard
  identity: SessionIdentity
  league: LeagueDetail
}

export function ConfigurationHomePage(handle: Handle<ConfigurationPageProps>) {
  return () => {
    let { dashboard, identity, league } = handle.props
    let profiles = publishedRevisions(dashboard.profiles)
    let rulesets = publishedRevisions(dashboard.rulesets)
    let lineups = dashboard.teams.flatMap((team) => team.lineups
      .filter((revision) => revision.status === 'published')
      .map((revision) => ({ label: `${team.name} · r${revision.revisionNumber}`, revision, teamId: team.id })))
    return (
      <ConfigurationShell identity={identity} league={league} heading="Admin">
        <nav mix={workspaceGridStyle} aria-label="League administration">
          <WorkspaceLink href={routes.leagues.configuration.statProfiles.index.href({ leagueSlug: league.slug })} heading="Stats" detail={`${dashboard.profiles.length} profiles`} />
          <WorkspaceLink href={routes.leagues.configuration.rulesets.index.href({ leagueSlug: league.slug })} heading="Rules" detail={`${dashboard.rulesets.length} rulesets`} />
          <WorkspaceLink href={routes.leagues.configuration.teams.index.href({ leagueSlug: league.slug })} heading="Teams" detail={`${dashboard.teams.length} teams`} />
          <WorkspaceLink href={routes.leagues.content.dashboard.href({ leagueSlug: league.slug })} heading="Content" detail="Build inputs and assets" />
        </nav>
        <section mix={[cardStyle, compileStyle]} aria-labelledby="compile-heading">
          <div>
            <h2 id="compile-heading">Compile preview</h2>
            <p mix={mutedStyle}>Inspect the operations produced by published league configuration.</p>
          </div>
          {profiles.length && rulesets.length && lineups.length ? (
            <form action={routes.leagues.configuration.preview.href({ leagueSlug: league.slug })} method="post" mix={formGridStyle}>
              <SelectField label="Stat profile" name="statProfileRevisionId" options={profiles} />
              <SelectField label="Ruleset" name="rulesetRevisionId" options={rulesets} />
              <SelectField label="Team lineup" name="lineupSelection" options={lineups.map(({ label, revision, teamId }) => ({ label, value: `${teamId}:${revision.id}` }))} />
              <input type="hidden" name="adapterVersion" value={SLUGGERS_ADAPTER_VERSION} />
              <button type="submit" mix={buttonStyle}>Compile</button>
            </form>
          ) : <p mix={mutedStyle}>Publish a stat profile, ruleset, and lineup first.</p>}
        </section>
      </ConfigurationShell>
    )
  }
}

export function StatProfilesPage(handle: Handle<ConfigurationPageProps>) {
  return () => {
    let { dashboard, identity, league } = handle.props
    return (
      <ConfigurationShell identity={identity} league={league} heading="Stats">
        <div mix={contentColumnsStyle}>
          <section aria-labelledby="profiles-heading">
            <SectionHeading id="profiles-heading" heading="Stat profiles" count={dashboard.profiles.length} />
            <div mix={listStyle}>
              {dashboard.profiles.map((profile) => (
                <RevisionCard name={profile.name} revisions={profile.revisions} revisionHref={(revisionId) =>
                  routes.leagues.configuration.statProfiles.revision.show.href({ leagueSlug: league.slug, revisionId })} />
              ))}
              {!dashboard.profiles.length ? <p mix={mutedStyle}>No stat profiles yet.</p> : null}
            </div>
          </section>
          <section mix={[cardStyle, importStyle]} aria-labelledby="import-heading">
            <h2 id="import-heading">Import Stat Editor v4</h2>
            <form action={routes.leagues.configuration.statProfiles.importStatEditor.href({ leagueSlug: league.slug })} method="post" encType="multipart/form-data" mix={formStyle}>
              <Field label="Profile name" name="name" value="Imported stats" />
              <Field label="Slug" name="slug" value="imported-stats" />
              <label mix={fieldStyle}>
                <span>Stat Editor file</span>
                <input type="file" name="snapshot" accept=".txt,.csv,text/plain" required mix={inputStyle} />
              </label>
              <button type="submit" mix={buttonStyle}>Import profile</button>
            </form>
          </section>
        </div>
      </ConfigurationShell>
    )
  }
}

export function RulesetsPage(handle: Handle<ConfigurationPageProps>) {
  return () => {
    let { dashboard, identity, league } = handle.props
    return (
      <ConfigurationShell identity={identity} league={league} heading="Rules">
        <div mix={contentColumnsStyle}>
          <section aria-labelledby="rulesets-heading">
            <SectionHeading id="rulesets-heading" heading="Rulesets" count={dashboard.rulesets.length} />
            <div mix={[cardGridStyle, listStyle]}>
              {dashboard.rulesets.map((ruleset) => (
                <RevisionCard name={ruleset.name} revisions={ruleset.revisions} revisionHref={(revisionId) =>
                  routes.leagues.configuration.rulesets.revision.show.href({ leagueSlug: league.slug, revisionId })} />
              ))}
              {!dashboard.rulesets.length ? <p mix={mutedStyle}>No rulesets yet.</p> : null}
            </div>
          </section>
          <section mix={[cardStyle, importStyle]} aria-labelledby="create-ruleset-heading">
            <h2 id="create-ruleset-heading">New ruleset</h2>
            <p mix={mutedStyle}>Starts with every rule supported by the current Sluggers runner.</p>
            <form action={routes.leagues.configuration.rulesets.create.href({ leagueSlug: league.slug })} method="post" mix={formStyle}>
              <Field label="Name" name="name" value="League rules" />
              <Field label="Slug" name="slug" value="league-rules" />
              <button type="submit" mix={buttonStyle}>Create ruleset</button>
            </form>
          </section>
        </div>
      </ConfigurationShell>
    )
  }
}

export function TeamsConfigurationPage(handle: Handle<ConfigurationPageProps>) {
  return () => {
    let { dashboard, identity, league } = handle.props
    return (
      <ConfigurationShell identity={identity} league={league} heading="Teams">
        <SectionHeading id="teams-heading" heading="Published lineups" count={dashboard.teams.length} />
        <div mix={cardGridStyle}>
          {dashboard.teams.map((team) => (
            <article mix={[cardStyle, formStyle]}>
              <h2 mix={cardHeadingStyle}>{team.name}</h2>
              <RevisionList revisions={team.lineups} revisionHref={(revisionId) => routes.leagues.configuration.teams.lineup.show.href({
                leagueSlug: league.slug,
                revisionId,
                teamId: team.id,
              })} />
              <details>
                <summary>Import AutoTeam lineup</summary>
                <form action={routes.leagues.configuration.teams.importAutoTeam.href({ leagueSlug: league.slug, teamId: team.id })} method="post" mix={formStyle}>
                  <input type="hidden" name="teamName" value={team.name} />
                  <label mix={fieldStyle}>
                    <span>teams.json entry</span>
                    <textarea name="snapshot" rows={9} required mix={inputStyle} />
                  </label>
                  <button type="submit" mix={buttonStyle}>Import lineup</button>
                </form>
              </details>
            </article>
          ))}
        </div>
      </ConfigurationShell>
    )
  }
}

function ConfigurationShell(handle: Handle<{
  children?: RemixNode
  heading: string
  identity: SessionIdentity
  league: LeagueDetail
}>) {
  return () => (
    <AppShell identity={handle.props.identity} league={handle.props.league} title={`${handle.props.heading} · ${handle.props.league.name} · Starworks`}>
      <header mix={pageHeaderStyle}>
        <h1>{handle.props.heading}</h1>
        <span>{handle.props.league.name}</span>
      </header>
      <div mix={pageContentStyle}>{handle.props.children}</div>
    </AppShell>
  )
}

function WorkspaceLink(handle: Handle<{ detail: string; heading: string; href: string }>) {
  return () => (
    <a href={handle.props.href} mix={[cardStyle, workspaceLinkStyle]}>
      <strong>{handle.props.heading}</strong>
      <span>{handle.props.detail}</span>
    </a>
  )
}

function SectionHeading(handle: Handle<{ count: number; heading: string; id: string }>) {
  return () => (
    <div mix={sectionHeadingStyle}>
      <h2 id={handle.props.id}>{handle.props.heading}</h2>
      <span>{handle.props.count}</span>
    </div>
  )
}

function RevisionCard(handle: Handle<{ name: string; revisionHref: (id: string) => string; revisions: RevisionSummary[] }>) {
  return () => (
    <article mix={[cardStyle, formStyle]}>
      <h2 mix={cardHeadingStyle}>{handle.props.name}</h2>
      <RevisionList revisions={handle.props.revisions} revisionHref={handle.props.revisionHref} />
    </article>
  )
}

function RevisionList(handle: Handle<{ revisionHref: (id: string) => string; revisions: RevisionSummary[] }>) {
  return () => handle.props.revisions.length ? (
    <ol mix={revisionListStyle}>
      {handle.props.revisions.map((revision) => (
        <li>
          <a href={handle.props.revisionHref(revision.id)}>Revision {revision.revisionNumber}</a>
          <span>{revision.status}</span>
        </li>
      ))}
    </ol>
  ) : <p mix={mutedStyle}>No revisions yet.</p>
}

function Field(handle: Handle<{ label: string; name: string; value: string }>) {
  return () => <label mix={fieldStyle}><span>{handle.props.label}</span><input name={handle.props.name} defaultValue={handle.props.value} required mix={inputStyle} /></label>
}

function SelectField(handle: Handle<{ label: string; name: string; options: Array<{ label: string; value: string }> }>) {
  return () => <label mix={fieldStyle}><span>{handle.props.label}</span><select name={handle.props.name} required mix={inputStyle}>{handle.props.options.map((option) => <option value={option.value}>{option.label}</option>)}</select></label>
}

function publishedRevisions(items: Array<{ name: string; revisions: RevisionSummary[] }>) {
  return items.flatMap((item) => item.revisions
    .filter((revision) => revision.status === 'published')
    .map((revision) => ({ label: `${item.name} · r${revision.revisionNumber}`, value: revision.id })))
}

const pageHeaderStyle = css({ alignItems: 'baseline', display: 'flex', gap: '16px', '& h1': { fontFamily: 'var(--font-happiness)', fontSize: 'clamp(34px, 6vw, 54px)', margin: 0 }, '& span': { color: 'var(--text-muted)' } })
const pageContentStyle = css({ display: 'grid', gap: '40px', marginTop: '36px' })
const workspaceGridStyle = css({ display: 'grid', gap: '16px', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))' })
const workspaceLinkStyle = css({ color: 'var(--text-primary) !important', display: 'grid', gap: '6px', textDecoration: 'none', '& strong': { fontFamily: 'var(--font-display)', fontSize: '22px' }, '& span': { color: 'var(--text-muted)' }, '&:hover': { borderColor: 'var(--border-strong)', transform: 'translateY(-2px)' } })
const compileStyle = css({ display: 'grid', gap: '22px', '& h2': { margin: '0 0 5px' } })
const formGridStyle = css({ alignItems: 'end', display: 'grid', gap: '14px', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' })
const contentColumnsStyle = css({ alignItems: 'start', display: 'grid', gap: '28px', gridTemplateColumns: 'minmax(0, 1.5fr) minmax(280px, .7fr)', '@media (max-width: 1050px)': { gridTemplateColumns: '1fr' } })
const listStyle = css({ display: 'grid', gap: '14px', marginTop: '18px' })
const cardGridStyle = css({ display: 'grid', gap: '18px', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 300px), 1fr))' })
const importStyle = css({ position: 'sticky', top: '20px', '& h2': { marginTop: 0 }, '@media (max-width: 1050px)': { position: 'static' } })
const formStyle = css({ display: 'grid', gap: '14px' })
const fieldStyle = css({ display: 'grid', fontSize: '14px', fontWeight: 700, gap: '6px' })
const sectionHeadingStyle = css({ alignItems: 'baseline', display: 'flex', justifyContent: 'space-between', '& h2': { margin: 0 }, '& span': { color: 'var(--text-muted)' } })
const cardHeadingStyle = css({ fontSize: '21px', margin: 0 })
const revisionListStyle = css({ display: 'grid', gap: '8px', listStyle: 'none', margin: 0, padding: 0, '& li': { alignItems: 'center', display: 'flex', justifyContent: 'space-between' }, '& span': { color: 'var(--text-muted)', fontSize: '13px', textTransform: 'capitalize' } })
const mutedStyle = css({ color: 'var(--text-muted)', margin: 0 })
