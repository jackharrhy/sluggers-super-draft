# Conference Dots in Standings Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add the ConferencePin colored dot next to team names in the StandingsTable.

**Architecture:** Add conference data to the standings data pipeline (server query → serialization → component), then render the existing `ConferencePin` component next to each team name in the standings table.

**Tech Stack:** Drizzle ORM relational queries, React, existing `ConferencePin` component.

**Ticket:** ssd-2604

---

### Task 1: Add conference data to standings server query

**Files:**
- Modify: `app/utils/standings.server.ts:13-25` (StandingsRow type)
- Modify: `app/utils/standings.server.ts:47-63` (query)
- Modify: `app/utils/standings.server.ts:79-91` and `117-129` (row creation)

**Step 1: Update the StandingsRow type to include conference**

Add to the `StandingsRow` type at line 13:

```typescript
conference: { id: number; name: string; color: string | null } | null;
```

**Step 2: Update the Drizzle query to include conference**

In the `finishedMatches` query (line 47), add `conference: true` to both `teamA` and `teamB` `with` blocks:

```typescript
teamA: {
  with: {
    user: true,
    captain: true,
    conference: true,
  },
},
teamB: {
  with: {
    user: true,
    captain: true,
    conference: true,
  },
},
```

**Step 3: Set conference data when creating standings rows**

In both the teamA block (~line 79) and teamB block (~line 117), add:

```typescript
conference: match.teamA.conference ?? null,
// and
conference: match.teamB.conference ?? null,
```

**Step 4: Verify the build compiles**

Run: `npm run build`

---

### Task 2: Add ConferencePin to StandingsTable component

**Files:**
- Modify: `app/components/StandingsTable.tsx:1` (imports)
- Modify: `app/components/StandingsTable.tsx:73-91` (team cell)

**Step 1: Import ConferencePin**

Add at the top of the file:

```typescript
import { ConferencePin } from "~/components/ConferencePin";
```

**Step 2: Add the dot next to the user name**

In the team cell (the `<Link>` at ~line 74), add the ConferencePin between the TeamLogo and team name, or next to the user name. Following the pattern in MatchDayCard, place it just before the user name:

```tsx
<Link
  to={`/team/${row.teamId}`}
  className="flex items-center gap-2 hover:underline"
>
  <TeamLogo
    captainStatsCharacter={row.captainStatsCharacter ?? undefined}
    size="xs"
  />
  <span className="font-semibold text-gray-100">
    {row.teamName}
  </span>
  {row.conference && <ConferencePin conference={row.conference} />}
  <span className="text-xs text-gray-200/80">
    {row.userName}
  </span>
</Link>
```

**Step 3: Verify the build compiles**

Run: `npm run build`

**Step 4: Commit**

```bash
git add app/utils/standings.server.ts app/components/StandingsTable.tsx
git commit -m "feat: add conference color dots to standings table"
```
