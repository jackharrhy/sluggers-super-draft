import { FieldingPositionSchema, type TeamLineupRevision } from '@starworks/contracts'
import type { Handle } from 'remix/ui'
import { css } from 'remix/ui'

import type { TeamLineupRevisionDetail } from '../configuration/service.ts'
import { battingInputName, fieldingInputName } from '../configuration/team-lineup-form.ts'
import type { LeagueDetail, SessionIdentity } from '../platform/model.ts'
import { routes } from '../routes.ts'
import {
  characterHeadshotPath,
  displayCharacterName,
  isSluggersCaptainCharacter,
  isSluggersPlayableCharacter,
} from '../sluggers/characters.ts'
import { buttonStyle, cardStyle, inputStyle } from './app-shell.tsx'
import {
  IssueList,
  RevisionActions,
  RevisionHistory,
  RevisionShell,
} from './revision-page.tsx'

interface TeamLineupRevisionPageProps {
  detail: TeamLineupRevisionDetail
  identity: SessionIdentity
  league: LeagueDetail
}

export function TeamLineupRevisionPage(handle: Handle<TeamLineupRevisionPageProps>) {
  return () => {
    let { detail, identity, league } = handle.props
    let revision = detail.revision
    let routeParams = {
      leagueSlug: league.slug,
      revisionId: revision.lineupRevisionId,
      teamId: revision.teamId,
    }
    return (
      <RevisionShell
        identity={identity}
        league={league}
        heading={detail.teamName}
        kind="Team lineup"
        returnHref={routes.leagues.configuration.teams.index.href({ leagueSlug: league.slug })}
        returnLabel="Back to teams"
        revisionNumber={revision.lineupRevisionNumber}
        status={revision.status}
      >
        <IssueList issues={detail.issues.map(formatLineupIssue)} />
        {revision.status === 'draft' ? (
          <form action={routes.leagues.configuration.teams.lineup.update.href(routeParams)} method="post" mix={lineupFormStyle}>
            <p mix={helperStyle}>Choose one of the twelve team captains, every batting slot, and every fielding position. The player at P becomes the pitcher.</p>
            <RosterEditor current={revision} previous={detail.basedOnRevision} readOnly={false} />
            <button type="submit" mix={buttonStyle}>Save lineup</button>
          </form>
        ) : (
          <RosterEditor current={revision} previous={detail.basedOnRevision} readOnly />
        )}
        <RevisionActions
          cloneAction={routes.leagues.configuration.teams.lineup.clone.href(routeParams)}
          publishAction={routes.leagues.configuration.teams.lineup.publish.href(routeParams)}
          status={revision.status}
        />
        <RevisionHistory rows={detail.history} />
      </RevisionShell>
    )
  }
}

function RosterEditor(handle: Handle<{
  current: TeamLineupRevision
  previous: TeamLineupRevision | null
  readOnly: boolean
}>) {
  return () => (
    <div mix={rosterStyle}>
      {handle.props.current.rosterCharacterIds.map((characterId, index) => {
        let current = placement(handle.props.current, characterId)
        let previous = handle.props.previous ? placement(handle.props.previous, characterId) : null
        let playable = isSluggersPlayableCharacter(characterId)
        let canCaptain = isSluggersCaptainCharacter(characterId)
        return (
          <article mix={handle.props.readOnly ? [cardStyle, playerCardStyle, publishedCardStyle] : [cardStyle, playerCardStyle]}>
            <div mix={playerStyle}>
              <img src={characterHeadshotPath(characterId)} alt="" />
              <strong>{displayCharacterName(characterId)}</strong>
            </div>
            {handle.props.readOnly ? (
              <div mix={publishedPlacementStyle}>
                {current.captain ? <span mix={captainBadgeStyle}>Captain</span> : null}
                <span><small>Batting</small>{current.battingSlot ? `#${current.battingSlot}` : 'Bench'}</span>
                <span><small>Fielding</small>{current.fieldingPosition ?? 'Bench'}</span>
              </div>
            ) : <>
              {canCaptain ? (
                <label mix={captainStyle}>
                  <input type="radio" name="captain" value={characterId} checked={current.captain} />
                  <span>Captain</span>
                  {previous && previous.captain !== current.captain ? <small>{previous.captain ? 'was captain' : 'new captain'}</small> : null}
                </label>
              ) : <span mix={unsupportedStyle}>{playable ? 'Position player' : 'Not available for live play'}</span>}
              <label mix={fieldStyle}>
                <span>Batting</span>
                <select name={battingInputName(index)} mix={inputStyle}>
                  {playable ? Array.from({ length: 9 }, (_, slot) => <option value={slot + 1} selected={current.battingSlot === slot + 1}>{slot + 1}</option>) : null}
                  <option value="bench" selected={current.battingSlot === null}>Bench</option>
                </select>
                {previous && previous.battingSlot !== current.battingSlot ? <small>was {previous.battingSlot ?? 'bench'}</small> : null}
              </label>
              <label mix={fieldStyle}>
                <span>Fielding</span>
                <select name={fieldingInputName(index)} mix={inputStyle}>
                  {playable ? FieldingPositionSchema.options.map((position) => <option value={position} selected={current.fieldingPosition === position}>{position}</option>) : null}
                  <option value="bench" selected={current.fieldingPosition === null}>Bench</option>
                </select>
                {previous && previous.fieldingPosition !== current.fieldingPosition ? <small>was {previous.fieldingPosition ?? 'bench'}</small> : null}
              </label>
            </>}
          </article>
        )
      })}
    </div>
  )
}

function placement(revision: TeamLineupRevision, characterId: string) {
  let battingIndex = revision.lineup.battingOrder.indexOf(characterId)
  return {
    battingSlot: battingIndex === -1 ? null : battingIndex + 1,
    captain: revision.lineup.captainCharacterId === characterId,
    fieldingPosition: revision.lineup.fielding.find((assignment) => assignment.characterId === characterId)?.position ?? null,
  }
}

function formatLineupIssue(issue: TeamLineupRevisionDetail['issues'][number]): string {
  return issue.split('-').map((word) => word[0]!.toUpperCase() + word.slice(1)).join(' ')
}

const lineupFormStyle = css({ display: 'grid', gap: '20px' })
const helperStyle = css({ color: 'var(--text-muted)', margin: 0 })
const rosterStyle = css({ display: 'grid', gap: '12px' })
const playerCardStyle = css({ alignItems: 'center', display: 'grid', gap: '14px', gridTemplateColumns: 'minmax(180px, 1.4fr) minmax(125px, .7fr) minmax(130px, .7fr) minmax(130px, .7fr)', padding: '12px 16px', '@media (max-width: 760px)': { alignItems: 'stretch', gridTemplateColumns: '1fr 1fr', '& > div': { gridColumn: '1 / -1' } } })
const publishedCardStyle = css({ gridTemplateColumns: 'minmax(180px, 1fr) auto', '@media (max-width: 760px)': { gridTemplateColumns: '1fr' } })
const playerStyle = css({ alignItems: 'center', display: 'flex', gap: '12px', minWidth: 0, '& img': { height: '52px', objectFit: 'contain', width: '52px' }, '& strong': { fontFamily: 'var(--font-display)', fontSize: '18px' } })
const captainStyle = css({ alignItems: 'center', display: 'grid', fontSize: '13px', gap: '4px', gridTemplateColumns: 'auto 1fr', '& small': { color: 'var(--warning-text)', gridColumn: '2', fontWeight: 700 } })
const fieldStyle = css({ display: 'grid', fontSize: '13px', fontWeight: 700, gap: '5px', '& small': { color: 'var(--warning-text)' } })
const unsupportedStyle = css({ color: 'var(--text-muted)', fontSize: '13px', fontWeight: 700 })
const publishedPlacementStyle = css({ alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: '8px 20px', justifyContent: 'end', '& > span': { display: 'grid', fontFamily: 'var(--font-display)', fontSize: '17px', gap: '2px', minWidth: '62px' }, '& small': { color: 'var(--text-muted)', fontFamily: 'var(--font-sans)', fontSize: '11px', fontWeight: 700 }, '@media (max-width: 760px)': { justifyContent: 'start' } })
const captainBadgeStyle = css({ background: 'var(--warning-surface)', border: '1px solid var(--warning-border)', borderRadius: '999px', color: 'var(--warning-text)', fontFamily: 'var(--font-sans) !important', fontSize: '11px !important', fontWeight: 800, minWidth: '0 !important', padding: '5px 9px' })
