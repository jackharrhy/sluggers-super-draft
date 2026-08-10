import type { Handle } from 'remix/ui'
import { css } from 'remix/ui'

import type { DraftRoom, DraftSetupOptions } from '../draft/service.ts'
import type { LeagueDetail, SessionIdentity } from '../platform/model.ts'
import { administrativeRoles } from '../platform/repository.ts'
import { routes } from '../routes.ts'
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
      <AppShell identity={identity} title={`${league.name} drafts · Starworks`}>
        <header mix={heroStyle}>
          <div>
            <p mix={eyebrowStyle}>League draft room</p>
            <h1 mix={headingStyle}>{league.name} drafts</h1>
            <p mix={ledeStyle}>Configure the order once, then let the server own every turn, clock, pick, recovery action, and final roster.</p>
          </div>
          <WorkspaceLinks league={league} />
        </header>

        {error ? <p role="alert" mix={errorStyle}>{error}</p> : null}

        <section mix={sectionStyle} aria-labelledby="drafts-heading">
          <div mix={sectionHeadingStyle}>
            <div><p mix={eyebrowStyle}>Rooms</p><h2 id="drafts-heading">Drafts</h2></div>
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
              <div><p mix={eyebrowStyle}>Commissioner setup</p><h2 id="create-heading">Create a draft</h2></div>
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
                  <label>Order mode<select name="orderMode" defaultValue="snake" mix={inputStyle}>
                    <option value="snake">Snake</option>
                    <option value="linear">Linear</option>
                  </select></label>
                  <label>Rounds<input type="number" name="rounds" min="1" max="18" defaultValue="9" required mix={inputStyle} /></label>
                  <label>Seconds per pick<input type="number" name="pickSeconds" min="15" max="86400" defaultValue="120" required mix={inputStyle} /></label>
                  <fieldset mix={slotFieldsetStyle}>
                    <legend>Ordered team slots</legend>
                    <p mix={mutedStyle}>Choose each team once. The numbered controls define round-one order.</p>
                    {season.teams.map((_, index) => (
                      <label>Slot {index + 1}<select name="slotTeamIds" defaultValue={season.teams[index]?.id} mix={inputStyle}>
                        <option value="">Unused</option>
                        {season.teams.map((team) => <option value={team.id}>{team.name}</option>)}
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
      <AppShell identity={identity} title={`${room.draft.name} · Starworks`}>
        <header mix={heroStyle}>
          <div>
            <p mix={eyebrowStyle}>{room.draft.status} · {room.draft.orderMode} order</p>
            <h1 mix={headingStyle}>{room.draft.name}</h1>
            <p mix={ledeStyle}>{currentTeam ? `${currentTeam.teamName} owns pick ${room.draft.currentPickNumber}.` : `${activePicks.length} picks are locked into published rosters.`}</p>
          </div>
          <WorkspaceLinks league={league} />
        </header>

        {error ? <p role="alert" mix={errorStyle}>{error}</p> : null}

        <section mix={[cardStyle, clockCardStyle]} aria-labelledby="clock-heading">
          <div>
            <p mix={eyebrowStyle}>Draft clock</p>
            <h2 id="clock-heading">{currentTeam?.teamName ?? 'Draft complete'}</h2>
            <p mix={mutedStyle}>{room.draft.deadline ? `Deadline ${room.draft.deadline.toLocaleTimeString()}` : room.draft.status === 'paused' ? 'Clock paused' : `${activePicks.length} of ${room.draft.totalPicks} selections`}</p>
          </div>
          {mayAdminister ? <CommissionerControls league={league} room={room} /> : null}
        </section>

        <section mix={sectionStyle} aria-labelledby="order-heading">
          <div mix={sectionHeadingStyle}><div><p mix={eyebrowStyle}>Order</p><h2 id="order-heading">Team slots</h2></div><span mix={countStyle}>{room.draft.rounds} rounds</span></div>
          <ol mix={slotListStyle}>
            {room.slots.map((slot) => {
              let count = activePicks.filter((pick) => pick.teamId === slot.teamId).length
              return <li mix={slotStyle}><span>{slot.position}</span><strong>{slot.teamName}</strong><small>{count} picked</small></li>
            })}
          </ol>
        </section>

        {managedTeam && !['completed', 'cancelled'].includes(room.draft.status) ? (
          <section mix={[cardStyle, queueStyle]} aria-labelledby="queue-heading">
            <div><p mix={eyebrowStyle}>Private to your team</p><h2 id="queue-heading">{managedTeam.teamName} queue</h2></div>
            {room.queue.length ? <ol mix={queueListStyle}>{room.queue.map((characterId, index) => {
              let character = room.characters.find((candidate) => candidate.characterId === characterId)
              return <li><span>{index + 1}. {character?.displayName ?? characterId}</span><QueueForm action="remove" characterId={characterId} league={league} room={room} teamId={managedTeam.teamId} /></li>
            })}</ol> : <p mix={mutedStyle}>Queue a character from the available pool. Expired clocks choose the first available entry.</p>}
          </section>
        ) : null}

        <section mix={sectionStyle} aria-labelledby="available-heading">
          <div mix={sectionHeadingStyle}>
            <div><p mix={eyebrowStyle}>Published stat profile</p><h2 id="available-heading">Available characters</h2></div>
            <span mix={countStyle}>{room.characters.length} remaining</span>
          </div>
          <div mix={characterGridStyle}>
            {room.characters.map((character) => (
              <article mix={[cardStyle, characterCardStyle]}>
                <div mix={characterHeadingStyle}>
                  <h3>{character.displayName}</h3>
                  {character.isCaptain ? <span mix={captainStyle}>Captain</span> : null}
                </div>
                <dl mix={statsStyle}>{Object.entries(character.values).slice(0, 6).map(([key, value]) => <div><dt>{formatKey(key)}</dt><dd>{String(value ?? '—')}</dd></div>)}</dl>
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
          <div mix={sectionHeadingStyle}><div><p mix={eyebrowStyle}>Append-only record</p><h2 id="history-heading">Pick history</h2></div><span mix={countStyle}>{room.picks.length} records</span></div>
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

function WorkspaceLinks(handle: Handle<{ league: LeagueDetail }>) {
  return () => <nav mix={linkRowStyle} aria-label="League workspaces">
    <a href={routes.leagues.show.href({ leagueSlug: handle.props.league.slug })}>League home</a>
    <a href={routes.leagues.configuration.dashboard.href({ leagueSlug: handle.props.league.slug })}>Configuration</a>
    <a href={routes.leagues.operations.dashboard.href({ leagueSlug: handle.props.league.slug })}>Match operations</a>
  </nav>
}

function formatKey(key: string): string {
  return key.replaceAll('-', ' ').replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
}

const heroStyle = css({ display: 'grid', gap: '24px' })
const eyebrowStyle = css({ color: '#f7c948', fontSize: '12px', fontWeight: 900, letterSpacing: '0.14em', margin: '0 0 8px', textTransform: 'uppercase' })
const headingStyle = css({ fontSize: 'clamp(42px, 7vw, 72px)', letterSpacing: '-0.06em', lineHeight: 0.95, margin: 0 })
const ledeStyle = css({ color: '#c9d4e9', fontSize: '18px', lineHeight: 1.6, maxWidth: '780px' })
const linkRowStyle = css({ display: 'flex', flexWrap: 'wrap', gap: '18px' })
const errorStyle = css({ background: '#4b1822', border: '1px solid #d75b70', borderRadius: '12px', marginTop: '28px', padding: '14px 18px' })
const mutedStyle = css({ color: '#9faec8', lineHeight: 1.5, margin: 0 })
const sectionStyle = css({ marginTop: '56px' })
const sectionHeadingStyle = css({ alignItems: 'end', display: 'flex', gap: '20px', justifyContent: 'space-between', marginBottom: '18px', '& h2': { fontSize: '36px', margin: 0 } })
const countStyle = css({ color: '#9faec8', fontWeight: 800 })
const cardGridStyle = css({ display: 'grid', gap: '18px', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 270px), 1fr))' })
const draftLinkStyle = css({ color: '#f7f2e8 !important', display: 'grid', gap: '8px', textDecoration: 'none', '& h3': { fontSize: '24px', margin: 0 }, '& p, & small': { color: '#9faec8', margin: 0 }, '&:hover': { borderColor: '#78d5ff', transform: 'translateY(-2px)' } })
const statusStyle = css({ background: '#253553', borderRadius: '999px', color: '#c9d4e9', fontSize: '12px', fontWeight: 900, justifySelf: 'start', padding: '5px 9px', textTransform: 'uppercase' })
const emptyStyle = css({ border: '1px dashed #445171', borderRadius: '14px', color: '#9faec8', padding: '22px' })
const createCardStyle = css({ display: 'grid', gap: '24px', marginBottom: '20px' })
const formStyle = css({ display: 'grid', gap: '16px', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 220px), 1fr))', '& label': { display: 'grid', gap: '7px', fontWeight: 700 } })
const wideStyle = css({ gridColumn: '1 / -1' })
const slotFieldsetStyle = css({ border: '1px solid #445171', borderRadius: '12px', display: 'grid', gap: '12px', gridColumn: '1 / -1', padding: '18px', '& legend': { fontWeight: 900, padding: '0 8px' } })
const clockCardStyle = css({ alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: '28px', justifyContent: 'space-between', marginTop: '36px', '& h2': { fontSize: '32px', margin: '0 0 6px' } })
const controlStyle = css({ alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: '10px' })
const secondaryButtonStyle = css({ background: '#253553', border: '1px solid #445171', borderRadius: '10px', color: '#f7f2e8', cursor: 'pointer', font: 'inherit', fontWeight: 800, padding: '10px 14px' })
const dangerButtonStyle = css({ background: '#7d2433', border: '1px solid #c44d61', borderRadius: '10px', color: '#fff', cursor: 'pointer', font: 'inherit', fontWeight: 800, padding: '10px 14px' })
const reverseFormStyle = css({ display: 'flex', flex: '1 1 360px', gap: '8px' })
const slotListStyle = css({ display: 'grid', gap: '10px', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 190px), 1fr))', listStyle: 'none', margin: 0, padding: 0 })
const slotStyle = css({ alignItems: 'center', background: '#151c2d', border: '1px solid #2d3955', borderRadius: '12px', display: 'grid', gap: '8px', gridTemplateColumns: '28px 1fr', padding: '14px', '& > span': { color: '#f7c948', fontWeight: 900 }, '& small': { color: '#9faec8', gridColumn: '2' } })
const queueStyle = css({ display: 'grid', gap: '18px', marginTop: '40px' })
const queueListStyle = css({ display: 'grid', gap: '8px', margin: 0, paddingLeft: '24px', '& li': { alignItems: 'center', display: 'flex', gap: '12px', justifyContent: 'space-between' } })
const queueButtonStyle = css({ background: 'transparent', border: '1px solid #445171', borderRadius: '8px', color: '#78d5ff', cursor: 'pointer', font: 'inherit', fontWeight: 700, padding: '7px 10px' })
const characterGridStyle = css({ display: 'grid', gap: '18px', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 300px), 1fr))' })
const characterCardStyle = css({ display: 'grid', gap: '18px' })
const characterHeadingStyle = css({ alignItems: 'center', display: 'flex', gap: '10px', justifyContent: 'space-between', '& h3': { fontSize: '25px', margin: 0 } })
const captainStyle = css({ background: '#503f0c', border: '1px solid #98791e', borderRadius: '999px', color: '#ffe58a', fontSize: '11px', fontWeight: 900, padding: '5px 8px', textTransform: 'uppercase' })
const statsStyle = css({ display: 'grid', gap: '8px', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', margin: 0, '& div': { background: '#0c1220', borderRadius: '8px', padding: '9px' }, '& dt': { color: '#9faec8', fontSize: '11px', textTransform: 'uppercase' }, '& dd': { fontSize: '18px', fontWeight: 900, margin: '3px 0 0' } })
const chemistryStyle = css({ display: 'flex', flexWrap: 'wrap', gap: '7px', '& span': { borderRadius: '999px', fontSize: '12px', padding: '5px 8px' }, '& [data-relationship="positive"]': { background: '#123d32', color: '#8ee0bd' }, '& [data-relationship="negative"]': { background: '#4b1822', color: '#ff9cac' } })
const characterActionsStyle = css({ alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: '10px' })
const historyStyle = css({ display: 'grid', gap: '8px', listStyle: 'none', margin: 0, padding: 0, '& li': { alignItems: 'center', background: '#151c2d', border: '1px solid #2d3955', borderRadius: '10px', display: 'grid', gap: '10px', gridTemplateColumns: '58px minmax(140px, 1fr) minmax(140px, 1fr) minmax(120px, auto)', padding: '12px 14px' }, '& li[data-status="reversed"]': { opacity: 0.58, textDecoration: 'line-through' }, '& small': { color: '#9faec8' }, '@media (max-width: 680px)': { '& li': { gridTemplateColumns: '48px 1fr' }, '& li > :nth-child(n+3)': { gridColumn: '2' } } })
