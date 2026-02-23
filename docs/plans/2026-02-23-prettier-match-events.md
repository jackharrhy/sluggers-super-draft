# Prettier Match Events Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Improve the visual presentation of match state change events in the Events feed.

**Architecture:** Modify the `match_state_change` rendering block in `app/components/Events.tsx` (lines 410-503). Currently it shows: a colored label ("Match Started"/"Match Finished"), team names with winner highlighting, the score, and a LIVE badge. The improvements should make it feel more like a match card — potentially showing TeamLogos, better score layout, and more visual distinction between live/finished states.

**Tech Stack:** React, Tailwind CSS, existing TeamLogo component.

**Ticket:** gh-91

**Open questions for review:**
- Should it look similar to the MatchCard component used on the matches page, or have its own distinct event-feed style?
- Should it show the match location if available?
- Should finished matches show the video link if one exists?
- How much detail is too much for an event feed item? Should it stay compact or be more card-like?

---

### Task 1: Add TeamLogos to match events

**Files:**
- Modify: `app/components/Events.tsx:410-503`

Currently the match event just shows team names as text. Add `<TeamLogo size="xs">` next to each team name. This requires the match event data to include `captain` info — check if the `with` clause in event queries already includes this, or if we need to add `captain: true` to the `teamA`/`teamB` relations.

### Task 2: Improve score display

The score currently shows as plain text `teamAScore - teamBScore`. Improve to:
- Larger font for scores (`font-rodin`, `text-lg`)
- Winner's score in green, loser's in red (matching standings table pattern)
- Center the score between the two team names
- Use a layout similar to MatchCard: `TeamA [score - score] TeamB`

### Task 3: Better state badges

- "Match Finished" — green badge, show final score prominently
- "Match Started" / LIVE — pulsing orange/green badge (reuse existing animation or add subtle pulse)
- Consider adding the match day name (e.g. "Week 3") if available

### Task 4: Verify all event feed consumers

The Events component is used in:
- `/events` page
- `/` home page
- `/player/:playerId` page
- `/team/:teamId` page (newly added)

Verify the match event data shape is consistent across all these loaders. Some may need their event queries updated to include `captain` on teamA/teamB if we want TeamLogos.
