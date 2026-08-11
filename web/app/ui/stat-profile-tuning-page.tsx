import type { SluggersTuning, StatProfileRevision } from '@starworks/contracts'
import type { Handle, RemixNode } from 'remix/ui'
import { css } from 'remix/ui'

import {
  SPEED_CURVE_LABELS,
  STAR_BOOST_LABELS,
  STAR_EVENT_LABELS,
  STAT_EDITOR_TUNING_LABELS,
  STAT_EDITOR_TUNING_SECTIONS,
  TEAM_LABELS,
  TRAJECTORY_CONTACT_LABELS,
  TRAJECTORY_HEIGHT_LABELS,
  TRAJECTORY_SWING_LABELS,
  type StatEditorTuningSection,
} from '../configuration/stat-editor-tuning.ts'
import type { LeagueDetail, SessionIdentity } from '../platform/model.ts'
import { routes } from '../routes.ts'
import { characterHeadshotPath, displayCharacterName } from '../sluggers/characters.ts'
import { AppShell, buttonStyle, cardStyle, inputStyle } from './app-shell.tsx'

interface StatProfileTuningPageProps {
  basedOnTuning: SluggersTuning | null
  identity: SessionIdentity
  league: LeagueDetail
  revision: StatProfileRevision & { sluggersTuning: SluggersTuning }
  section: StatEditorTuningSection
  selectedRow: number
}

export function StatProfileTuningPage(handle: Handle<StatProfileTuningPageProps>) {
  return () => {
    let { basedOnTuning, identity, league, revision, section, selectedRow } = handle.props
    let tuning = revision.sluggersTuning
    let readOnly = revision.status !== 'draft'
    let action = tuningHref(league.slug, revision.revisionId, section)
    return (
      <AppShell identity={identity} league={league} title={`${STAT_EDITOR_TUNING_LABELS[section]} · ${revision.name} · Starworks`}>
        <header mix={pageHeaderStyle}>
          <div>
            <h1>{STAT_EDITOR_TUNING_LABELS[section]}</h1>
            <p>{revision.name} · Revision {revision.revisionNumber}</p>
          </div>
          <a href={profileHref(league.slug, revision.revisionId)}>Back to profile</a>
        </header>
        <nav aria-label="Stat profile sections" mix={sectionNavStyle}>
          {STAT_EDITOR_TUNING_SECTIONS.map((item) => (
            <a href={tuningHref(league.slug, revision.revisionId, item)} aria-current={item === section ? 'page' : undefined}>
              {STAT_EDITOR_TUNING_LABELS[item]}
            </a>
          ))}
        </nav>
        {readOnly ? (
          <p mix={readOnlyStyle}>This revision is published and locked. Clone it to change these values.</p>
        ) : null}
        <TuningSection
          action={action}
          basedOnTuning={basedOnTuning}
          readOnly={readOnly}
          section={section}
          selectedRow={selectedRow}
          tuning={tuning}
        />
      </AppShell>
    )
  }
}

function TuningSection(handle: Handle<{
  action: string
  basedOnTuning: SluggersTuning | null
  readOnly: boolean
  section: StatEditorTuningSection
  selectedRow: number
  tuning: SluggersTuning
}>) {
  return () => {
    let { action, basedOnTuning, readOnly, section, selectedRow, tuning } = handle.props
    switch (section) {
      case 'chemistry':
        return <ChemistryEditor action={action} previousTuning={basedOnTuning} readOnly={readOnly} row={selectedRow} tuning={tuning} />
      case 'trajectories':
        return <TrajectoryEditor action={action} previousTuning={basedOnTuning} readOnly={readOnly} row={selectedRow} tuning={tuning} />
      case 'speed-curves':
        return <SpeedCurveEditor action={action} previousTuning={basedOnTuning} readOnly={readOnly} tuning={tuning} />
      case 'star-events':
        return <StarEventEditor action={action} previousTuning={basedOnTuning} readOnly={readOnly} row={selectedRow} tuning={tuning} />
      case 'star-boosts':
        return <StarBoostEditor action={action} previousTuning={basedOnTuning} readOnly={readOnly} tuning={tuning} />
      case 'handicaps':
        return <HandicapEditor action={action} previousTuning={basedOnTuning} readOnly={readOnly} tuning={tuning} />
    }
  }
}

function ChemistryEditor(handle: Handle<EditorProps & { row: number }>) {
  return () => {
    let { action, previousTuning, readOnly, row, tuning } = handle.props
    let characterId = tuning.characterIdsByIndex[row]!
    return (
      <EditorSection
        description="Set this character's chemistry toward every other roster slot using the game's Bad, Neutral, and Good relationships."
        heading={displayCharacterName(characterId)}
        selector={<RowSelector action={action} labels={tuning.characterIdsByIndex.map(displayCharacterName)} row={row} />}
      >
        <form action={action} method="post" mix={editorFormStyle}>
          <input type="hidden" name="row" value={row} />
          <div mix={chemistryGridStyle}>
            {tuning.characterIdsByIndex.map((partnerId, column) => (
              <label mix={[cardStyle, chemistryFieldStyle]}>
                <img src={characterHeadshotPath(partnerId)} alt="" />
                <span>{displayCharacterName(partnerId)}</span>
                <span mix={comparedInputStyle}>
                  <select name={`value.${column}`} disabled={readOnly} mix={compactInputStyle}>
                    <option value="0" selected={tuning.chemistry[row]![column] === 0}>Bad</option>
                    <option value="1" selected={tuning.chemistry[row]![column] === 1}>Neutral</option>
                    <option value="2" selected={tuning.chemistry[row]![column] === 2}>Good</option>
                  </select>
                  {changedNumber(tuning.chemistry[row]![column]!, previousTuning?.chemistry[row]?.[column])}
                </span>
              </label>
            ))}
          </div>
          <SaveButton readOnly={readOnly} />
        </form>
      </EditorSection>
    )
  }
}

function TrajectoryEditor(handle: Handle<EditorProps & { row: number }>) {
  return () => {
    let { action, previousTuning, readOnly, row, tuning } = handle.props
    return (
      <EditorSection
        description="Edit the four contact distributions in one named trajectory group. Each row retains the exact 25-value game table."
        heading={tuning.trajectoryNames[row]!}
        selector={<RowSelector action={action} labels={tuning.trajectoryNames} row={row} />}
      >
        <form action={action} method="post" mix={editorFormStyle}>
          <input type="hidden" name="row" value={row} />
          <div mix={metadataGridStyle}>
            <label mix={fieldStyle}><span>Group name</span><input name="name" defaultValue={tuning.trajectoryNames[row]} disabled={readOnly} required mix={inputStyle} />{changedText(tuning.trajectoryNames[row]!, previousTuning?.trajectoryNames[row])}</label>
            <label mix={fieldStyle}>
              <span>Used by the game</span>
              <select name="activation" disabled={readOnly} mix={inputStyle}>
                <option value="1" selected={tuning.trajectoryActivation[row] === 1}>Active</option>
                <option value="0" selected={tuning.trajectoryActivation[row] === 0}>Inactive</option>
              </select>
              {changedNumber(tuning.trajectoryActivation[row]!, previousTuning?.trajectoryActivation[row])}
            </label>
          </div>
          {TRAJECTORY_SWING_LABELS.map((label, swing) => (
            <NumericTable
              columnLabels={TRAJECTORY_CONTACT_LABELS}
              disabled={readOnly}
              heading={label}
              maximum={100}
              minimum={0}
              name={(height, contact) => `value.${swing}.${contact * 5 + height}`}
              previousValues={previousTuning ? Array.from({ length: 5 }, (_, height) =>
                Array.from({ length: 5 }, (_, contact) => previousTuning.trajectoryTables[row * 4 + swing]![contact * 5 + height]!)) : null}
              rowLabels={TRAJECTORY_HEIGHT_LABELS}
              values={Array.from({ length: 5 }, (_, height) =>
                Array.from({ length: 5 }, (_, contact) => tuning.trajectoryTables[row * 4 + swing]![contact * 5 + height]!))}
            />
          ))}
          <SaveButton readOnly={readOnly} />
        </form>
      </EditorSection>
    )
  }
}

function SpeedCurveEditor(handle: Handle<EditorProps>) {
  return () => {
    let { action, previousTuning, readOnly, tuning } = handle.props
    return (
      <EditorSection description="Map each of the game's 43 speed levels to its real baserunning and fielding movement values." heading="Real speed curves">
        <form action={action} method="post" mix={editorFormStyle}>
          <NumericTable
            columnLabels={SPEED_CURVE_LABELS}
            disabled={readOnly}
            heading="Speed levels"
            name={(row, column) => `value.${row}.${column}`}
            previousValues={previousTuning?.globalSpeedCurves ?? null}
            rowLabels={Array.from({ length: 43 }, (_, row) => `Level ${row + 1}`)}
            values={tuning.globalSpeedCurves}
          />
          <SaveButton readOnly={readOnly} />
        </form>
      </EditorSection>
    )
  }
}

function StarEventEditor(handle: Handle<EditorProps & { row: number }>) {
  return () => {
    let { action, previousTuning, readOnly, row, tuning } = handle.props
    return (
      <EditorSection
        description="Set how many team stars this club gains or loses for each observed game event. Unknown slots stay explicit."
        heading={TEAM_LABELS[row]!}
        selector={<RowSelector action={action} labels={TEAM_LABELS} row={row} />}
      >
        <form action={action} method="post" mix={editorFormStyle}>
          <input type="hidden" name="row" value={row} />
          <div mix={valueGridStyle}>
            {STAR_EVENT_LABELS.map((label, column) => (
              <label mix={[cardStyle, valueFieldStyle]}><span>{label}</span><NumberInput disabled={readOnly} maximum={32767} minimum={-32768} name={`value.${column}`} previousValue={previousTuning?.teamStarEvents[row]?.[column]} step={1} value={tuning.teamStarEvents[row]![column]!} /></label>
            ))}
          </div>
          <SaveButton readOnly={readOnly} />
        </form>
      </EditorSection>
    )
  }
}

function StarBoostEditor(handle: Handle<EditorProps>) {
  return () => {
    let { action, previousTuning, readOnly, tuning } = handle.props
    return (
      <EditorSection description="Control how star actions add to or multiply each affected stat, including its clamp range." heading="Star boosts">
        <form action={action} method="post" mix={editorFormStyle}>
          <div mix={tableScrollerStyle}>
            <table mix={tableStyle}>
              <thead><tr><th>Stat</th><th>Operation</th><th>Boost</th><th>Minimum</th><th>Maximum</th></tr></thead>
              <tbody>{tuning.starBoosts.map((values, row) => (
                <tr>
                  <th>{STAR_BOOST_LABELS[row]}</th>
                  <td><select name={`value.${row}.0`} disabled={readOnly} mix={compactInputStyle}><option value="1" selected={values[0] === 1}>Add</option><option value="2" selected={values[0] === 2}>Multiply</option></select>{changedNumber(values[0]!, previousTuning?.starBoosts[row]?.[0])}</td>
                  {values.slice(1).map((value, column) => <td><NumberInput disabled={readOnly} maximum={column > 0 ? 65535 : undefined} minimum={column > 0 ? 0 : undefined} name={`value.${row}.${column + 1}`} previousValue={previousTuning?.starBoosts[row]?.[column + 1]} step={column > 0 ? 1 : undefined} value={value} /></td>)}
                </tr>
              ))}</tbody>
            </table>
          </div>
          <SaveButton readOnly={readOnly} />
        </form>
      </EditorSection>
    )
  }
}

function HandicapEditor(handle: Handle<EditorProps>) {
  return () => {
    let { action, previousTuning, readOnly, tuning } = handle.props
    return (
      <EditorSection description="Tune star-gain catch-up behavior. The small derived parameter table remains visible instead of being silently regenerated." heading="Star handicaps">
        <form action={action} method="post" mix={editorFormStyle}>
          <NumericTable
            columnLabels={['Score lead', 'Star gain multiplier']}
            disabled={readOnly}
            heading="Handicap tiers"
            name={(row, column) => `value.${row}.${column}`}
            previousValues={previousTuning?.starHandicaps ?? null}
            rowLabels={['Tier 1', 'Tier 2', 'Tier 3', 'Tier 4']}
            values={tuning.starHandicaps}
          />
          <NumericTable
            columnLabels={['Threshold count', 'Byte span', 'Index span']}
            disabled={readOnly}
            heading="Derived parameters"
            maximum={255}
            minimum={0}
            name={(row, column) => `parameter.${row}.${column}`}
            previousValues={previousTuning?.handicapParameters ?? null}
            rowLabels={['Positive leads', 'Negative leads']}
            values={tuning.handicapParameters}
          />
          <SaveButton readOnly={readOnly} />
        </form>
      </EditorSection>
    )
  }
}

interface EditorProps {
  action: string
  previousTuning: SluggersTuning | null
  readOnly: boolean
  tuning: SluggersTuning
}

function EditorSection(handle: Handle<{ children?: RemixNode; description: string; heading: string; selector?: RemixNode }>) {
  return () => (
    <main aria-labelledby="editor-heading" mix={editorStyle}>
      <header mix={editorHeadingStyle}>
        <div><h2 id="editor-heading">{handle.props.heading}</h2><p>{handle.props.description}</p></div>
        {handle.props.selector}
      </header>
      {handle.props.children}
    </main>
  )
}

function RowSelector(handle: Handle<{ action: string; labels: readonly string[]; row: number }>) {
  return () => (
    <form action={handle.props.action} method="get" mix={selectorStyle}>
      <label><span>Editing</span><select name="row" mix={inputStyle}>{handle.props.labels.map((label, row) => <option value={row} selected={row === handle.props.row}>{label}</option>)}</select></label>
      <button type="submit" mix={buttonStyle}>Open</button>
    </form>
  )
}

function NumericTable(handle: Handle<{
  columnLabels: readonly string[]
  disabled: boolean
  heading: string
  maximum?: number
  minimum?: number
  name: (row: number, column: number) => string
  previousValues: number[][] | null
  rowLabels: readonly string[]
  values: number[][]
}>) {
  return () => (
    <section mix={[cardStyle, tableCardStyle]}>
      <h3>{handle.props.heading}</h3>
      <div mix={tableScrollerStyle}>
        <table mix={tableStyle}>
          <thead><tr><th>Level</th>{handle.props.columnLabels.map((label) => <th>{label}</th>)}</tr></thead>
          <tbody>{handle.props.values.map((row, rowIndex) => (
            <tr><th>{handle.props.rowLabels[rowIndex]}</th>{row.map((value, column) => <td><NumberInput disabled={handle.props.disabled} maximum={handle.props.maximum} minimum={handle.props.minimum} name={handle.props.name(rowIndex, column)} previousValue={handle.props.previousValues?.[rowIndex]?.[column]} step={handle.props.maximum === 100 || handle.props.maximum === 255 ? 1 : undefined} value={value} /></td>)}</tr>
          ))}</tbody>
        </table>
      </div>
    </section>
  )
}

function NumberInput(handle: Handle<{ disabled: boolean; maximum?: number; minimum?: number; name: string; previousValue?: number; step?: number; value: number }>) {
  return () => (
    <span mix={comparedInputStyle}>
      <input type="number" step={handle.props.step ?? 'any'} min={handle.props.minimum} max={handle.props.maximum} name={handle.props.name} defaultValue={String(handle.props.value)} disabled={handle.props.disabled} required mix={compactInputStyle} />
      {changedNumber(handle.props.value, handle.props.previousValue)}
    </span>
  )
}

function SaveButton(handle: Handle<{ readOnly: boolean }>) {
  return () => handle.props.readOnly ? null : <button type="submit" mix={buttonStyle}>Save section</button>
}

function changedNumber(value: number, previousValue: number | undefined): RemixNode {
  return previousValue !== undefined && value !== previousValue ? <small mix={previousValueStyle}>was {previousValue}</small> : null
}

function changedText(value: string, previousValue: string | undefined): RemixNode {
  return previousValue !== undefined && value !== previousValue ? <small mix={previousValueStyle}>was {previousValue}</small> : null
}

function profileHref(leagueSlug: string, revisionId: string): string {
  return routes.leagues.configuration.statProfiles.revision.show.href({ leagueSlug, revisionId })
}

function tuningHref(leagueSlug: string, revisionId: string, section: StatEditorTuningSection): string {
  return routes.leagues.configuration.statProfiles.revision.tuning.edit.href({ leagueSlug, revisionId, section })
}

const pageHeaderStyle = css({ alignItems: 'end', display: 'flex', flexWrap: 'wrap', gap: '20px', justifyContent: 'space-between', '& h1': { fontFamily: 'var(--font-happiness)', fontSize: 'clamp(36px, 6vw, 54px)', lineHeight: 1, margin: 0 }, '& p': { color: 'var(--text-muted)', margin: '8px 0 0' } })
const sectionNavStyle = css({ display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '28px', '& a': { border: '1px solid var(--border)', borderRadius: '999px', color: 'var(--text-primary) !important', padding: '8px 13px', textDecoration: 'none' }, '& a[aria-current="page"]': { background: 'var(--surface-strong)', borderColor: 'var(--border-strong)' } })
const readOnlyStyle = css({ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '12px', color: 'var(--text-muted)', margin: '22px 0 0', padding: '13px 16px' })
const editorStyle = css({ display: 'grid', gap: '22px', marginTop: '34px' })
const editorHeadingStyle = css({ alignItems: 'end', display: 'flex', flexWrap: 'wrap', gap: '20px', justifyContent: 'space-between', '& h2': { fontSize: '30px', margin: 0 }, '& p': { color: 'var(--text-muted)', margin: '7px 0 0', maxWidth: '680px' } })
const editorFormStyle = css({ display: 'grid', gap: '20px' })
const selectorStyle = css({ alignItems: 'end', display: 'flex', gap: '9px', '& label': { display: 'grid', fontSize: '13px', fontWeight: 700, gap: '5px', minWidth: '220px' } })
const chemistryGridStyle = css({ display: 'grid', gap: '10px', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))' })
const chemistryFieldStyle = css({ alignItems: 'center', display: 'grid', gap: '9px', gridTemplateColumns: '42px minmax(0, 1fr) 70px', padding: '9px', '& img': { height: '42px', objectFit: 'contain', width: '42px' }, '& span': { fontSize: '13px', fontWeight: 700 } })
const metadataGridStyle = css({ display: 'grid', gap: '14px', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' })
const fieldStyle = css({ display: 'grid', fontSize: '13px', fontWeight: 700, gap: '6px' })
const valueGridStyle = css({ display: 'grid', gap: '10px', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))' })
const valueFieldStyle = css({ display: 'grid', gap: '8px', padding: '12px', '& span': { fontSize: '13px', fontWeight: 700 } })
const tableCardStyle = css({ display: 'grid', gap: '14px', '& h3': { margin: 0 } })
const tableScrollerStyle = css({ overflowX: 'auto' })
const tableStyle = css({ borderCollapse: 'collapse', minWidth: '620px', width: '100%', '& th': { color: 'var(--text-muted)', fontSize: '12px', textAlign: 'left' }, '& td, & th': { borderBottom: '1px solid var(--border)', padding: '7px' }, '& tbody th': { color: 'var(--text-primary)', fontWeight: 700, minWidth: '130px' } })
const compactInputStyle = css({ background: 'var(--surface-strong)', border: '1px solid var(--border)', borderRadius: '8px', color: 'var(--text-primary)', font: 'inherit', maxWidth: '110px', minWidth: '72px', padding: '7px 8px', width: '100%', '&:focus': { borderColor: 'var(--border-strong)', outline: 'none' }, '&:disabled': { opacity: .72 } })
const comparedInputStyle = css({ display: 'grid', gap: '3px' })
const previousValueStyle = css({ color: 'var(--warning-text)', fontSize: '10px', fontWeight: 700 })
