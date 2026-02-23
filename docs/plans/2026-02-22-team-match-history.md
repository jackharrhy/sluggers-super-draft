# Team Match History on Team Page Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Show a team's match history on their team page, including their overall record (W-L) and individual match results with scores.

**Architecture:** Query the team's finished matches in the team page loader, compute the record, and render a match history section. Reuse match data patterns from `standings.server.ts`. Display as a compact list/table of results below the existing team info.

**Tech Stack:** Drizzle ORM, React, existing schema relations.

**Ticket:** ssd-ec8e

---

### Task 1: Query match history in team page loader

**Files:**
- Modify: `app/routes/team.tsx:1-14` (imports)
- Modify: `app/routes/team.tsx:16-44` (loader)

**Step 1: Import necessary modules**

```typescript
import { eq, or } from "drizzle-orm";
import { matches as matchesTable, matchDays } from "~/database/schema";
```

**Step 2: Query finished matches for this team**

After the existing loader code, add a query for the team's matches:

```typescript
const teamMatches = await db.query.matches.findMany({
  where: and(
    eq(matchesTable.state, "finished"),
    or(
      eq(matchesTable.teamAId, Number(teamId)),
      eq(matchesTable.teamBId, Number(teamId)),
    ),
  ),
  with: {
    teamA: { with: { user: true, captain: true } },
    teamB: { with: { user: true, captain: true } },
    matchDay: true,
  },
});
```

**Step 3: Process into match history data**

```typescript
const matchHistory = teamMatches
  .filter((m) => m.teamAScore !== null && m.teamBScore !== null)
  .sort((a, b) => {
    const orderA = a.matchDay?.orderInSeason ?? 0;
    const orderB = b.matchDay?.orderInSeason ?? 0;
    return orderA - orderB;
  })
  .map((match) => {
    const isTeamA = match.teamAId === Number(teamId);
    const userScore = isTeamA ? match.teamAScore! : match.teamBScore!;
    const opponentScore = isTeamA ? match.teamBScore! : match.teamAScore!;
    const opponent = isTeamA ? match.teamB : match.teamA;
    const isWin = userScore > opponentScore;

    return {
      matchId: match.id,
      matchDayName: match.matchDay?.name,
      userScore,
      opponentScore,
      isWin,
      opponent: {
        teamId: opponent.id,
        teamName: opponent.name,
        userName: opponent.user?.name ?? "Unknown",
        captainStatsCharacter: opponent.captain?.statsCharacter ?? null,
      },
    };
  });

const wins = matchHistory.filter((m) => m.isWin).length;
const losses = matchHistory.filter((m) => !m.isWin).length;
```

Add `matchHistory`, `wins`, and `losses` to the return value.

---

### Task 2: Render match history section on team page

**Files:**
- Modify: `app/routes/team.tsx:46+` (component)

**Step 1: Destructure match history from loaderData**

```typescript
const { team, canEdit, mentionContext, rank, matchHistory, wins, losses } = loaderData;
```

**Step 2: Add match history section**

Place this after the team card div and before the edit button:

```tsx
{matchHistory.length > 0 && (
  <div className="w-full max-w-2xl flex flex-col gap-3">
    <div className="flex items-center justify-between">
      <h2 className="text-lg font-bold">Match History</h2>
      <span className="font-rodin text-sm">
        <span className="text-green-300">{wins}W</span>
        {" - "}
        <span className="text-red-300/80">{losses}L</span>
      </span>
    </div>
    <div className="flex flex-col gap-1">
      {matchHistory.map((match) => (
        <Link
          key={match.matchId}
          to={`/match/${match.matchId}`}
          className="flex items-center justify-between px-3 py-2 rounded-lg border border-cell-gray/50 bg-cell-gray/30 hover:bg-cell-gray/50 transition-colors"
        >
          <div className="flex items-center gap-2">
            <span className={cn(
              "font-rodin font-bold text-sm w-6 text-center",
              match.isWin ? "text-green-300" : "text-red-300/80"
            )}>
              {match.isWin ? "W" : "L"}
            </span>
            <TeamLogo
              captainStatsCharacter={match.opponent.captainStatsCharacter ?? undefined}
              size="xs"
            />
            <span className="text-sm text-gray-200">
              vs {match.opponent.teamName}
            </span>
          </div>
          <div className="flex items-center gap-1 font-rodin text-sm">
            <span className={match.isWin ? "text-green-300" : "text-gray-300/80"}>
              {match.userScore}
            </span>
            <span className="text-gray-200/50">-</span>
            <span className={!match.isWin ? "text-red-300" : "text-gray-300/80"}>
              {match.opponentScore}
            </span>
          </div>
        </Link>
      ))}
    </div>
  </div>
)}
```

**Step 3: Import cn and TeamLogo if not already imported**

```typescript
import { cn } from "~/utils/cn";
import { TeamLogo } from "~/components/TeamLogo";
```

**Step 4: Verify build**

Run: `npm run build`

**Step 5: Commit**

```bash
git add app/routes/team.tsx
git commit -m "feat: add match history to team page"
```
