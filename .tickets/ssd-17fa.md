---
id: ssd-17fa
status: open
deps: [ssd-2604]
links: [ssd-2604]
created: 2026-02-23T01:41:34Z
type: feature
priority: 1
assignee: Jack Arthur Harrhy
tags: [ui, conferences]
---
# Add conference color dots across the app

Add ConferencePin (conference colored dot) next to team/user names in more places throughout the app - standings table, team pages, teams listing, player pages, etc. Making conference affiliation visible everywhere.

## Acceptance Criteria

Conference dots appear next to team/user names across all major views: standings, team pages, teams index, teams names, and anywhere else team names are shown


## Notes

**2026-02-23T01:43:36Z**

Plan: docs/plans/2026-02-22-conference-dots-everywhere.md — Add conference:true to getTeamWithPlayers query, add ConferencePin to team page header, teams._index team cards, and teams.names team cards. Depends on ssd-2604 for standings dots.
