import type { Handle } from 'remix/ui'
import { css } from 'remix/ui'

import type { StatDefinition, StatProfileRevision } from '@starworks/contracts'

import {
  displayStatEditorCharacterValue,
  statEditorCharacterChoices,
} from '../configuration/stat-editor-character-fields.ts'
import type { LeagueDetail, SessionIdentity } from '../platform/model.ts'
import { routes } from '../routes.ts'
import { characterHeadshotPath, displayCharacterName } from '../sluggers/characters.ts'
import { AppShell, buttonStyle, cardStyle, inputStyle } from './app-shell.tsx'

interface StatProfileCharacterPageProps {
  character: StatProfileRevision['characterValues'][number]
  definitions: StatDefinition[]
  identity: SessionIdentity
  league: LeagueDetail
  previousValues: StatProfileRevision['characterValues'][number]['values'] | null
  profileName: string
  revisionId: string
  status: 'draft' | 'published'
  trajectoryActivation: number[]
  trajectoryNames: string[]
}

interface StatFieldProps {
  definition: StatDefinition
  previousValue: unknown
  trajectoryActivation: number[]
  trajectoryNames: string[]
  value: unknown
}

export function StatProfileCharacterPage(handle: Handle<StatProfileCharacterPageProps>) {
  return () => {
    let {
      character,
      definitions,
      identity,
      league,
      previousValues,
      profileName,
      revisionId,
      status,
      trajectoryActivation,
      trajectoryNames,
    } = handle.props
    let groups = groupDefinitions(definitions)
    let routeParams = { characterId: character.characterId, leagueSlug: league.slug, revisionId }
    return (
      <AppShell identity={identity} league={league} title={`${displayCharacterName(character.characterId)} · ${profileName} · Starworks`}>
        <header mix={headerStyle}>
          <img src={characterHeadshotPath(character.characterId)} alt="" />
          <div>
            <p mix={eyebrowStyle}>{profileName}</p>
            <h1>{displayCharacterName(character.characterId)}</h1>
          </div>
          <a href={routes.leagues.configuration.statProfiles.revision.characters.href({ leagueSlug: league.slug, revisionId })}>Back to characters</a>
        </header>
        {status === 'draft' ? (
          <form action={routes.leagues.configuration.statProfiles.revision.character.update.href(routeParams)} method="post" mix={formStyle}>
            {groups.map(([group, groupDefinitions]) => (
              <fieldset mix={[cardStyle, fieldsetStyle]}>
                <legend>{group}</legend>
                <div mix={fieldGridStyle}>
                  {groupDefinitions.map((definition) => (
                    <StatField
                      definition={definition}
                      previousValue={previousValues?.[definition.key]}
                      trajectoryActivation={trajectoryActivation}
                      trajectoryNames={trajectoryNames}
                      value={character.values[definition.key]}
                    />
                  ))}
                </div>
              </fieldset>
            ))}
            <div mix={saveBarStyle}>
              <button type="submit" mix={buttonStyle}>Save character stats</button>
            </div>
          </form>
        ) : (
          <div mix={formStyle}>
            {groups.map(([group, groupDefinitions]) => (
              <section mix={[cardStyle, fieldsetStyle]}>
                <h2>{group}</h2>
                <dl mix={valueGridStyle}>
                  {groupDefinitions.map((definition) => <div><dt>{definition.display.label}</dt><dd>{displayStatEditorCharacterValue(definition.key, character.values[definition.key], trajectoryNames)}</dd>{changedValue(character.values[definition.key], previousValues?.[definition.key])}</div>)}
                </dl>
              </section>
            ))}
          </div>
        )}
      </AppShell>
    )
  }
}

function StatField(handle: Handle<StatFieldProps>) {
  return () => {
    let { definition, previousValue, trajectoryActivation, trajectoryNames, value } = handle.props
    let name = `stat.${definition.key}`
    if (definition.dataType === 'boolean') {
      return <label mix={checkboxStyle}><input type="checkbox" name={name} defaultChecked={value === true} /><span>{definition.display.label}</span>{changedValue(value, previousValue)}</label>
    }
    if (definition.dataType === 'enum') {
      return <label mix={fieldStyle}><span>{definition.display.label}</span><select name={name} required={definition.required} mix={inputStyle}>{!definition.required ? <option value="" selected={typeof value !== 'string'}>Not set</option> : null}{definition.choices.map((choice) => <option value={choice.value} selected={choice.value === value}>{choice.label}</option>)}</select>{changedValue(value, previousValue)}</label>
    }
    let encodedChoices = statEditorCharacterChoices(definition.key, trajectoryNames, trajectoryActivation)
    if (encodedChoices) {
      let includesCurrentValue = typeof value === 'number'
        && encodedChoices.some((choice) => choice.value === value)
      return (
        <label mix={fieldStyle}>
          <span>{definition.display.label}</span>
          <select name={name} required={definition.required} mix={inputStyle}>
            {!includesCurrentValue && typeof value === 'number'
              ? <option value={String(value)} selected>Unknown value ({value})</option>
              : null}
            {encodedChoices.map((choice) => (
              <option value={String(choice.value)} selected={choice.value === value}>{choice.label}</option>
            ))}
          </select>
          {changedValue(value, previousValue)}
        </label>
      )
    }
    return (
      <label mix={fieldStyle}>
        <span>{definition.display.label}</span>
        <input
          type="number"
          name={name}
          defaultValue={typeof value === 'number' ? String(value) : ''}
          min={definition.minimum}
          max={definition.maximum}
          step={definition.step}
          required={definition.required}
          mix={inputStyle}
        />
        {definition.display.unit ? <small>{definition.display.unit}</small> : null}
        {changedValue(value, previousValue)}
      </label>
    )
  }
}

function changedValue(value: unknown, previousValue: unknown) {
  return previousValue !== undefined && value !== previousValue
    ? <small mix={previousValueStyle}>was {String(previousValue ?? 'not set')}</small>
    : null
}

function groupDefinitions(definitions: StatDefinition[]) {
  let groups = new Map<string, StatDefinition[]>()
  for (let definition of [...definitions].sort((left, right) => left.display.order - right.display.order)) {
    let values = groups.get(definition.display.group) ?? []
    values.push(definition)
    groups.set(definition.display.group, values)
  }
  return [...groups]
}

const headerStyle = css({ alignItems: 'center', display: 'grid', gap: '18px', gridTemplateColumns: '84px minmax(0, 1fr) auto', '& > img': { height: '84px', objectFit: 'contain', width: '84px' }, '& h1': { fontFamily: 'var(--font-happiness)', fontSize: 'clamp(34px, 6vw, 52px)', margin: 0 }, '@media (max-width: 620px)': { gridTemplateColumns: '68px minmax(0, 1fr)', '& > img': { height: '68px', width: '68px' }, '& > a': { gridColumn: '1 / -1' } } })
const eyebrowStyle = css({ color: 'var(--text-muted)', margin: '0 0 6px' })
const formStyle = css({ display: 'grid', gap: '20px', marginTop: '32px' })
const fieldsetStyle = css({ display: 'grid', gap: '16px', margin: 0, '& legend, & h2': { fontFamily: 'var(--font-display)', fontSize: '22px', margin: 0, padding: '0 8px' } })
const fieldGridStyle = css({ display: 'grid', gap: '14px', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))' })
const fieldStyle = css({ display: 'grid', fontSize: '14px', fontWeight: 700, gap: '6px', '& small': { color: 'var(--text-muted)', fontWeight: 500 } })
const checkboxStyle = css({ alignItems: 'center', display: 'flex', gap: '9px', minHeight: '48px' })
const saveBarStyle = css({ display: 'flex', justifyContent: 'flex-end' })
const valueGridStyle = css({ display: 'grid', gap: '12px', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', margin: 0, '& div': { borderBottom: '1px solid var(--border)', paddingBottom: '8px' }, '& dt': { color: 'var(--text-muted)', fontSize: '13px' }, '& dd': { margin: '3px 0 0' } })
const previousValueStyle = css({ color: 'var(--warning-text)', fontSize: '11px', fontWeight: 700 })
