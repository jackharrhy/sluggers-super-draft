import type { Handle, RemixNode } from 'remix/ui'
import { css } from 'remix/ui'

import { AppShell } from './app-shell.tsx'
import {
  cardStyle,
  checkboxStyle,
  dangerButtonStyle,
  dangerNoticeStyle,
  emptyStateStyle,
  fieldStyle,
  inputStyle,
  mutedTextStyle,
  noticeStyle,
  positiveButtonStyle,
  primaryButtonStyle,
  secondaryButtonStyle,
  sectionHeadingStyle,
  successNoticeStyle,
  tableScrollerStyle,
  tableStyle,
  warningNoticeStyle,
} from './design-system.ts'
import { CharacterBadge } from './league-operations/character-badge.tsx'
import { LineupPattern, MatchDayPattern, TradeComposerPattern } from './game-patterns.tsx'

export function DevKitchenSinkPage() {
  return () => (
    <AppShell title="Kitchen sink · Starworks">
      <header mix={heroStyle}>
        <h1>Starworks kitchen sink</h1>
        <nav aria-label="Kitchen sink sections" mix={jumpNavStyle}>
          <a href="#type">Type</a>
          <a href="#color">Color</a>
          <a href="#actions">Actions</a>
          <a href="#forms">Forms</a>
          <a href="#feedback">Feedback</a>
          <a href="#data">Data</a>
          <a href="#patterns">Patterns</a>
        </nav>
      </header>

      <KitchenSection id="type" title="Typography">
        <div mix={typeGridStyle}>
          <TypeSample label="Display · NewRodin" family="display">Mushroom League</TypeSample>
          <TypeSample label="Body · NewCezanne" family="sans">Mario Fireballs host Wario Muscles tonight.</TypeSample>
          <TypeSample label="Brand · PopHappiness" family="happiness">Starworks</TypeSample>
          <TypeSample label="Action · ITC Bolt" family="bolt">Start the match</TypeSample>
          <TypeSample label="Accent · Aurea" family="aurea">Summer Pennant Series</TypeSample>
        </div>
        <div mix={headingStackStyle}>
          <h1>Page heading</h1><h2>Section heading</h2><h3>Card heading</h3>
          <p>Body copy should remain the calmest voice on the page. It carries instructions, descriptions, and ordinary league information.</p>
          <p mix={mutedTextStyle}>Muted text supports the main content without competing with it.</p>
        </div>
      </KitchenSection>

      <KitchenSection id="color" title="Color and surfaces">
        <div mix={paletteListStyle}>
          <PaletteRamp family="sluggers-red" label="Sluggers red" />
          <PaletteRamp family="mario-blue" label="Mario blue" />
          <PaletteRamp family="luigi-green" label="Luigi green" />
          <PaletteRamp family="daisy-yellow" label="Daisy yellow" />
          <PaletteRamp family="baseball" label="Baseball neutral" />
        </div>
        <div mix={cardGridStyle}>
          <article mix={cardStyle}><h3>Standard card</h3><p mix={mutedTextStyle}>The default container for a focused piece of content or one related action.</p></article>
          <article mix={[cardStyle, insetCardStyle]}><h3>Card with inset</h3><div><strong>Attempt 1</strong><span>Waiting for station</span></div></article>
        </div>
      </KitchenSection>

      <KitchenSection id="actions" title="Actions">
        <div mix={buttonRowStyle}>
          <button type="button" mix={primaryButtonStyle}>General action</button>
          <button type="button" mix={positiveButtonStyle}>Positive action</button>
          <button type="button" mix={secondaryButtonStyle}>Secondary action</button>
          <button type="button" mix={dangerButtonStyle}>Destructive action</button>
          <button type="button" disabled mix={primaryButtonStyle}>Disabled action</button>
          <a href="#actions">Ordinary text link</a>
        </div>
      </KitchenSection>

      <KitchenSection id="forms" title="Form controls">
        <form mix={[cardStyle, formStyle]}>
          <label mix={fieldStyle}>Team name<input mix={inputStyle} value="Mario Fireballs" readOnly /></label>
          <label mix={fieldStyle}>Home stadium<select mix={inputStyle}><option>Mario Stadium</option><option>Bowser Castle</option></select></label>
          <label mix={[fieldStyle, wideStyle]}>Commissioner note<textarea mix={inputStyle} rows={3} defaultValue="This match decides the pennant." /><small>Visible to both managers before the game.</small></label>
          <label mix={checkboxStyle}><input type="checkbox" defaultChecked /><span>Allow star skills</span></label>
          <label mix={fieldStyle}>Unavailable setting<input mix={inputStyle} value="Managed by league rules" disabled /></label>
          <div mix={[buttonRowStyle, wideStyle]}><button type="button" mix={primaryButtonStyle}>Save changes</button><button type="reset" mix={secondaryButtonStyle}>Reset</button></div>
        </form>
      </KitchenSection>

      <KitchenSection id="feedback" title="Feedback and empty states">
        <div mix={feedbackStackStyle}>
          <p mix={noticeStyle}><strong>Information.</strong> The runner will claim this match at its scheduled time.</p>
          <p mix={successNoticeStyle}><strong>Ready.</strong> The station passed all prerequisite checks.</p>
          <p mix={warningNoticeStyle}><strong>Review needed.</strong> One telemetry sequence arrived late.</p>
          <p mix={dangerNoticeStyle}><strong>Could not start.</strong> Dolphin exited before the bridge attached.</p>
          <p mix={emptyStateStyle}>No matches are waiting to run.</p>
        </div>
      </KitchenSection>

      <KitchenSection id="data" title="People and data">
        <div mix={characterRowStyle}>
          <CharacterBadge characterId="mario" />
          <CharacterBadge characterId="peach" />
          <CharacterBadge characterId="yoshi" />
          <CharacterBadge characterId="wario" />
          <CharacterBadge characterId="bowser-jr" />
        </div>
        <div mix={[cardStyle, compactTableCardStyle, tableScrollerStyle]}>
          <table mix={tableStyle}>
            <thead><tr><th>#</th><th>Team</th><th>W</th><th>L</th><th>Run diff.</th><th>Status</th></tr></thead>
            <tbody>
              <tr><td>1</td><td><strong>Mario Fireballs</strong></td><td>6</td><td>1</td><td mix={positiveValueStyle}>+18</td><td mix={statusTextStyle}>Clinched</td></tr>
              <tr><td>2</td><td><strong>Wario Muscles</strong></td><td>4</td><td>3</td><td mix={positiveValueStyle}>+2</td><td mix={statusTextStyle}>Active</td></tr>
              <tr><td>3</td><td><strong>Yoshi Eggs</strong></td><td>2</td><td>5</td><td mix={negativeValueStyle}>−9</td><td mix={statusTextStyle}>Eliminated</td></tr>
            </tbody>
          </table>
        </div>
        <details mix={[cardStyle, detailsStyle]}><summary>Advanced match configuration</summary><p mix={mutedTextStyle}>Progressive disclosure keeps uncommon controls available without turning every page into an operations console.</p></details>
      </KitchenSection>

      <KitchenSection id="patterns" title="League patterns">
        <div mix={patternGridStyle}>
          <TradeComposerPattern />
          <LineupPattern />
        </div>
        <MatchDayPattern />
      </KitchenSection>
    </AppShell>
  )
}

function KitchenSection(handle: Handle<{ children?: RemixNode; id: string; title: string }>) {
  return () => <section id={handle.props.id} mix={sectionStyle} aria-labelledby={`${handle.props.id}-heading`}>
    <div mix={sectionHeadingStyle}><h2 id={`${handle.props.id}-heading`}>{handle.props.title}</h2></div>
    <div mix={sectionContentStyle}>{handle.props.children}</div>
  </section>
}

function TypeSample(handle: Handle<{ children?: RemixNode; family: 'aurea' | 'bolt' | 'display' | 'happiness' | 'sans'; label: string }>) {
  return () => <article mix={cardStyle}><small mix={sampleLabelStyle}>{handle.props.label}</small><p data-family={handle.props.family} mix={typeSampleStyle}>{handle.props.children}</p></article>
}

type PaletteFamily = 'baseball' | 'daisy-yellow' | 'luigi-green' | 'mario-blue' | 'sluggers-red'

function PaletteRamp(handle: Handle<{ family: PaletteFamily; label: string }>) {
  return () => <div mix={paletteRampStyle}>
    <div mix={paletteLabelStyle}><strong>{handle.props.label}</strong><small>{`--${handle.props.family}-500`}</small></div>
    <div mix={paletteScaleScrollerStyle}>
      <div mix={paletteScaleStyle}>
        {paletteSteps.map((step) => <div key={step} mix={paletteStopStyle}>
          <span aria-hidden="true" style={{ background: `var(--${handle.props.family}-${step})` }}></span>
          <small>{step}</small>
        </div>)}
      </div>
    </div>
  </div>
}

const paletteSteps = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950] as const

const heroStyle = css({ maxWidth: '820px', '& h1': { fontSize: 'clamp(42px, 7vw, 72px)', lineHeight: 0.98, margin: 0 } })
const jumpNavStyle = css({ display: 'flex', flexWrap: 'wrap', gap: '10px 20px', marginTop: '24px' })
const sectionStyle = css({ marginTop: '64px', scrollMarginTop: '20px' })
const sectionContentStyle = css({ display: 'grid', gap: '20px' })
const typeGridStyle = css({ display: 'grid', gap: '14px', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 260px), 1fr))' })
const sampleLabelStyle = css({ color: 'var(--text-muted)', textTransform: 'uppercase' })
const typeSampleStyle = css({ fontSize: '22px', lineHeight: 1.25, margin: '14px 0 0', '&[data-family="display"]': { fontFamily: 'var(--font-display)' }, '&[data-family="sans"]': { fontFamily: 'var(--font-sans)' }, '&[data-family="happiness"]': { fontFamily: 'var(--font-happiness)' }, '&[data-family="bolt"]': { fontFamily: 'var(--font-bolt)' }, '&[data-family="aurea"]': { fontFamily: 'var(--font-aurea)' } })
const headingStackStyle = css({ '& h1': { fontSize: '46px', margin: '0 0 20px' }, '& h2': { fontSize: '30px', margin: '0 0 16px' }, '& h3': { fontSize: '22px', margin: '0 0 14px' }, '& p': { maxWidth: '720px' } })
const paletteListStyle = css({ display: 'grid', gap: '20px' })
const paletteRampStyle = css({ display: 'grid', gap: '7px' })
const paletteLabelStyle = css({ alignItems: 'baseline', display: 'flex', gap: '10px', justifyContent: 'space-between', '& small': { color: 'var(--text-muted)' } })
const paletteScaleScrollerStyle = css({ overflowX: 'auto', paddingBottom: '3px' })
const paletteScaleStyle = css({ display: 'grid', gridTemplateColumns: 'repeat(11, minmax(48px, 1fr))', minWidth: '600px' })
const paletteStopStyle = css({ display: 'grid', gap: '4px', textAlign: 'center', '& > span': { height: '56px' }, '&:first-child > span': { borderRadius: '6px 0 0 6px' }, '&:last-child > span': { borderRadius: '0 6px 6px 0' }, '& small': { color: 'var(--text-muted)', fontSize: '10px' } })
const cardGridStyle = css({ display: 'grid', gap: '18px', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 300px), 1fr))', '& h3': { marginTop: 0 } })
const insetCardStyle = css({ '& > div': { background: 'var(--paper-soft)', border: '1px solid var(--paper-border)', borderRadius: '6px', display: 'flex', justifyContent: 'space-between', padding: '10px 12px' }, '& span': { color: 'var(--text-muted)' } })
const buttonRowStyle = css({ alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: '10px' })
const formStyle = css({ display: 'grid', gap: '18px', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', maxWidth: '900px', '@media (max-width: 680px)': { gridTemplateColumns: '1fr' } })
const wideStyle = css({ gridColumn: '1 / -1', '@media (max-width: 680px)': { gridColumn: 'auto' } })
const feedbackStackStyle = css({ display: 'grid', gap: '10px', maxWidth: '900px', '& p': { margin: 0 } })
const characterRowStyle = css({ display: 'flex', flexWrap: 'wrap', gap: '14px 24px' })
const compactTableCardStyle = css({ padding: 0 })
const positiveValueStyle = css({ color: 'var(--success-text)', fontWeight: 900 })
const negativeValueStyle = css({ color: 'var(--danger-text)', fontWeight: 900 })
const statusTextStyle = css({ color: 'var(--text-muted)', fontSize: '11px', fontWeight: 900, textTransform: 'uppercase' })
const detailsStyle = css({ '& summary': { cursor: 'pointer', fontFamily: 'var(--font-display)', fontSize: '19px' } })
const patternGridStyle = css({ alignItems: 'start', display: 'grid', gap: '20px', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', '@media (max-width: 900px)': { gridTemplateColumns: '1fr' } })
