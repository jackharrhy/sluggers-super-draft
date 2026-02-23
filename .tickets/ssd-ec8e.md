---
id: ssd-ec8e
status: closed
deps: []
links: [ssd-21ce, ssd-1292]
created: 2026-02-23T01:41:36Z
type: feature
priority: 1
assignee: Jack Arthur Harrhy
tags: [ui, team-page, events]
---
# Add event log to team page

Add an event feed to the team page (/team/:teamId), showing all events related to that team — drafts, trades, match results, trade preference updates. Same pattern as the player page's "Player History" section, but filtered to events involving the team.

## Acceptance Criteria

Team page shows a chronological event feed (newest first) of all events involving the team, using the existing Events component.

## Notes

**2026-02-23T01:43:38Z**

Plan: docs/plans/2026-02-22-team-match-history.md — Query finished matches for the team in loader, process into match history with W/L/scores/opponent info, render as a compact linked list showing record + individual results.

**2026-02-23 (updated)**

Scope changed: instead of a custom match history UI, reuse the Events component to show all team-related events (drafts, trades, match state changes, trade preference updates). Follow the same pattern as the player page's event query but filter by teamId instead of playerId.
