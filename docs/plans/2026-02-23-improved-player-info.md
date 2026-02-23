# Improved Player Info View Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Improve the player info/stats display to be more visually similar to the game, with green/red coloring to show what stats matter, based on "Andrew's formula."

**Architecture:** The current `PlayerInfo` component (`app/components/PlayerInfo.tsx`) displays raw stat values in a grid of labeled rows. The `stat` table has both raw gameplay stats (e.g. `slapHitPower`, `chargeHitContactSize`, `stamina`) and CSS display values (`pitchingCss`, `battingCss`, `fieldingCss`, `speedCss`) which are the game's visual stat bars.

The improvement would:
1. Use green/red color coding to indicate whether a stat is good or bad (high is green, low is red, with a gradient)
2. Potentially show stat bars (like the game does) for the CSS display values
3. Highlight which stats matter most for each character class or position

**Tech Stack:** React, Tailwind CSS. No external charting library needed — simple colored bars or text coloring.

**Ticket:** gh-20

**Open questions for review:**
- What is "Andrew's formula"? Is there documentation for what stats matter and how they're weighted? Or is this just about showing the CSS bar values more prominently?
- Should the stat bars match the game's visual style (green bars on dark background)?
- Should stats be color-coded relative to all characters (percentile) or on an absolute scale?
- Should the player page show both the raw stats AND the visual bars, or replace the current grid with a more visual layout?
- Which stats are considered "good when high" vs "good when low"? (e.g. speed high = good, errors high = bad)

---

### Task 1: Add color coding to stat values

**Files:**
- Modify: `app/components/PlayerInfo.tsx`

For each numeric stat, determine a color based on its value relative to the min/max range across all characters. Use a green-to-red gradient:
- Top tier → bright green
- Above average → light green
- Average → gray/neutral
- Below average → light red
- Bottom tier → red

This requires knowing the min/max for each stat. Options:
- Hardcode known ranges (simpler, from the game data)
- Pass all players' stats to the component and compute percentiles (dynamic but more data)

### Task 2: Add visual stat bars for CSS display values

**Files:**
- Modify: `app/components/PlayerInfo.tsx`

The four CSS stats (`pitchingCss`, `battingCss`, `fieldingCss`, `speedCss`) map to the game's visual stat bars. Render these as horizontal bars:
- Bar container with dark background
- Filled portion colored green (0-100 scale or whatever the game uses)
- Numeric value overlaid or beside the bar
- Match the game's style: green fill on dark gray background

### Task 3: Reorganize layout to emphasize important stats

Group stats by relevance:
- **Primary stats** (the 4 CSS bars) — shown prominently at the top
- **Batting details** — contact sizes, power, bunting
- **Pitching details** — speeds, curve, stamina
- **Fielding details** — fielding, throwing
- **Meta** — class, weight, ability

### Task 4: Consider position-based highlighting

If we know which stats matter for which position (e.g. pitching stats for pitcher, fielding for infielders, batting for everyone), highlight the relevant stats for the player's current lineup position.
