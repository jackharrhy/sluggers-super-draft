import type { Handle } from 'remix/ui'
import { css } from 'remix/ui'

import type { AdapterOperationBundle } from '@starworks/contracts'

import type { ConfigurationDashboard, RevisionSummary } from '../configuration/service.ts'
import type { LeagueDetail, SessionIdentity } from '../platform/model.ts'
import { routes } from '../routes.ts'
import { AppShell, buttonStyle, cardStyle, inputStyle } from './app-shell.tsx'

export function ConfigurationDashboardPage(
  handle: Handle<{
    dashboard: ConfigurationDashboard
    identity: SessionIdentity
    league: LeagueDetail
  }>,
) {
  return () => {
    let { dashboard, identity, league } = handle.props
    let publishedProfiles = dashboard.profiles.flatMap((profile) =>
      profile.revisions
        .filter((revision) => revision.status === 'published')
        .map((revision) => ({ label: `${profile.name} · r${revision.revisionNumber}`, revision })),
    )
    let publishedRulesets = dashboard.rulesets.flatMap((ruleset) =>
      ruleset.revisions
        .filter((revision) => revision.status === 'published')
        .map((revision) => ({ label: `${ruleset.name} · r${revision.revisionNumber}`, revision })),
    )
    let publishedLineups = dashboard.teams.flatMap((team) =>
      team.lineups
        .filter((revision) => revision.status === 'published')
        .map((revision) => ({ label: `${team.name} · r${revision.revisionNumber}`, revision, teamId: team.id })),
    )

    return (
      <AppShell identity={identity} title={`Configuration · ${league.name} · Starworks`}>
        <header mix={heroStyle}>
          <div>
            <p mix={eyebrowStyle}>League configuration</p>
            <h1 mix={headingStyle}>{league.name}</h1>
            <p mix={ledeStyle}>
              Version stats, game rules, rosters, and legal lineups. Publishing locks a revision;
              future changes begin from a clone.
            </p>
          </div>
          <a href={routes.leagues.show.href({ leagueSlug: league.slug })}>League overview</a>
        </header>

        <section mix={sectionStyle} aria-labelledby="stats-heading">
          <div mix={sectionHeadingStyle}>
            <div>
              <p mix={eyebrowStyle}>Character data</p>
              <h2 id="stats-heading" mix={subheadingStyle}>Stat profiles</h2>
            </div>
            <span mix={countStyle}>{dashboard.profiles.length} profiles</span>
          </div>
          <div mix={gridStyle}>
            {dashboard.profiles.map((profile) => (
              <RevisionCard
                key={profile.id}
                name={profile.name}
                revisions={profile.revisions}
                revisionHref={(revisionId) => routes.leagues.configuration.showStatProfile.href({ leagueSlug: league.slug, revisionId })}
              />
            ))}
            <form action={routes.leagues.configuration.createStatProfile.href({ leagueSlug: league.slug })} method="post" mix={[cardStyle, formStyle]}>
              <h3 mix={cardHeadingStyle}>New stat profile</h3>
              <Field label="Name" name="name" defaultValue="Competitive stats" />
              <Field label="Slug" name="slug" defaultValue="competitive-stats" />
              <JsonField label="Stat definitions" name="definitions" value={starterDefinitions} />
              <JsonField label="Character values" name="characterValues" value={starterCharacterValues} />
              <button type="submit" mix={buttonStyle}>Create draft</button>
            </form>
            <details mix={[cardStyle, importStyle]}>
              <summary>Import Sluggers Stat Editor v4</summary>
              <form action={routes.leagues.configuration.importStatEditor.href({ leagueSlug: league.slug })} method="post" mix={nestedFormStyle}>
                <p mix={emptyStyle}>Paste a 507-line v4 save. Starworks imports character-shaped data and reports the unsupported relational/global sections in its migration boundary.</p>
                <Field label="Profile name" name="name" defaultValue="Imported Stat Editor profile" />
                <Field label="Slug" name="slug" defaultValue="imported-stat-editor" />
                <label mix={fieldStyle}>
                  <span>Stat Editor v4 snapshot</span>
                  <textarea required name="rawText" rows={12} mix={[inputStyle, textareaStyle]} />
                </label>
                <button type="submit" mix={buttonStyle}>Import into draft</button>
              </form>
            </details>
          </div>
        </section>

        <section mix={sectionStyle} aria-labelledby="rules-heading">
          <div mix={sectionHeadingStyle}>
            <div>
              <p mix={eyebrowStyle}>League behavior</p>
              <h2 id="rules-heading" mix={subheadingStyle}>Rulesets</h2>
            </div>
            <span mix={countStyle}>{dashboard.rulesets.length} rulesets</span>
          </div>
          <div mix={gridStyle}>
            {dashboard.rulesets.map((ruleset) => (
              <RevisionCard
                key={ruleset.id}
                name={ruleset.name}
                revisions={ruleset.revisions}
                revisionHref={(revisionId) => routes.leagues.configuration.showRuleset.href({ leagueSlug: league.slug, revisionId })}
              />
            ))}
            <form action={routes.leagues.configuration.createRuleset.href({ leagueSlug: league.slug })} method="post" mix={[cardStyle, formStyle]}>
              <h3 mix={cardHeadingStyle}>New ruleset</h3>
              <Field label="Name" name="name" defaultValue="League rules" />
              <Field label="Slug" name="slug" defaultValue="league-rules" />
              <JsonField label="Rule settings" name="settings" value={starterRules} />
              <button type="submit" mix={buttonStyle}>Create draft</button>
            </form>
          </div>
        </section>

        <section mix={sectionStyle} aria-labelledby="teams-heading">
          <div mix={sectionHeadingStyle}>
            <div>
              <p mix={eyebrowStyle}>On-field setup</p>
              <h2 id="teams-heading" mix={subheadingStyle}>Team lineups</h2>
            </div>
            <span mix={countStyle}>{dashboard.teams.length} teams</span>
          </div>
          <div mix={gridStyle}>
            {dashboard.teams.map((team) => (
              <article key={team.id} mix={[cardStyle, formStyle]}>
                <h3 mix={cardHeadingStyle}>{team.name}</h3>
                <RevisionList
                  revisions={team.lineups}
                  revisionHref={(revisionId) => routes.leagues.configuration.showLineup.href({
                    leagueSlug: league.slug,
                    revisionId,
                    teamId: team.id,
                  })}
                />
                <details>
                  <summary>Create lineup draft</summary>
                  <form action={routes.leagues.configuration.createLineup.href({ leagueSlug: league.slug, teamId: team.id })} method="post" mix={nestedFormStyle}>
                    <JsonField label="Roster character IDs" name="rosterCharacterIds" value={starterRoster} />
                    <JsonField label="Lineup" name="lineup" value={starterLineup} />
                    <button type="submit" mix={buttonStyle}>Create lineup</button>
                  </form>
                </details>
                <details>
                  <summary>Import MSS-AutoTeam</summary>
                  <form action={routes.leagues.configuration.importAutoTeam.href({ leagueSlug: league.slug, teamId: team.id })} method="post" mix={nestedFormStyle}>
                    <Field label="Source team name" name="teamName" defaultValue={team.name} />
                    <label mix={fieldStyle}>
                      <span>AutoTeam teams.json</span>
                      <textarea required name="snapshot" rows={10} mix={[inputStyle, textareaStyle]} />
                    </label>
                    <button type="submit" mix={buttonStyle}>Import lineup draft</button>
                  </form>
                </details>
              </article>
            ))}
          </div>
        </section>

        <section mix={[sectionStyle, cardStyle]} aria-labelledby="preview-heading">
          <div>
            <p mix={eyebrowStyle}>Runner boundary</p>
            <h2 id="preview-heading" mix={subheadingStyle}>Compile preview</h2>
            <p mix={ledeStyle}>Translate only published revisions into ordered, symbolic adapter operations.</p>
          </div>
          {publishedProfiles.length && publishedRulesets.length && publishedLineups.length ? (
            <form action={routes.leagues.configuration.preview.href({ leagueSlug: league.slug })} method="post" mix={previewFormStyle}>
              <SelectField label="Stat profile" name="statProfileRevisionId" options={publishedProfiles.map(({ label, revision }) => ({ label, value: revision.id }))} />
              <SelectField label="Ruleset" name="rulesetRevisionId" options={publishedRulesets.map(({ label, revision }) => ({ label, value: revision.id }))} />
              <SelectField label="Team lineup" name="lineupSelection" options={publishedLineups.map(({ label, revision, teamId }) => ({ label, value: `${teamId}:${revision.id}` }))} />
              <Field label="Adapter version" name="adapterVersion" defaultValue="0.1.0" />
              <button type="submit" mix={buttonStyle}>Compile operations</button>
            </form>
          ) : (
            <p mix={emptyStyle}>Publish at least one stat profile, ruleset, and team lineup to compile a preview.</p>
          )}
        </section>
      </AppShell>
    )
  }
}

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
      <AppShell identity={identity} title={`Adapter preview · ${league.name} · Starworks`}>
        <header mix={heroStyle}>
          <div>
            <p mix={eyebrowStyle}>Adapter operation bundle</p>
            <h1 mix={headingStyle}>{bundle.operations.length} operations</h1>
            <p mix={ledeStyle}>This is the exact versioned JSON boundary the runner consumes; it contains no raw memory addresses.</p>
          </div>
          <a href={routes.leagues.configuration.dashboard.href({ leagueSlug: league.slug })}>Back to configuration</a>
        </header>
        <pre mix={codeStyle}>{JSON.stringify(bundle, null, 2)}</pre>
      </AppShell>
    )
  }
}

function RevisionCard(handle: Handle<{
  name: string
  revisionHref: (revisionId: string) => string
  revisions: RevisionSummary[]
}>) {
  return () => (
    <article mix={[cardStyle, formStyle]}>
      <h3 mix={cardHeadingStyle}>{handle.props.name}</h3>
      <RevisionList revisions={handle.props.revisions} revisionHref={handle.props.revisionHref} />
    </article>
  )
}

function RevisionList(handle: Handle<{
  revisionHref: (revisionId: string) => string
  revisions: RevisionSummary[]
}>) {
  return () => handle.props.revisions.length ? (
    <ol mix={revisionListStyle}>
      {handle.props.revisions.map((revision) => (
        <li key={revision.id}>
          <a href={handle.props.revisionHref(revision.id)}>Revision {revision.revisionNumber}</a>
          <span mix={revision.status === 'published' ? publishedStyle : draftStyle}>{revision.status}</span>
        </li>
      ))}
    </ol>
  ) : <p mix={emptyStyle}>No revisions yet.</p>
}

function Field(handle: Handle<{ defaultValue: string; label: string; name: string }>) {
  return () => (
    <label mix={fieldStyle}>
      <span>{handle.props.label}</span>
      <input required name={handle.props.name} defaultValue={handle.props.defaultValue} mix={inputStyle} />
    </label>
  )
}

function JsonField(handle: Handle<{ label: string; name: string; value: unknown }>) {
  return () => (
    <label mix={fieldStyle}>
      <span>{handle.props.label}</span>
      <textarea required name={handle.props.name} defaultValue={JSON.stringify(handle.props.value, null, 2)} rows={9} mix={[inputStyle, textareaStyle]} />
    </label>
  )
}

function SelectField(handle: Handle<{ label: string; name: string; options: Array<{ label: string; value: string }> }>) {
  return () => (
    <label mix={fieldStyle}>
      <span>{handle.props.label}</span>
      <select required name={handle.props.name} mix={inputStyle}>
        {handle.props.options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </label>
  )
}

const starterDefinitions = [{
  dataType: 'integer',
  definitionId: '11111111-1111-4111-8111-111111111111',
  display: { group: 'Batting', label: 'Slap power', order: 10 },
  gameplayMapping: {
    adapterId: 'sluggers-rmbe01',
    loadPhase: 'build-time',
    target: { codec: 'u16-be', field: 'character.batting.slapPower', resource: 'dt-na-dat' },
  },
  key: 'batting.slap-power',
  maximum: 200,
  minimum: 0,
  required: true,
  step: 1,
}]
const starterCharacterValues = [{ characterId: 'mario', values: { 'batting.slap-power': 100 } }]
const starterRules = [
  { gameplayTarget: 'rules.innings', key: 'game.innings', label: 'Innings', loadPhase: 'runtime', value: 9 },
  { key: 'draft.timer-seconds', label: 'Draft timer', loadPhase: 'web-only', value: 120 },
]
const starterRoster = ['mario', 'luigi', 'peach', 'daisy', 'yoshi', 'birdo', 'toad', 'toadette', 'bowser']
const starterLineup = {
  battingOrder: starterRoster,
  bench: [],
  captainCharacterId: 'mario',
  fielding: ['P', 'C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF'].map((position, index) => ({ characterId: starterRoster[index], position })),
  pitcherCharacterId: 'mario',
}

const heroStyle = css({ alignItems: 'start', display: 'flex', gap: '32px', justifyContent: 'space-between' })
const eyebrowStyle = css({ color: '#f7c948', fontSize: '12px', fontWeight: 800, letterSpacing: '0.14em', margin: '0 0 10px', textTransform: 'uppercase' })
const headingStyle = css({ fontSize: '52px', letterSpacing: '-0.05em', lineHeight: 1, margin: 0 })
const subheadingStyle = css({ fontSize: '32px', letterSpacing: '-0.04em', margin: 0 })
const ledeStyle = css({ color: '#b9c5dc', lineHeight: 1.6, maxWidth: '720px' })
const sectionStyle = css({ display: 'grid', gap: '20px', marginTop: '64px' })
const sectionHeadingStyle = css({ alignItems: 'end', display: 'flex', justifyContent: 'space-between' })
const countStyle = css({ color: '#9faec8', fontSize: '14px' })
const gridStyle = css({ display: 'grid', gap: '20px', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 330px), 1fr))' })
const formStyle = css({ alignContent: 'start', display: 'grid', gap: '16px' })
const importStyle = css({ alignSelf: 'start' })
const nestedFormStyle = css({ display: 'grid', gap: '14px', marginTop: '16px' })
const previewFormStyle = css({ display: 'grid', gap: '16px', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' })
const fieldStyle = css({ display: 'grid', fontSize: '14px', fontWeight: 700, gap: '7px' })
const textareaStyle = css({ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: '12px', lineHeight: 1.45, resize: 'vertical' })
const cardHeadingStyle = css({ fontSize: '21px', margin: 0 })
const revisionListStyle = css({ display: 'grid', gap: '9px', listStyle: 'none', margin: 0, padding: 0, '& li': { alignItems: 'center', display: 'flex', gap: '10px', justifyContent: 'space-between' } })
const publishedStyle = css({ background: '#163d35', borderRadius: '999px', color: '#8ff0cc', fontSize: '11px', fontWeight: 800, padding: '4px 8px', textTransform: 'uppercase' })
const draftStyle = css({ background: '#443719', borderRadius: '999px', color: '#f7d778', fontSize: '11px', fontWeight: 800, padding: '4px 8px', textTransform: 'uppercase' })
const emptyStyle = css({ color: '#9faec8', margin: 0 })
const codeStyle = css({ background: '#080c15', border: '1px solid #2d3955', borderRadius: '16px', fontSize: '12px', lineHeight: 1.5, marginTop: '40px', overflow: 'auto', padding: '22px' })
