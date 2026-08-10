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
  }),
})
