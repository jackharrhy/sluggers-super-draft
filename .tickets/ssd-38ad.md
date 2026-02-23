---
id: ssd-38ad
status: open
deps: []
links: []
created: 2026-02-23T01:41:40Z
type: feature
priority: 1
assignee: Jack Arthur Harrhy
tags: [ui, standings]
---
# Reorder standings table columns: stats before weeks

Reorder the standings table columns so that stats come before week-by-week results. New order: #, Team, W, L, +/-, RD, Week 1, Week 2, ... This prevents users from having to scroll past many week columns to see the summary stats on wider data sets.

## Acceptance Criteria

Standings table column order is: #, Team, W, L, +/-, RD, then all week columns. No horizontal scrolling needed to see core stats.


## Notes

**2026-02-23T01:43:40Z**

Plan: docs/plans/2026-02-22-reorder-standings-columns.md — Pure UI reorder in StandingsTable.tsx: move W/L/+/-/RD headers and cells to come right after Team, before week columns. Add border-l separator before first week column.
