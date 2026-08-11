import type { Handle } from 'remix/ui'
import { css } from 'remix/ui'

import type { DraftCharacter, DraftRoom, DraftSetupOptions } from '../draft/service.ts'
import type { LeagueDetail, SessionIdentity } from '../platform/model.ts'
import { administrativeRoles } from '../platform/repository.ts'
import { routes } from '../routes.ts'
import { characterHeadshotPath } from '../sluggers/characters.ts'
import { AppShell, buttonStyle, cardStyle, inputStyle } from './app-shell.tsx'

interface DraftDashboardPageProps {
  dashboard: DraftSetupOptions
  error?: string
  identity: SessionIdentity
  league: LeagueDetail
}

export function DraftDashboardPage(handle: Handle<DraftDashboardPageProps>) {
  return () => {
    let { dashboard, error, identity, league } = handle.props
    let mayAdminister = identity.isSiteAdmin || league.roles.some((role) => administrativeRoles.has(role))
    return (
      <AppShell identity={identity} league={league} title={`${league.name} drafts · Starworks`}>
        <header mix={heroStyle}>
          <h1 mix={headingStyle}>Drafts</h1>
          <span>{league.name}</span>
        </header>

        {error ? <p role="alert" mix={errorStyle}>{error}</p> : null}

        <section mix={sectionStyle} aria-labelledby="drafts-heading">
          <div mix={sectionHeadingStyle}>
            <h2 id="drafts-heading">Draft rooms</h2>
            <span mix={countStyle}>{dashboard.drafts.length} total</span>
          </div>
          <div mix={cardGridStyle}>
            {dashboard.drafts.map((draft) => (
              <a href={routes.leagues.drafts.room.href({ draftId: draft.id, leagueSlug: league.slug })} mix={[cardStyle, draftLinkStyle]}>
                <span mix={statusStyle}>{draft.status}</span>
                <h3>{draft.name}</h3>
                <p>{draft.seasonName}</p>
                <small>{draft.status === 'completed' ? `${draft.totalPicks} picks complete` : `Pick ${draft.currentPickNumber} of ${draft.totalPicks}`}</small>
              </a>
            ))}
            {!dashboard.drafts.length ? <p mix={emptyStyle}>No draft room has been configured.</p> : null}
          </div>
        </section>

        {mayAdminister ? (
          <section mix={sectionStyle} aria-labelledby="create-heading">
            <div mix={sectionHeadingStyle}>
              <h2 id="create-heading">Create a draft</h2>
            </div>
            {!dashboard.statProfiles.length ? (
              <p mix={emptyStyle}>Publish a stat profile before creating a draft. Its exact character set becomes the eligible pool.</p>
            ) : dashboard.seasons.map((season) => (
              <article mix={[cardStyle, createCardStyle]}>
                <div>
                  <h3>{season.name}</h3>
                  <p mix={mutedStyle}>{season.teams.length} configured teams</p>
                </div>
                <form action={routes.leagues.drafts.create.href({ leagueSlug: league.slug })} method="post" mix={formStyle}>
                  <input type="hidden" name="seasonId" value={season.id} />
                  <input type="hidden" name="gameId" value="RMBE01" />
                  <label mix={wideStyle}>Draft name<input name="name" required defaultValue={`${season.name} Draft`} mix={inputStyle} /></label>
                  <label>Stat profile<select name="statProfileRevisionId" required mix={inputStyle}>
                    {dashboard.statProfiles.map((profile) => <option value={profile.id}>{profile.name} · revision {profile.revisionNumber}</option>)}
                  </select></label>
                  <label>Order mode<select name="orderMode" mix={inputStyle}>
                    <option value="snake" selected>Snake</option>
                    <option value="linear">Linear</option>
                  </select></label>
                  <label>Rounds<input type="number" name="rounds" min="1" max="18" defaultValue="9" required mix={inputStyle} /></label>
                  <label>Seconds per pick<input type="number" name="pickSeconds" min="15" max="86400" defaultValue="120" required mix={inputStyle} /></label>
                  <fieldset mix={slotFieldsetStyle}>
                    <legend>Ordered team slots</legend>
                    <p mix={mutedStyle}>Choose each team once. The numbered controls define round-one order.</p>
                    {season.teams.map((_, index) => (
                      <label>Slot {index + 1}<select name="slotTeamIds" mix={inputStyle}>
                        <option value="" selected={!season.teams[index]}>Unused</option>
                        {season.teams.map((team) => <option value={team.id} selected={team.id === season.teams[index]?.id}>{team.name}</option>)}
                      </select></label>
                    ))}
                  </fieldset>
                  <button type="submit" mix={buttonStyle}>Create authoritative draft</button>
                </form>
              </article>
            ))}
          </section>
        ) : null}
      </AppShell>
    )
  }
}

interface DraftRoomPageProps {
  error?: string
  identity: SessionIdentity
  league: LeagueDetail
  room: DraftRoom
}

export function DraftRoomPage(handle: Handle<DraftRoomPageProps>) {
  return () => {
    let { error, identity, league, room } = handle.props
    let mayAdminister = identity.isSiteAdmin || league.roles.some((role) => administrativeRoles.has(role))
    let currentTeam = room.slots.find((slot) => slot.teamId === room.currentTeamId)
    let managedTeam = room.slots.find((slot) => slot.managerPersonId === identity.personId)
    let mayPick = room.draft.status === 'active' && (mayAdminister || currentTeam?.managerPersonId === identity.personId)
    let activePicks = room.picks.filter((pick) => pick.status === 'active')
    return (
      <AppShell identity={identity} league={league} title={`${room.draft.name} · Starworks`}>
        <header mix={heroStyle}>
          <h1 mix={headingStyle}>{room.draft.name}</h1>
          <span>{room.draft.status} · {room.draft.orderMode} order</span>
        </header>

        {error ? <p role="alert" mix={errorStyle}>{error}</p> : null}

        <section mix={[cardStyle, clockCardStyle]} aria-labelledby="clock-heading">
          <div>
            <h2 id="clock-heading">{currentTeam?.teamName ?? 'Draft complete'}</h2>
            <p mix={mutedStyle}>
              {currentTeam ? `${currentTeam.teamName} owns pick ${room.draft.currentPickNumber}` : `${activePicks.length} of ${room.draft.totalPicks} selections`}
              {room.draft.deadline ? ` · deadline ${room.draft.deadline.toLocaleTimeString()}` : room.draft.status === 'paused' ? ' · clock paused' : ''}
            </p>
          </div>
          {mayAdminister ? <CommissionerControls league={league} room={room} /> : null}
        </section>

        <section mix={sectionStyle} aria-labelledby="order-heading">
          <div mix={sectionHeadingStyle}><h2 id="order-heading">Team slots</h2><span mix={countStyle}>{room.draft.rounds} rounds</span></div>
          <ol mix={slotListStyle}>
            {room.slots.map((slot) => {
              let count = activePicks.filter((pick) => pick.teamId === slot.teamId).length
              return <li mix={slotStyle}><span>{slot.position}</span><strong>{slot.teamName}</strong><small>{count} picked</small></li>
            })}
          </ol>
        </section>

        {managedTeam && !['completed', 'cancelled'].includes(room.draft.status) ? (
          <section mix={[cardStyle, queueStyle]} aria-labelledby="queue-heading">
            <div><h2 id="queue-heading">{managedTeam.teamName} queue</h2><p mix={mutedStyle}>Private to your team</p></div>
            {room.queue.length ? <ol mix={queueListStyle}>{room.queue.map((characterId, index) => {
              let character = room.characters.find((candidate) => candidate.characterId === characterId)
              return <li><span>{index + 1}. {character?.displayName ?? characterId}</span><QueueForm action="remove" characterId={characterId} league={league} room={room} teamId={managedTeam.teamId} /></li>
            })}</ol> : <p mix={mutedStyle}>Queue a character from the available pool. Expired clocks choose the first available entry.</p>}
          </section>
        ) : null}

        <section mix={sectionStyle} aria-labelledby="available-heading">
          <div mix={sectionHeadingStyle}>
            <h2 id="available-heading">Available characters</h2>
            <span mix={countStyle}>{room.characters.length} remaining</span>
          </div>
          <div mix={characterGridStyle}>
            {room.characters.map((character) => (
              <article mix={[cardStyle, characterCardStyle]}>
                <div mix={characterHeadingStyle}>
                  <div mix={characterIdentityStyle}>
                    <img src={characterHeadshotPath(character.characterId)} alt="" />
                    <h3>{character.displayName}</h3>
                  </div>
                  {character.isCaptain ? <span mix={captainStyle}>Captain</span> : null}
                </div>
                <dl mix={statsStyle}>{visibleStats(character).map(({ label, value }) => <div><dt>{label}</dt><dd>{String(value ?? '—')}</dd></div>)}</dl>
                {character.chemistry.length ? <div mix={chemistryStyle}>{character.chemistry.slice(0, 5).map((relationship) => <span data-relationship={relationship.relationship}>{relationship.relationship === 'positive' ? '+' : '−'} {relationship.displayName}</span>)}</div> : <p mix={mutedStyle}>No catalogued chemistry links.</p>}
                <div mix={characterActionsStyle}>
                  {mayPick ? <form action={routes.leagues.drafts.pick.href({ draftId: room.draft.id, leagueSlug: league.slug })} method="post">
                    <input type="hidden" name="characterId" value={character.characterId} />
                    <input type="hidden" name="expectedVersion" value={room.draft.version} />
                    <button type="submit" mix={buttonStyle}>Draft {character.displayName}</button>
                  </form> : null}
                  {managedTeam && !room.queue.includes(character.characterId) && !['completed', 'cancelled'].includes(room.draft.status)
                    ? <QueueForm action="add" characterId={character.characterId} league={league} room={room} teamId={managedTeam.teamId} />
                    : null}
                </div>
              </article>
            ))}
            {!room.characters.length ? <p mix={emptyStyle}>Every eligible character has been selected.</p> : null}
          </div>
        </section>

        <section mix={sectionStyle} aria-labelledby="history-heading">
          <div mix={sectionHeadingStyle}><h2 id="history-heading">Pick history</h2><span mix={countStyle}>{room.picks.length} records</span></div>
          <ol reversed mix={historyStyle}>
            {[...room.picks].reverse().map((pick) => <li data-status={pick.status}><span>#{pick.pickNumber}</span><strong>{pick.characterName}</strong><span>{pick.teamName}</span><small>{pick.source}{pick.status === 'reversed' ? ` · reversed: ${pick.reason}` : ''}</small></li>)}
          </ol>
          {!room.picks.length ? <p mix={emptyStyle}>The first committed pick will appear here for every reconnecting manager.</p> : null}
        </section>
      </AppShell>
    )
  }
}

function CommissionerControls(handle: Handle<{ league: LeagueDetail; room: DraftRoom }>) {
  return () => {
    let { league, room } = handle.props
    let routeParams = { draftId: room.draft.id, leagueSlug: league.slug }
    return <div mix={controlStyle}>
      {room.draft.status === 'setup' ? <form action={routes.leagues.drafts.start.href(routeParams)} method="post"><button mix={buttonStyle}>Start draft</button></form> : null}
      {room.draft.status === 'active' ? <>
        <form action={routes.leagues.drafts.pause.href(routeParams)} method="post"><button mix={secondaryButtonStyle}>Pause</button></form>
        <form action={routes.leagues.drafts.automaticPick.href(routeParams)} method="post"><button mix={secondaryButtonStyle}>Resolve expired clock</button></form>
      </> : null}
      {room.draft.status === 'paused' ? <form action={routes.leagues.drafts.resume.href(routeParams)} method="post"><button mix={buttonStyle}>Resume</button></form> : null}
      {room.picks.some((pick) => pick.status === 'active') && ['active', 'paused'].includes(room.draft.status) ? <form action={routes.leagues.drafts.reversePick.href(routeParams)} method="post" mix={reverseFormStyle}>
        <input name="reason" required placeholder="Reason for reversing latest pick" mix={inputStyle} />
        <button mix={dangerButtonStyle}>Reverse latest</button>
      </form> : null}
    </div>
  }
}

function QueueForm(handle: Handle<{
  action: 'add' | 'remove'
  characterId: string
  league: LeagueDetail
  room: DraftRoom
  teamId: string
}>) {
  return () => {
    let { action, characterId, league, room, teamId } = handle.props
    let nextQueue = action === 'add'
      ? [...room.queue, characterId]
      : room.queue.filter((candidate) => candidate !== characterId)
    return <form action={routes.leagues.drafts.updateQueue.href({ draftId: room.draft.id, leagueSlug: league.slug, teamId })} method="post">
      {nextQueue.map((queuedId) => <input type="hidden" name="characterId" value={queuedId} />)}
      <button mix={queueButtonStyle}>{action === 'add' ? 'Add to queue' : 'Remove'}</button>
    </form>
  }
}

const draftStatLabels = [
  'Displayed batting',
  'Displayed pitching',
  'Displayed fielding',
  'Displayed speed',
  'Slap power',
  'Charge power',
] as const

function visibleStats(character: DraftCharacter) {
  if (character.stats?.length) {
    let byLabel = new Map(character.stats.map((stat) => [stat.label, stat]))
    return draftStatLabels.flatMap((label) => byLabel.get(label) ?? [])
  }
  return Object.entries(character.values).slice(0, 6).map(([key, value]) => ({
    label: key.replaceAll('-', ' ').replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()),
    value,
  }))
}

const heroStyle = css({ alignItems: 'baseline', display: 'flex', gap: '16px', '& span': { color: 'var(--text-muted)' } })
const headingStyle = css({ fontFamily: 'var(--font-display)', fontSize: 'clamp(34px, 5vw, 48px)', lineHeight: 1.08, margin: 0 })
const errorStyle = css({ background: 'var(--danger-surface)', border: '1px solid var(--danger-border)', borderRadius: '12px', marginTop: '28px', padding: '14px 18px' })
const mutedStyle = css({ color: 'var(--text-muted)', lineHeight: 1.5, margin: 0 })
const sectionStyle = css({ marginTop: '56px' })
const sectionHeadingStyle = css({ alignItems: 'end', display: 'flex', gap: '20px', justifyContent: 'space-between', marginBottom: '18px', '& h2': { fontSize: '36px', margin: 0 } })
const countStyle = css({ color: 'var(--text-muted)', fontWeight: 800 })
const cardGridStyle = css({ display: 'grid', gap: '18px', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 270px), 1fr))' })
const draftLinkStyle = css({ color: 'var(--text-primary) !important', display: 'grid', gap: '8px', textDecoration: 'none', '& h3': { fontSize: '24px', margin: 0 }, '& p, & small': { color: 'var(--text-muted)', margin: 0 }, '&:hover': { borderColor: 'var(--link)', transform: 'translateY(-2px)' } })
const statusStyle = css({ background: 'var(--surface-strong)', borderRadius: '999px', color: 'var(--text-soft)', fontSize: '12px', fontWeight: 900, justifySelf: 'start', padding: '5px 9px', textTransform: 'uppercase' })
const emptyStyle = css({ border: '1px dashed var(--border-strong)', borderRadius: '14px', color: 'var(--text-muted)', padding: '22px' })
const createCardStyle = css({ display: 'grid', gap: '24px', marginBottom: '20px' })
const formStyle = css({ display: 'grid', gap: '16px', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 220px), 1fr))', '& label': { display: 'grid', gap: '7px', fontWeight: 700 } })
const wideStyle = css({ gridColumn: '1 / -1' })
const slotFieldsetStyle = css({ border: '1px solid var(--border-strong)', borderRadius: '12px', display: 'grid', gap: '12px', gridColumn: '1 / -1', padding: '18px', '& legend': { fontWeight: 900, padding: '0 8px' } })
const clockCardStyle = css({ alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: '28px', justifyContent: 'space-between', marginTop: '36px', '& h2': { fontSize: '32px', margin: '0 0 6px' } })
const controlStyle = css({ alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: '10px' })
const secondaryButtonStyle = css({ background: 'var(--surface-strong)', border: '1px solid var(--border-strong)', borderRadius: '10px', color: 'var(--text-primary)', cursor: 'pointer', font: 'inherit', fontWeight: 800, padding: '10px 14px' })
const dangerButtonStyle = css({ background: 'var(--danger-button)', border: '1px solid var(--danger-border)', borderRadius: '10px', color: 'var(--text-primary)', cursor: 'pointer', font: 'inherit', fontWeight: 800, padding: '10px 14px' })
const reverseFormStyle = css({ display: 'flex', flex: '1 1 360px', gap: '8px' })
const slotListStyle = css({ display: 'grid', gap: '10px', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 190px), 1fr))', listStyle: 'none', margin: 0, padding: 0 })
const slotStyle = css({ alignItems: 'center', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '12px', display: 'grid', gap: '8px', gridTemplateColumns: '28px 1fr', padding: '14px', '& > span': { color: 'var(--accent-yellow)', fontWeight: 900 }, '& small': { color: 'var(--text-muted)', gridColumn: '2' } })
const queueStyle = css({ display: 'grid', gap: '18px', marginTop: '40px' })
const queueListStyle = css({ display: 'grid', gap: '8px', margin: 0, paddingLeft: '24px', '& li': { alignItems: 'center', display: 'flex', gap: '12px', justifyContent: 'space-between' } })
const queueButtonStyle = css({ background: 'transparent', border: '1px solid var(--border-strong)', borderRadius: '8px', color: 'var(--link)', cursor: 'pointer', font: 'inherit', fontWeight: 700, padding: '7px 10px' })
const characterGridStyle = css({ display: 'grid', gap: '18px', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 300px), 1fr))' })
const characterCardStyle = css({ display: 'grid', gap: '18px' })
const characterHeadingStyle = css({ alignItems: 'center', display: 'flex', gap: '10px', justifyContent: 'space-between', '& h3': { fontSize: '25px', margin: 0 } })
const characterIdentityStyle = css({ alignItems: 'center', display: 'flex', gap: '10px', minWidth: 0, '& img': { height: '42px', objectFit: 'contain', width: '42px' } })
const captainStyle = css({ background: 'var(--warning-surface)', border: '1px solid var(--warning-border)', borderRadius: '999px', color: 'var(--warning-text)', fontSize: '11px', fontWeight: 900, padding: '5px 8px', textTransform: 'uppercase' })
const statsStyle = css({ display: 'grid', gap: '8px', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', margin: 0, '& div': { background: 'var(--surface-deep)', borderRadius: '8px', padding: '9px' }, '& dt': { color: 'var(--text-muted)', fontSize: '11px', textTransform: 'uppercase' }, '& dd': { fontSize: '18px', fontWeight: 900, margin: '3px 0 0' } })
const chemistryStyle = css({ display: 'flex', flexWrap: 'wrap', gap: '7px', '& span': { borderRadius: '999px', fontSize: '12px', padding: '5px 8px' }, '& [data-relationship="positive"]': { background: 'var(--success-surface)', color: 'var(--success-text)' }, '& [data-relationship="negative"]': { background: 'var(--danger-surface)', color: 'var(--danger-text)' } })
const characterActionsStyle = css({ alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: '10px' })
const historyStyle = css({ display: 'grid', gap: '8px', listStyle: 'none', margin: 0, padding: 0, '& li': { alignItems: 'center', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '10px', display: 'grid', gap: '10px', gridTemplateColumns: '58px minmax(140px, 1fr) minmax(140px, 1fr) minmax(120px, auto)', padding: '12px 14px' }, '& li[data-status="reversed"]': { opacity: 0.58, textDecoration: 'line-through' }, '& small': { color: 'var(--text-muted)' }, '@media (max-width: 680px)': { '& li': { gridTemplateColumns: '48px 1fr' }, '& li > :nth-child(n+3)': { gridColumn: '2' } } })
