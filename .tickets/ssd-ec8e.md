---
id: ssd-ec8e
status: open
deps: []
links: [ssd-21ce]
created: 2026-02-23T01:41:36Z
type: feature
priority: 1
assignee: Jack Arthur Harrhy
tags: [ui, team-page, matches]
---
# Add match history to team page

Show a team's match history on their team page (/team/:teamId), including their overall record (W-L) and individual match results with scores.

## Acceptance Criteria

Team page shows: overall record (e.g. 5-2), list of match results with opponent, scores, and win/loss indicator


## Notes

**2026-02-23T01:43:38Z**

Plan: docs/plans/2026-02-22-team-match-history.md — Query finished matches for the team in loader, process into match history with W/L/scores/opponent info, render as a compact linked list showing record + individual results.
