import type { RulesetRevision } from '@starworks/contracts'
import type { Handle, RemixNode } from 'remix/ui'
import { css } from 'remix/ui'

import type { RulesetRevisionDetail } from '../configuration/service.ts'
import {
  ruleInputName,
  supportedSluggersRule,
} from '../configuration/sluggers-rules.ts'
import type { LeagueDetail, SessionIdentity } from '../platform/model.ts'
import { routes } from '../routes.ts'
import { buttonStyle, cardStyle, inputStyle } from './app-shell.tsx'
import {
  IssueList,
  RevisionActions,
  RevisionHistory,
  RevisionShell,
  sectionHeadingStyle,
} from './revision-page.tsx'

interface RulesetRevisionPageProps {
  detail: RulesetRevisionDetail
  identity: SessionIdentity
  league: LeagueDetail
}

export function RulesetRevisionPage(handle: Handle<RulesetRevisionPageProps>) {
  return () => {
    let { detail, identity, league } = handle.props
    let revision = detail.revision
    let routeParams = { leagueSlug: league.slug, revisionId: revision.revisionId }
    let issues = revision.settings
      .filter((setting) => setting.loadPhase !== 'web-only' && !setting.gameplayTarget)
      .map((setting) => `${setting.label} is not connected to the game`)
    return (
      <RevisionShell
        identity={identity}
        league={league}
        heading={revision.name}
        kind="Ruleset"
        returnHref={routes.leagues.configuration.rulesets.index.href({ leagueSlug: league.slug })}
        returnLabel="Back to rules"
        revisionNumber={revision.revisionNumber}
        status={revision.status}
      >
        <IssueList issues={issues} />
        {revision.status === 'draft' ? (
          <form action={routes.leagues.configuration.rulesets.revision.update.href(routeParams)} method="post" mix={formStyle}>
            <label mix={nameFieldStyle}><span>Revision name</span><input required name="name" defaultValue={revision.name} mix={inputStyle} /></label>
            <RuleSettings current={revision.settings} previous={detail.basedOnRevision?.settings ?? null} readOnly={false} />
            <button type="submit" mix={buttonStyle}>Save rules</button>
          </form>
        ) : (
          <RuleSettings current={revision.settings} previous={detail.basedOnRevision?.settings ?? null} readOnly />
        )}
        <RevisionActions
          cloneAction={routes.leagues.configuration.rulesets.revision.clone.href(routeParams)}
          publishAction={routes.leagues.configuration.rulesets.revision.publish.href(routeParams)}
          status={revision.status}
        />
        <RevisionHistory rows={detail.history} />
      </RevisionShell>
    )
  }
}

function RuleSettings(handle: Handle<{
  current: RulesetRevision['settings']
  previous: RulesetRevision['settings'] | null
  readOnly: boolean
}>) {
  return () => (
    <section mix={settingsStyle} aria-labelledby="settings-heading">
      <div>
        <h2 id="settings-heading" mix={sectionHeadingStyle}>Game and league rules</h2>
        <p mix={mutedStyle}>Only controls supported by Starworks and the current Sluggers adapter are editable.</p>
      </div>
      <div mix={settingsGridStyle}>
        {handle.props.current.map((setting, index) => {
          let previous = handle.props.previous?.find((candidate) => candidate.key === setting.key)
          let definition = supportedSluggersRule(setting.key)
          return (
            <article mix={[cardStyle, settingCardStyle]}>
              <div mix={settingHeadingStyle}>
                <div><h3>{setting.label}</h3>{setting.description ? <p>{setting.description}</p> : null}</div>
                <span>{setting.loadPhase === 'web-only' ? 'League' : 'In game'}</span>
              </div>
              {definition ? (
                <RuleValue index={index} readOnly={handle.props.readOnly} setting={setting} />
              ) : (
                <p mix={unknownValueStyle}>{displayValue(setting.value)} · preserved from import</p>
              )}
              {previous && previous.value !== setting.value ? <small mix={previousStyle}>was {displayValue(previous.value)}</small> : null}
            </article>
          )
        })}
      </div>
    </section>
  )
}

function RuleValue(handle: Handle<{ index: number; readOnly: boolean; setting: RulesetRevision['settings'][number] }>) {
  return () => {
    let { index, readOnly, setting } = handle.props
    let definition = supportedSluggersRule(setting.key)!
    if (typeof definition.defaultValue === 'boolean') {
      return (
        <select name={ruleInputName(index)} disabled={readOnly} mix={inputStyle}>
          <option value="true" selected={setting.value === true}>On</option>
          <option value="false" selected={setting.value === false}>Off</option>
        </select>
      )
    }
    return <input type="number" name={ruleInputName(index)} defaultValue={String(setting.value)} min={definition.minimum} max={definition.maximum} step={definition.step} disabled={readOnly} required mix={inputStyle} />
  }
}

function displayValue(value: RulesetRevision['settings'][number]['value']): RemixNode {
  if (value === null) return 'Not configured'
  if (typeof value === 'boolean') return value ? 'On' : 'Off'
  return String(value)
}

const formStyle = css({ display: 'grid', gap: '22px' })
const nameFieldStyle = css({ display: 'grid', fontSize: '14px', fontWeight: 700, gap: '7px', maxWidth: '620px' })
const settingsStyle = css({ display: 'grid', gap: '18px' })
const settingsGridStyle = css({ display: 'grid', gap: '14px', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 270px), 1fr))' })
const settingCardStyle = css({ display: 'grid', gap: '16px' })
const settingHeadingStyle = css({ alignItems: 'start', display: 'flex', gap: '12px', justifyContent: 'space-between', '& h3': { fontSize: '19px', margin: 0 }, '& p': { color: 'var(--text-muted)', fontSize: '13px', margin: '5px 0 0' }, '& > span': { color: 'var(--text-muted)', fontSize: '11px', fontWeight: 900, textTransform: 'uppercase', whiteSpace: 'nowrap' } })
const mutedStyle = css({ color: 'var(--text-muted)', margin: '6px 0 0' })
const unknownValueStyle = css({ color: 'var(--text-muted)', margin: 0 })
const previousStyle = css({ color: 'var(--warning-text)', fontWeight: 700 })
