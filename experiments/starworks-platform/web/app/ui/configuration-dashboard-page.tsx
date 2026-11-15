import type { Handle } from 'remix/ui'
import { css } from 'remix/ui'

import type { AdapterOperation, AdapterOperationBundle } from '@starworks/contracts'

import type { LeagueDetail, SessionIdentity } from '../platform/model.ts'
import { routes } from '../routes.ts'
import { displayCharacterName } from '../sluggers/characters.ts'
import { AppShell, cardStyle } from './app-shell.tsx'
import { CharacterBadge } from './league-operations/character-badge.tsx'

export function OperationPreviewPage(
  handle: Handle<{
    bundle: AdapterOperationBundle
    identity: SessionIdentity
    league: LeagueDetail
  }>,
) {
  return () => {
    let { bundle, identity, league } = handle.props
    let rules = operationsOfType(bundle.operations, 'set-game-rule')
    let roster = operationsOfType(bundle.operations, 'select-roster-slot')
    let captain = operationsOfType(bundle.operations, 'set-captain')[0]
    let batting = operationsOfType(bundle.operations, 'set-batting-slot')
    let fielding = operationsOfType(bundle.operations, 'set-fielding-position')
    let fullProfile = operationsOfType(bundle.operations, 'apply-sluggers-stat-profile')[0]
    let scalarStats = operationsOfType(bundle.operations, 'set-character-stat')
    let statAssignments = fullProfile
      ? fullProfile.characterValues.reduce((total, character) => total + Object.keys(character.values).length, 0)
      : scalarStats.length
    return (
      <AppShell identity={identity} league={league} title={`Adapter preview · ${league.name} · Starworks`}>
        <header mix={headerStyle}>
          <div>
            <h1>Ready for the runner</h1>
            <p mix={mutedStyle}>{bundle.operations.length} validated steps for this published configuration.</p>
          </div>
          <a href={routes.leagues.configuration.dashboard.href({ leagueSlug: league.slug })}>Back to admin</a>
        </header>

        <div mix={summaryGridStyle}>
          <SummaryCard heading="Player tuning" value={`${statAssignments} values`} detail={fullProfile ? `${fullProfile.characterValues.length} characters · complete v4 profile` : `${scalarStats.length} mapped changes`} />
          <SummaryCard heading="Game rules" value={`${rules.length} applied`} detail={rules.length ? rules.map((rule) => humanize(rule.ruleKey)).join(', ') : 'No runtime rules'} />
          <SummaryCard heading="Team sheet" value={`${roster.length} selected`} detail={`${batting.length} batting · ${fielding.length} fielding`} />
        </div>

        <div mix={detailGridStyle}>
          <section mix={cardStyle} aria-labelledby="rules-preview-heading">
            <h2 id="rules-preview-heading">Rules</h2>
            {rules.length ? <dl mix={definitionStyle}>{rules.map((rule) => <div><dt>{humanize(rule.ruleKey)}</dt><dd>{displayValue(rule.value)}</dd></div>)}</dl> : <p mix={mutedStyle}>No game rules are applied by this configuration.</p>}
          </section>
          <section mix={cardStyle} aria-labelledby="lineup-preview-heading">
            <h2 id="lineup-preview-heading">Lineup</h2>
            {captain ? <p mix={captainStyle}><span>Captain</span><CharacterBadge characterId={captain.characterId} /></p> : null}
            <ol mix={lineupStyle}>{batting.map((slot) => (
              <li><span>{slot.slot}</span><CharacterBadge characterId={slot.characterId} /><small>{fielding.find((assignment) => assignment.characterId === slot.characterId)?.position ?? 'Bench'}</small></li>
            ))}</ol>
          </section>
        </div>
      </AppShell>
    )
  }
}

function operationsOfType<T extends AdapterOperation['operation']>(operations: AdapterOperation[], operation: T) {
  return operations.filter((item): item is Extract<AdapterOperation, { operation: T }> => item.operation === operation)
}

function humanize(value: string): string {
  return value.replaceAll(/[._-]+/g, ' ').replace(/^\w/, (letter) => letter.toUpperCase())
}

function displayValue(value: string | number | boolean | null): string {
  if (value === null) return 'Not set'
  if (typeof value === 'boolean') return value ? 'On' : 'Off'
  return String(value)
}

function SummaryCard(handle: Handle<{ detail: string; heading: string; value: string }>) {
  return () => <article mix={[cardStyle, summaryStyle]}><span>{handle.props.heading}</span><strong>{handle.props.value}</strong><small>{handle.props.detail}</small></article>
}

const headerStyle = css({ alignItems: 'start', display: 'flex', gap: '32px', justifyContent: 'space-between', '& h1': { margin: 0 }, '@media(max-width: 640px)': { flexDirection: 'column', gap: '14px' } })
const mutedStyle = css({ color: 'var(--text-soft)', marginBottom: 0 })
const summaryGridStyle = css({ display: 'grid', gap: '16px', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', marginTop: '32px', '@media(max-width: 760px)': { gridTemplateColumns: '1fr' } })
const summaryStyle = css({ display: 'grid', gap: '5px', '& > span': { color: 'var(--text-soft)' }, '& > strong': { fontFamily: 'var(--font-display)', fontSize: '24px' }, '& > small': { color: 'var(--text-soft)', lineHeight: 1.4 } })
const detailGridStyle = css({ display: 'grid', gap: '20px', gridTemplateColumns: 'minmax(0, 0.8fr) minmax(0, 1.2fr)', marginTop: '20px', '& h2': { marginTop: 0 }, '@media(max-width: 760px)': { gridTemplateColumns: '1fr' } })
const definitionStyle = css({ margin: 0, '& > div': { borderTop: '1px solid var(--border)', display: 'flex', gap: '20px', justifyContent: 'space-between', padding: '12px 0' }, '& dt': { color: 'var(--text-soft)' }, '& dd': { margin: 0 } })
const captainStyle = css({ alignItems: 'center', display: 'flex', gap: '18px', justifyContent: 'space-between', '& > span': { color: 'var(--text-soft)' } })
const lineupStyle = css({ listStyle: 'none', margin: '18px 0 0', padding: 0, '& li': { alignItems: 'center', borderTop: '1px solid var(--border)', display: 'grid', gap: '10px', gridTemplateColumns: '24px minmax(0, 1fr) auto', padding: '10px 0' }, '& li > span': { color: 'var(--text-soft)' }, '& small': { color: 'var(--text-soft)', textTransform: 'uppercase' } })
