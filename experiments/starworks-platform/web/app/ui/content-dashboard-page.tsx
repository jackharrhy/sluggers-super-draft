import type { Handle } from 'remix/ui'
import { css } from 'remix/ui'

import type { ContentDashboard } from '../content/service.ts'
import type { LeagueDetail, SessionIdentity } from '../platform/model.ts'
import { routes } from '../routes.ts'
import { SLUGGERS_ADAPTER_VERSION } from '../runner/adapter-version.ts'
import { AppShell, buttonStyle, cardStyle, inputStyle } from './app-shell.tsx'
import { secondaryButtonStyle } from './design-system.ts'

export function ContentDashboardPage(
  handle: Handle<{
    dashboard: ContentDashboard
    identity: SessionIdentity
    league: LeagueDetail
  }>,
) {
  return () => {
    let { dashboard, identity, league } = handle.props
    let canCreate = dashboard.publishedStatProfiles.length && dashboard.publishedRulesets.length
    return <AppShell identity={identity} league={league} title={`Content packs · ${league.name} · Starworks`}>
      <header mix={heroStyle}>
        <h1 mix={headingStyle}>{league.name} content</h1>
        <p mix={ledeStyle}>Publish hash-only manifests and user-created source images. Patched game builds remain private to each runner.</p>
        <nav mix={navStyle} aria-label="League workspaces">
          <a href={routes.leagues.show.href({ leagueSlug: league.slug })}>League home</a>
          <a href={routes.leagues.configuration.dashboard.href({ leagueSlug: league.slug })}>Configuration</a>
          <a href={routes.leagues.operations.matches.index.href({ leagueSlug: league.slug })}>Matches</a>
        </nav>
      </header>

      <section mix={twoColumnStyle} aria-label="Create content inputs">
        <form action={routes.leagues.content.create.href({ leagueSlug: league.slug })} method="post" mix={[cardStyle, formStyle]}>
          <h2>New content-pack draft</h2>
          {canCreate ? <>
            <Field label="Name" name="name" defaultValue="League balance pack" />
            <Field label="Slug" name="slug" defaultValue="league-balance-pack" />
            <Select label="Published stat profile" name="statProfileRevisionId" options={dashboard.publishedStatProfiles.map((item) => ({ label: `${item.name} · r${item.revisionNumber}`, value: item.id }))} />
            <Select label="Published ruleset" name="rulesetRevisionId" options={dashboard.publishedRulesets.map((item) => ({ label: `${item.name} · r${item.revisionNumber}`, value: item.id }))} />
            <Field label="Adapter version" name="adapterVersion" defaultValue={SLUGGERS_ADAPTER_VERSION} />
            <Field label="Supported clean main.dol SHA-256" name="mainDolSha256" defaultValue="" />
            <label>Characters receiving build-time stats<textarea name="statCharacterIds" rows={5} placeholder={'mario\nluigi'} mix={inputStyle} /></label>
            <button type="submit" mix={buttonStyle}>Create immutable draft</button>
          </> : <p mix={emptyStyle}>Publish a stat profile and ruleset before creating content.</p>}
        </form>
        <form action={routes.leagues.content.uploadAsset.href({ leagueSlug: league.slug })} method="post" encType="multipart/form-data" mix={[cardStyle, formStyle]}>
          <h2>Upload source art</h2>
          <p mix={mutedStyle}>PNG or WebP, up to 2 MiB. Original game buffers, models, textures, and executable patches are refused.</p>
          <label>Source image<input type="file" name="asset" accept="image/png,image/webp" required mix={inputStyle} /></label>
          <button type="submit" mix={buttonStyle}>Store in Garage</button>
        </form>
      </section>

      <section mix={sectionStyle} aria-labelledby="packs-heading">
        <div mix={sectionHeadingStyle}><h2 id="packs-heading">Content packs</h2><span>{dashboard.packs.length} packs</span></div>
        <div mix={packGridStyle}>
          {dashboard.packs.map((pack) => <article mix={cardStyle}>
            <h3>{pack.name}</h3><code>{pack.slug}</code>
            <div mix={revisionListStyle}>{pack.revisions.map((revision) => <section mix={revisionStyle}>
              <div mix={revisionHeadingStyle}><strong>Revision {revision.revisionNumber}</strong><span>{revision.status}</span></div>
              <small mix={mutedStyle}>Adapter {revision.adapterVersion} · {revision.statCharacterIds.length} stat assignments · {revision.assignments.length} assets</small>
              {revision.manifestSha256 ? <code mix={digestStyle}>{revision.manifestSha256}</code> : null}
              {revision.assignments.map((assignment) => <small><code>{assignment.characterId}</code> {assignment.slot} · {assignment.assetSha256.slice(0, 12)}…</small>)}
              {revision.status === 'draft' ? <>
                {dashboard.assets.length ? <form action={routes.leagues.content.assignAsset.href({ leagueSlug: league.slug, revisionId: revision.id })} method="post" mix={assignmentFormStyle}>
                  <Field label="Character ID" name="characterId" defaultValue="mario" />
                  <Select label="Slot" name="slot" options={[{ label: 'Icon', value: 'icon' }, { label: 'Portrait', value: 'portrait' }]} />
                  <Select label="Source asset" name="assetSha256" options={dashboard.assets.map((asset) => ({ label: `${asset.displayName} · ${asset.sha256.slice(0, 10)}…`, value: asset.sha256 }))} />
                  <button type="submit" mix={secondaryButtonStyle}>Assign art</button>
                </form> : <p mix={mutedStyle}>Upload source art to add an icon or portrait.</p>}
                <form action={routes.leagues.content.publish.href({ leagueSlug: league.slug, revisionId: revision.id })} method="post"><button type="submit" mix={buttonStyle}>Publish and lock manifest</button></form>
              </> : <form action={routes.leagues.content.clone.href({ leagueSlug: league.slug, revisionId: revision.id })} method="post"><button type="submit" mix={secondaryButtonStyle}>Clone next revision</button></form>}
            </section>)}</div>
          </article>)}
          {!dashboard.packs.length ? <p mix={emptyStyle}>No content packs have been created.</p> : null}
        </div>
      </section>

      <section mix={sectionStyle} aria-labelledby="assets-heading">
        <div mix={sectionHeadingStyle}><h2 id="assets-heading">Allowed source assets</h2><span>{dashboard.assets.length} assets</span></div>
        <div mix={assetGridStyle}>{dashboard.assets.map((asset) => <article mix={cardStyle}><strong>{asset.displayName}</strong><small>{asset.mediaType} · {asset.sizeBytes.toLocaleString()} bytes</small><code mix={digestStyle}>{asset.sha256}</code></article>)}</div>
      </section>
    </AppShell>
  }
}

function Field(handle: Handle<{ defaultValue: string; label: string; name: string }>) {
  return () => <label>{handle.props.label}<input name={handle.props.name} defaultValue={handle.props.defaultValue} required mix={inputStyle} /></label>
}

function Select(handle: Handle<{ label: string; name: string; options: Array<{ label: string; value: string }> }>) {
  return () => <label>{handle.props.label}<select name={handle.props.name} required mix={inputStyle}>{handle.props.options.map((option) => <option value={option.value}>{option.label}</option>)}</select></label>
}

const heroStyle = css({ display: 'grid', gap: '18px' })
const headingStyle = css({ fontFamily: 'var(--font-display)', fontSize: 'clamp(34px, 5vw, 48px)', lineHeight: 1.08, margin: 0 })
const ledeStyle = css({ color: 'var(--text-soft)', fontSize: '18px', lineHeight: 1.6, maxWidth: '760px' })
const navStyle = css({ display: 'flex', flexWrap: 'wrap', gap: '18px' })
const twoColumnStyle = css({ display: 'grid', gap: '24px', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 360px), 1fr))', marginTop: '40px' })
const formStyle = css({ display: 'grid', gap: '14px', '& label': { display: 'grid', gap: '7px', fontWeight: 700 } })
const mutedStyle = css({ color: 'var(--text-muted)', lineHeight: 1.5 })
const emptyStyle = css({ border: '1px dashed var(--border-strong)', borderRadius: '14px', color: 'var(--text-muted)', padding: '22px' })
const sectionStyle = css({ marginTop: '56px' })
const sectionHeadingStyle = css({ alignItems: 'end', display: 'flex', gap: '20px', justifyContent: 'space-between', marginBottom: '18px', '& h2': { fontSize: '36px', margin: 0 } })
const packGridStyle = css({ display: 'grid', gap: '20px', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 440px), 1fr))' })
const revisionListStyle = css({ display: 'grid', gap: '16px', marginTop: '18px' })
const revisionStyle = css({ background: 'var(--surface-deep)', borderRadius: '12px', display: 'grid', gap: '12px', padding: '16px' })
const revisionHeadingStyle = css({ alignItems: 'center', display: 'flex', justifyContent: 'space-between', '& span': { color: 'var(--text-muted)', fontSize: '11px', fontWeight: 900, textTransform: 'uppercase' } })
const digestStyle = css({ display: 'block', fontSize: '11px', overflowWrap: 'anywhere' })
const assignmentFormStyle = css({ display: 'grid', gap: '10px', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 160px), 1fr))', '& label': { display: 'grid', gap: '5px' } })
const assetGridStyle = css({ display: 'grid', gap: '14px', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 280px), 1fr))', '& article': { display: 'grid', gap: '8px' } })
