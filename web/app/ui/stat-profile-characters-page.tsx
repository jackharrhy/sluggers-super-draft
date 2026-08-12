import type { StatProfileRevision } from '@starworks/contracts'
import type { Handle } from 'remix/ui'
import { css } from 'remix/ui'

import type { LeagueDetail, SessionIdentity } from '../platform/model.ts'
import { routes } from '../routes.ts'
import {
  characterHeadshotPath,
  displayCharacterName,
  sluggersCharacterKind,
  type SluggersCharacterKind,
} from '../sluggers/characters.ts'
import { AppShell, cardStyle } from './app-shell.tsx'

interface StatProfileCharactersPageProps {
  identity: SessionIdentity
  league: LeagueDetail
  revision: StatProfileRevision
}

export function StatProfileCharactersPage(handle: Handle<StatProfileCharactersPageProps>) {
  return () => {
    let { identity, league, revision } = handle.props
    let groups = groupCharacters(revision.characterValues)
    return (
      <AppShell identity={identity} league={league} title={`Characters · ${revision.name} · Starworks`}>
        <header mix={pageHeaderStyle}>
          <div>
            <h1>Characters</h1>
            <p>{revision.name} · Revision {revision.revisionNumber}</p>
          </div>
          <a href={routes.leagues.configuration.statProfiles.revision.show.href({ leagueSlug: league.slug, revisionId: revision.revisionId })}>Back to profile</a>
        </header>
        <main aria-label="Character stats" mix={contentStyle}>
          <CharacterGroup
            characters={groups.playable}
            heading="Playable characters"
            leagueSlug={league.slug}
            revisionId={revision.revisionId}
          />
          <CharacterGroup
            characters={groups.mii}
            heading="Mii slots"
            leagueSlug={league.slug}
            revisionId={revision.revisionId}
          />
          <CharacterGroup
            characters={groups.unused}
            description="These game slots are retained so v4 imports and exports remain complete."
            heading="Unused game slots"
            leagueSlug={league.slug}
            revisionId={revision.revisionId}
          />
        </main>
      </AppShell>
    )
  }
}

interface CharacterGroupProps {
  characters: StatProfileRevision['characterValues']
  description?: string
  heading: string
  leagueSlug: string
  revisionId: string
}

function CharacterGroup(handle: Handle<CharacterGroupProps>) {
  return () => {
    let { characters, description, heading, leagueSlug, revisionId } = handle.props
    return (
      <section mix={groupStyle}>
        <div mix={sectionTitleStyle}>
          <div>
            <h2>{heading}</h2>
            {description ? <p>{description}</p> : null}
          </div>
          <span>{characters.length}</span>
        </div>
        <div mix={characterGridStyle}>
          {characters.map((character) => (
            <a
              href={routes.leagues.configuration.statProfiles.revision.character.edit.href({
                characterId: character.characterId,
                leagueSlug,
                revisionId,
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
    )
  }
}

function groupCharacters(characters: StatProfileRevision['characterValues']) {
  let groups: Record<SluggersCharacterKind, StatProfileRevision['characterValues']> = {
    mii: [],
    playable: [],
    unused: [],
  }
  for (let character of characters) groups[sluggersCharacterKind(character.characterId)].push(character)
  return groups
}

const pageHeaderStyle = css({ alignItems: 'end', display: 'flex', flexWrap: 'wrap', gap: '20px', justifyContent: 'space-between', '& h1': { fontFamily: 'var(--font-happiness)', fontSize: 'clamp(36px, 6vw, 54px)', lineHeight: 1, margin: 0 }, '& p': { color: 'var(--text-muted)', margin: '8px 0 0' } })
const contentStyle = css({ display: 'grid', gap: '40px', marginTop: '34px' })
const groupStyle = css({ display: 'grid', gap: '16px' })
const sectionTitleStyle = css({ alignItems: 'end', display: 'flex', gap: '20px', justifyContent: 'space-between', '& h2': { fontSize: '28px', margin: 0 }, '& p': { color: 'var(--text-muted)', margin: '5px 0 0', maxWidth: '620px' }, '& span': { color: 'var(--text-muted)' } })
const characterGridStyle = css({ display: 'grid', gap: '12px', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))' })
const characterLinkStyle = css({ alignItems: 'center', color: 'var(--text-primary) !important', display: 'grid', gap: '12px', gridTemplateColumns: '54px minmax(0, 1fr)', padding: '10px 14px', textDecoration: 'none', '& img': { height: '54px', objectFit: 'contain', width: '54px' }, '& span': { display: 'grid', gap: '3px', minWidth: 0 }, '& strong': { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, '& small': { color: 'var(--text-muted)', fontSize: '13px' }, '&:hover': { borderColor: 'var(--border-strong)', transform: 'translateY(-1px)' } })
