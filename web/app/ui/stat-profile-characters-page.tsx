import type { StatProfileRevision } from '@starworks/contracts'
import type { Handle } from 'remix/ui'
import { css } from 'remix/ui'

import type { LeagueDetail, SessionIdentity } from '../platform/model.ts'
import { routes } from '../routes.ts'
import { characterHeadshotPath, displayCharacterName } from '../sluggers/characters.ts'
import { AppShell, cardStyle } from './app-shell.tsx'

interface StatProfileCharactersPageProps {
  identity: SessionIdentity
  league: LeagueDetail
  revision: StatProfileRevision
}

export function StatProfileCharactersPage(handle: Handle<StatProfileCharactersPageProps>) {
  return () => {
    let { identity, league, revision } = handle.props
    return (
      <AppShell identity={identity} league={league} title={`Characters · ${revision.name} · Starworks`}>
        <header mix={pageHeaderStyle}>
          <div>
            <h1>Characters</h1>
            <p>{revision.name} · Revision {revision.revisionNumber}</p>
          </div>
          <a href={routes.leagues.configuration.statProfiles.revision.show.href({ leagueSlug: league.slug, revisionId: revision.revisionId })}>Back to profile</a>
        </header>
        <main aria-labelledby="character-list-heading" mix={contentStyle}>
          <div mix={sectionTitleStyle}>
            <h2 id="character-list-heading">Character stats</h2>
            <span>{revision.characterValues.length}</span>
          </div>
          <div mix={characterGridStyle}>
            {revision.characterValues.map((character) => (
              <a
                href={routes.leagues.configuration.statProfiles.revision.character.edit.href({
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
        </main>
      </AppShell>
    )
  }
}

const pageHeaderStyle = css({ alignItems: 'end', display: 'flex', flexWrap: 'wrap', gap: '20px', justifyContent: 'space-between', '& h1': { fontFamily: 'var(--font-happiness)', fontSize: 'clamp(36px, 6vw, 54px)', lineHeight: 1, margin: 0 }, '& p': { color: 'var(--text-muted)', margin: '8px 0 0' } })
const contentStyle = css({ display: 'grid', gap: '16px', marginTop: '34px' })
const sectionTitleStyle = css({ alignItems: 'baseline', display: 'flex', justifyContent: 'space-between', '& h2': { fontSize: '28px', margin: 0 }, '& span': { color: 'var(--text-muted)' } })
const characterGridStyle = css({ display: 'grid', gap: '12px', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))' })
const characterLinkStyle = css({ alignItems: 'center', color: 'var(--text-primary) !important', display: 'grid', gap: '12px', gridTemplateColumns: '54px minmax(0, 1fr)', padding: '10px 14px', textDecoration: 'none', '& img': { height: '54px', objectFit: 'contain', width: '54px' }, '& span': { display: 'grid', gap: '3px', minWidth: 0 }, '& strong': { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, '& small': { color: 'var(--text-muted)', fontSize: '13px' }, '&:hover': { borderColor: 'var(--border-strong)', transform: 'translateY(-1px)' } })
