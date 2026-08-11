import { get, post, route } from 'remix/routes'

export const routes = route({
  assets: get('/assets/*path'),
  broadcastData: get('/api/v1/public/leagues/:leagueSlug/matches/:matchId/overlay'),
  broadcastOverlay: get('/overlays/:leagueSlug/matches/:matchId'),
  home: '/',
  system: {
    health: get('/healthz'),
    metrics: get('/internal/metrics'),
    ready: get('/readyz'),
  },
  auth: route('auth', {
    discord: get('discord'),
    discordCallback: get('discord/callback'),
    localDemo: get('local-demo'),
    logout: post('logout'),
  }),
  admin: route('admin', {
    newLeague: get('leagues/new'),
    createLeague: post('leagues/new'),
  }),
  runnerApi: route('api/v1/runner', {
    register: post('register'),
    heartbeat: post('heartbeat'),
    claim: post('claim'),
    configuration: get('attempts/:attemptId/configuration'),
    asset: get('attempts/:attemptId/assets/:sha256'),
    telemetry: post('attempts/:attemptId/telemetry'),
    updateLease: post('leases/:leaseId'),
  }),
  leagues: route('leagues', {
    show: get(':leagueSlug'),
    operations: route(':leagueSlug/operations', {
      matches: {
        index: get('/'),
        schedule: post('matches'),
        queueAttempt: post('matches/:matchId/attempts'),
      },
      results: {
        index: get('results'),
        derive: post('attempts/:attemptId/telemetry/derive'),
        correct: post('attempts/:attemptId/telemetry/corrections'),
        confirm: post('attempts/:attemptId/telemetry/confirm'),
      },
      teams: {
        index: get('teams'),
        setDeadline: post('deadlines'),
        proposeTrade: post('trades'),
        reviewTrade: post('trades/:proposalId/review'),
        cancelTrade: post('trades/:proposalId/cancel'),
      },
      admin: {
        index: get('admin'),
        updatePublication: post('publication'),
        configureDiscord: post('discord-notifications'),
        retryDiscord: post('discord-notifications/retry'),
        issueCredential: post('runner-credentials'),
        revokeStation: post('runner-stations/:stationId/revoke'),
      },
    }),
    content: route(':leagueSlug/content', {
      dashboard: get('/'),
      create: post('/'),
      uploadAsset: post('assets'),
      assignAsset: post('revisions/:revisionId/assets'),
      publish: post('revisions/:revisionId/publish'),
      clone: post('revisions/:revisionId/clone'),
    }),
    drafts: route(':leagueSlug/drafts', {
      dashboard: get('/'),
      create: post('/'),
      room: get(':draftId'),
      start: post(':draftId/start'),
      pick: post(':draftId/picks'),
      pause: post(':draftId/pause'),
      resume: post(':draftId/resume'),
      automaticPick: post(':draftId/automatic-pick'),
      reversePick: post(':draftId/reverse-pick'),
      updateQueue: post(':draftId/teams/:teamId/queue'),
    }),
    configuration: route(':leagueSlug/configuration', {
      dashboard: get('/'),
      statProfiles: route('stat-profiles', {
        index: get('/'),
        importStatEditor: post('import'),
        revision: route(':revisionId', {
          show: get('/'),
          characters: get('characters'),
          export: get('export'),
          publish: post('publish'),
          clone: post('clone'),
          character: route('characters/:characterId', {
            edit: get('/'),
            update: post('/'),
          }),
          tuning: route('tuning/:section', {
            edit: get('/'),
            update: post('/'),
          }),
        }),
      }),
      rulesets: route('rulesets', {
        index: get('/'),
        create: post('/'),
        revision: route(':revisionId', {
          show: get('/'),
          update: post('/'),
          publish: post('publish'),
          clone: post('clone'),
        }),
      }),
      teams: route('teams', {
        index: get('/'),
        importAutoTeam: post(':teamId/imports/auto-team'),
        lineup: route(':teamId/lineups/:revisionId', {
          show: get('/'),
          update: post('/'),
          publish: post('publish'),
          clone: post('clone'),
        }),
      }),
      preview: post('preview'),
    }),
  }),
})
