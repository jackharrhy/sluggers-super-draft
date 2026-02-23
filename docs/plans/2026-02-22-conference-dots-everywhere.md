# Conference Dots Everywhere Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add ConferencePin (conference colored dot) next to team/user names across all major views in the app.

**Architecture:** Ensure conference data is loaded in each route's loader, then add the existing `ConferencePin` component next to names. The ConferencePin is already used in MatchDayCard and match detail pages. This ticket covers adding it to: standings table (done via ssd-2604), team page, teams index, teams names. The teams index/names pages already have conference data (they group by conference) but don't show the dot per-team.

**Tech Stack:** React, existing ConferencePin component, Drizzle ORM.

**Ticket:** ssd-17fa (depends on ssd-2604)

---

### Task 1: Add ConferencePin to team page

**Files:**
- Modify: `app/utils/team.server.ts:12-24` (query — add `conference: true`)
- Modify: `app/routes/team.tsx:84-88` (header)

**Step 1: Include conference in the team query**

In `getTeamWithPlayers()` at `app/utils/team.server.ts:13-24`, add `conference: true` to the `with` block:

```typescript
with: {
  players: {
    with: {
      lineup: true,
    },
  },
  user: true,
  captain: true,
  conference: true,
},
```

**Step 2: Add ConferencePin to team page header**

Import `ConferencePin` in `app/routes/team.tsx` and add it next to the team name:

```tsx
import { ConferencePin } from "~/components/ConferencePin";

// In the header:
<div className="flex items-center gap-2">
  {rank && (
    <span className="text-lg font-rodin text-gray-400">#{rank}</span>
  )}
  <h1 className="text-2xl font-rodin font-bold">{team.name}</h1>
  {team.conference && <ConferencePin conference={team.conference} />}
</div>
```

---

### Task 2: Add ConferencePin to teams index page (lineups view)

**Files:**
- Modify: `app/routes/teams._index.tsx:108-119` (team card)

**Step 1: Import ConferencePin**

```typescript
import { ConferencePin } from "~/components/ConferencePin";
```

**Step 2: Add dot next to team name**

Conference data is already loaded (used for grouping). Add the pin in the team card header at ~line 114-118:

```tsx
<div className="w-full flex flex-col items-center gap-1">
  <p className="text-lg font-rodin font-bold flex items-center gap-1.5">
    {team.conference && <ConferencePin conference={team.conference} />}
    {team.name}
  </p>
  <p className="text-sm text-gray-200/80">{team.user?.name}</p>
</div>
```

---

### Task 3: Add ConferencePin to teams names page

**Files:**
- Modify: `app/routes/teams.names.tsx:98-107` (team card)

**Step 1: Import ConferencePin**

```typescript
import { ConferencePin } from "~/components/ConferencePin";
```

**Step 2: Add dot next to team name**

Same pattern at ~line 104-106:

```tsx
<div className="w-full flex flex-col items-center gap-1">
  <p className="text-lg font-rodin font-bold flex items-center gap-1.5">
    {team.conference && <ConferencePin conference={team.conference} />}
    {team.name}
  </p>
  <p className="text-sm text-gray-200/80">{team.user?.name}</p>
</div>
```

---

### Task 4: Verify build and commit

**Step 1: Verify build**

Run: `npm run build`

**Step 2: Commit**

```bash
git add app/utils/team.server.ts app/routes/team.tsx app/routes/teams._index.tsx app/routes/teams.names.tsx
git commit -m "feat: add conference color dots across team pages"
```
