# Allow Trading Captain Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Allow trading your team captain, provided you still have a valid captain candidate after the trade completes.

**Architecture:** Currently `validateTradeRequest` in `app/utils/trading.server.ts` (lines 132-149) outright blocks trading captains. The change would relax this: allow trading your captain IF the players you receive in return include a captain-eligible character (i.e. a character with `stats.captain === true`), OR if you already have another captain-eligible player on your roster who isn't being traded away. When the trade completes, if the captain was traded, auto-assign a new captain from the remaining captain-eligible players.

**Note:** The gh issue (#88) mentions "coach" but this codebase only has "captain" — the concept is the same. The gh issue also says "#87 can disable this feature", meaning a season configuration system could toggle whether captain trading is allowed. Since #87 (season configuration) doesn't exist yet, this plan implements the trading logic only, with a simple boolean check that could later be wired to a config.

**Tech Stack:** Drizzle ORM, existing trading validation logic.

**Ticket:** gh-88

**Open questions for review:**
- Should the new captain be auto-assigned, or should the user be prompted to pick one?
- If auto-assigned, which captain-eligible player gets picked? The first one? The one with highest stats?
- Should the trade proposal UI warn the user that their captain will change?
- Should the receiving team's captain also be tradeable under the same rules?
- The issue says "if you have a coach still after the trade" — does this mean at least one captain-eligible player must remain, or that the specific `captainId` player must remain?

---

### Task 1: Relax captain validation in trading

**Files:**
- Modify: `app/utils/trading.server.ts:132-149`

Instead of blocking captain trades outright, check:
1. Is the captain being traded?
2. If yes, will the team still have at least one captain-eligible player after the trade? (Check `stats.captain === true` on remaining roster + incoming players)
3. If no captain-eligible player remains, block the trade with a clear error message.

### Task 2: Auto-assign new captain on trade acceptance

**Files:**
- Modify: `app/utils/trading.server.ts:405-456` (the `acceptTrade` transaction)

After moving players between teams:
1. Check if either team's `captainId` player was traded away
2. If so, find a captain-eligible player on that team's new roster
3. Update `teams.captainId` to the new captain

### Task 3: Update trade proposal UI

**Files:**
- Modify: `app/routes/trade-with.tsx`

Show a warning if the user is including their captain in the trade, e.g. "Warning: your captain will change if this trade is accepted."

### Task 4: Handle edge cases

- What if both teams trade their captains to each other? Both teams get a new captain from the incoming player.
- What if the incoming captain-eligible player is also being traded in another pending trade? The existing "conflicting trade" validation should catch this.
- Lineup validation: the captain must be in the playing lineup (not benched). Since traded players have their lineup deleted, the new captain will need to be set up in the lineup by the user.
