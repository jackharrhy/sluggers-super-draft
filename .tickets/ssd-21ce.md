---
id: ssd-21ce
status: open
deps: []
links: [ssd-ec8e]
created: 2026-02-23T01:41:31Z
type: feature
priority: 2
assignee: Jack Arthur Harrhy
tags: [ui, team-page]
---
# Add standings position to team page

Show the team's current standings position/rank on their individual team page (/team/:teamId).

## Acceptance Criteria

Team page header shows current standings rank (e.g. #1, #3)


## Notes

**2026-02-23T01:43:35Z**

Plan: docs/plans/2026-02-22-standings-position-on-team-page.md — Call getStandingsData() in team page loader, find team's index in sorted standings array, display rank as #N next to team name in header.
