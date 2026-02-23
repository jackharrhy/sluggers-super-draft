---
id: ssd-84a3
status: open
deps: []
links: []
created: 2026-02-23T15:03:56Z
type: bug
priority: 2
assignee: Jack Arthur Harrhy
external-ref: gh-85
tags: [trading, lineup]
---
# Swap field position when trading a non-benched player

When a trade is completed and the traded player has a fielding position (not benched), their field position should be swapped or handled gracefully rather than leaving a gap in the lineup.

## Acceptance Criteria

After a trade completes involving a player with a fielding position, the lineup remains valid (no empty positions on the field).

