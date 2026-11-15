import type { Handle } from 'remix/ui'
import { css } from 'remix/ui'

import type { StatProfileRevisionDetail } from '../configuration/service.ts'
import {
  STAT_EDITOR_TUNING_LABELS,
  STAT_EDITOR_TUNING_SECTIONS,
} from '../configuration/stat-editor-tuning.ts'
import type { LeagueDetail, SessionIdentity } from '../platform/model.ts'
import { routes } from '../routes.ts'
import { cardStyle } from './app-shell.tsx'
import {
  IssueList,
  RevisionActions,
  RevisionHistory,
  RevisionShell,
  sectionHeadingStyle,
} from './revision-page.tsx'

interface StatProfileRevisionPageProps {
  detail: StatProfileRevisionDetail
  identity: SessionIdentity
  league: LeagueDetail
}

export function StatProfileRevisionPage(handle: Handle<StatProfileRevisionPageProps>) {
  return () => {
    let { detail, identity, league } = handle.props
    let revision = detail.revision
    let routeParams = { leagueSlug: league.slug, revisionId: revision.revisionId }
    return (
      <RevisionShell
        identity={identity}
        league={league}
        heading={revision.name}
        kind="Stat profile"
        returnHref={routes.leagues.configuration.statProfiles.index.href({ leagueSlug: league.slug })}
        returnLabel="Back to stats"
        revisionNumber={revision.revisionNumber}
        status={revision.status}
      >
        <IssueList issues={detail.issues.map((issue) => `${issue.code} · ${issue.path}`)} />
        <section mix={sectionStyle} aria-labelledby="profile-sections-heading">
          <div mix={sectionTitleStyle}>
            <h2 id="profile-sections-heading" mix={sectionHeadingStyle}>Profile sections</h2>
            {revision.sluggersTuning ? <a href={routes.leagues.configuration.statProfiles.revision.export.href(routeParams)}>Export Stat Editor v4</a> : null}
          </div>
          <div mix={sectionGridStyle}>
            <a href={routes.leagues.configuration.statProfiles.revision.characters.href(routeParams)} mix={[cardStyle, sectionLinkStyle]}>
              <strong>Characters</strong>
              <span>{revision.characterValues.length} players · {revision.definitions.length} fields each</span>
            </a>
            {revision.sluggersTuning ? STAT_EDITOR_TUNING_SECTIONS.map((section) => (
              <a
                href={routes.leagues.configuration.statProfiles.revision.tuning.edit.href({
                  leagueSlug: league.slug,
                  revisionId: revision.revisionId,
                  section,
                })}
                mix={[cardStyle, sectionLinkStyle]}
              >
                <strong>{STAT_EDITOR_TUNING_LABELS[section]}</strong>
                <span>{tuningSectionDetail(section)}</span>
              </a>
            )) : null}
          </div>
        </section>
        <RevisionActions
          cloneAction={routes.leagues.configuration.statProfiles.revision.clone.href(routeParams)}
          publishAction={routes.leagues.configuration.statProfiles.revision.publish.href(routeParams)}
          status={revision.status}
        />
        <RevisionHistory rows={detail.history} />
      </RevisionShell>
    )
  }
}

function tuningSectionDetail(section: typeof STAT_EDITOR_TUNING_SECTIONS[number]): string {
  switch (section) {
    case 'chemistry': return 'Character relationships'
    case 'trajectories': return 'Contact and height tables'
    case 'speed-curves': return 'Baserunning and fielding speed'
    case 'star-events': return 'Team star gains and losses'
    case 'star-boosts': return 'Star action stat effects'
    case 'handicaps': return 'Comeback multipliers'
  }
}

const sectionStyle = css({ display: 'grid', gap: '18px' })
const sectionTitleStyle = css({ alignItems: 'baseline', display: 'flex', justifyContent: 'space-between' })
const sectionGridStyle = css({ display: 'grid', gap: '12px', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))' })
const sectionLinkStyle = css({ color: 'var(--text-primary) !important', display: 'grid', gap: '5px', textDecoration: 'none', '& strong': { fontFamily: 'var(--font-display)', fontSize: '19px' }, '& span': { color: 'var(--text-muted)', fontSize: '13px' }, '&:hover': { borderColor: 'var(--border-strong)', transform: 'translateY(-1px)' } })
