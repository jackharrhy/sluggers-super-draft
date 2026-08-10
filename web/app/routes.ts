import { get, post, route } from 'remix/routes'

export const routes = route({
  assets: get('/assets/*path'),
  home: '/',
  auth: route('auth', {
    discord: get('discord'),
    discordCallback: get('discord/callback'),
    logout: post('logout'),
  }),
  admin: route('admin', {
    newLeague: get('leagues/new'),
    createLeague: post('leagues/new'),
  }),
  leagues: route('leagues', {
    show: get(':leagueSlug'),
    updatePublication: post(':leagueSlug/publication'),
    configuration: route(':leagueSlug/configuration', {
      dashboard: get('/'),
      preview: post('preview'),
      createStatProfile: post('stat-profiles'),
      importStatEditor: post('imports/stat-editor-v4'),
      showStatProfile: get('stat-profiles/:revisionId'),
      updateStatProfile: post('stat-profiles/:revisionId'),
      publishStatProfile: post('stat-profiles/:revisionId/publish'),
      cloneStatProfile: post('stat-profiles/:revisionId/clone'),
      createRuleset: post('rulesets'),
      showRuleset: get('rulesets/:revisionId'),
      updateRuleset: post('rulesets/:revisionId'),
      publishRuleset: post('rulesets/:revisionId/publish'),
      cloneRuleset: post('rulesets/:revisionId/clone'),
      createLineup: post('teams/:teamId/lineups'),
      importAutoTeam: post('teams/:teamId/imports/auto-team'),
      showLineup: get('teams/:teamId/lineups/:revisionId'),
      updateLineup: post('teams/:teamId/lineups/:revisionId'),
      publishLineup: post('teams/:teamId/lineups/:revisionId/publish'),
      cloneLineup: post('teams/:teamId/lineups/:revisionId/clone'),
    }),
  }),
})
