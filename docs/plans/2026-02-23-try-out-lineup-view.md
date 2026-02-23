# 'Try Out' Lineup View Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a sandbox lineup builder where users can experiment with lineups and see chemistry effects without saving anything.

**Architecture:** New route (`/try-out` or `/sandbox`) with a modified version of the LineupEditor that operates purely client-side. No form submission, no server actions — just loaders for player/team data. The existing LineupEditor uses `<select>` dropdowns for positions and batting order with swap logic, plus a `<Lineup>` preview (field + batting order). This sandbox would reuse the same patterns but with additional features: prefill from logged-in user's team, load any team's lineup, and a clear button.

**Tech Stack:** React Router (loader only, no action), existing LineupEditor patterns, existing Lineup component, Zustand (already in deps) or local state.

**Ticket:** gh-90

**Open questions for review:**
- Should this be a standalone route (`/try-out`) or a tab under `/teams`?
- Should chemistry visualization be shown inline (e.g. highlight positive/negative pairs on the field)?
- Should all players in the league be available to add, or only players from a specific team?
- The issue says "see player list on the right, click on them, add to bench" — this implies a different UX from the current LineupEditor which uses dropdowns. Do we want a click-to-add player list instead of the dropdown approach?

---

### Task 1: Create the route and loader

**Files:**
- Create: `app/routes/try-out.tsx`
- Modify: `app/routes.ts` (add route)

The loader should:
- Fetch all players (or all teams with players) so users can pick from any team
- If user is logged in, fetch their team's current lineup for prefill
- Return player data, team data, and optional prefilled lineup

### Task 2: Build the sandbox lineup editor component

**Files:**
- Create: `app/components/SandboxLineupEditor.tsx` (or extend LineupEditor)

Based on the existing LineupEditor (`app/components/LineupEditor.tsx`), but:
- No `<Form>` submission — purely local state
- Player list panel on the right showing all available players (click to add to bench)
- "Clear Lineup" button that resets all positions
- "Load Team Lineup" dropdown that loads a specific team's lineup
- Same position/batting order swap logic from LineupEditor
- Same `<Lineup>` preview component for the field visualization

### Task 3: Add chemistry display (stretch)

Show positive/negative chemistry indicators between players in the current lineup, using existing chemistry data from the DB. Could highlight pairs on the field or show a summary.

### Task 4: Add navigation link

Add a link to the try-out page in the nav bar or under the players/teams section.
