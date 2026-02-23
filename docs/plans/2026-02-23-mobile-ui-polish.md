# Mobile UI Polish Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make the app usable on mobile screens. The gh issue specifically calls out the lineup component, but a general skim is needed.

**Architecture:** Audit all major pages for mobile breakpoints and fix layout issues. Currently there are very few responsive utilities in the codebase — the Nav has `flex-col lg:flex-row`, PlayerInfo has `md:grid-cols-2`, and trading pages have some `lg:` breakpoints. The field grid (`.field` in `app.css`) uses a fixed 5-column grid with no responsive variant. The lineup component's field visualization will need the most attention.

**Tech Stack:** Tailwind CSS responsive utilities, CSS grid.

**Ticket:** gh-75

**Open questions for review:**
- What's the target minimum screen width? 375px (iPhone SE) or 390px (iPhone 14)?
- Should the field visualization scale down or switch to an alternate layout on mobile (e.g. a list instead of a diamond)?
- Should the admin pages be mobile-friendly or is desktop-only acceptable for admin?
- Is there a specific page that's the highest priority mobile fix?

---

### Task 1: Audit all pages on mobile viewport

Systematically check each major route at ~375px width and document what's broken:
- `/` (home) — standings table, leaderboard preview
- `/matches` — match day cards, standings table
- `/match/:id` — team lineups side by side
- `/teams` — team cards with field diagrams
- `/team/:id` — lineup + player lists side by side
- `/players` — leaderboard table (horizontal scroll)
- `/player/:id` — player info grid
- `/trading`, `/trade-with` — trading grids
- `/drafting` — draft grid

### Task 2: Fix the Lineup/Field component for mobile

**Files:**
- Modify: `app/app.css` (`.field` grid)
- Possibly modify: `app/components/Lineup.tsx`

The `.field` class uses a fixed 5-column grid. Options:
- Scale the entire field down with `transform: scale()` on small screens
- Use a smaller grid with tighter gaps
- Use `@container` queries if supported

### Task 3: Fix team page layout

**Files:**
- Modify: `app/routes/team.tsx`

The team page has `flex-row items-center gap-16` for the lineup + player list. On mobile this needs to stack vertically.

### Task 4: Fix navigation for mobile

**Files:**
- Modify: `app/components/Nav.tsx`

The Nav already has `flex-col lg:flex-row` but may need a hamburger menu or collapsible behavior for small screens.

### Task 5: Fix match page side-by-side layouts

**Files:**
- Modify: `app/routes/match.tsx`

Team lineups shown side by side need to stack on mobile.

### Task 6: Ensure tables have horizontal scroll

All tables (standings, leaderboard, player stats) should have `overflow-x-auto` on their containers so they scroll horizontally on mobile rather than breaking layout.
