# Standings Position on Team Page Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Show a team's current standings rank (e.g. #1, #3) on their individual team page.

**Architecture:** Reuse the existing `getStandingsData()` function in the team page loader to look up the team's rank, then display it in the header.

**Tech Stack:** Drizzle ORM, React Router loader, existing standings utility.

**Ticket:** ssd-21ce

---

### Task 1: Add standings rank to team page loader

**Files:**
- Modify: `app/routes/team.tsx:1-14` (imports)
- Modify: `app/routes/team.tsx:16-44` (loader)

**Step 1: Import getStandingsData**

Add to imports:

```typescript
import { getStandingsData } from "~/utils/standings.server";
```

**Step 2: Look up standings rank in the loader**

After fetching the team, call `getStandingsData(db)` and find the team's position:

```typescript
const standingsData = await getStandingsData(db);
const standingsPosition = standingsData.standings.findIndex(
  (row) => row.teamId === Number(teamId),
);
const rank = standingsPosition >= 0 ? standingsPosition + 1 : null;
```

Add `rank` to the return value.

---

### Task 2: Display standings rank on team page

**Files:**
- Modify: `app/routes/team.tsx:46-88` (component header)

**Step 1: Destructure rank from loaderData**

```typescript
const { team, canEdit, mentionContext, rank } = loaderData;
```

**Step 2: Display rank next to team name**

In the header section (line 84-88), add the rank:

```tsx
<div className="flex flex-col items-center gap-1">
  <div className="flex items-center gap-2">
    {rank && (
      <span className="text-lg font-rodin text-gray-400">#{rank}</span>
    )}
    <h1 className="text-2xl font-rodin font-bold">{team.name}</h1>
  </div>
  <p className="text-gray-200/80">{team.user?.name}</p>
</div>
```

**Step 3: Verify the build compiles**

Run: `npm run build`

**Step 4: Commit**

```bash
git add app/routes/team.tsx
git commit -m "feat: show standings rank on team page"
```
