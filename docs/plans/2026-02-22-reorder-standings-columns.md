# Reorder Standings Table Columns Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Reorder the standings table columns so summary stats (W, L, +/-, RD) come immediately after Team, before the week-by-week results. New order: #, Team, W, L, +/-, RD, Week 1, Week 2, ...

**Architecture:** Pure UI reorder in the StandingsTable component. Move the W/L/+/-/RD `<th>` and `<td>` elements from after the week columns to before them. The W column should have a left-border separator, and the first week column should also have a left-border separator to visually separate the two sections.

**Tech Stack:** React, Tailwind CSS.

**Ticket:** ssd-38ad

---

### Task 1: Reorder thead columns

**Files:**
- Modify: `app/components/StandingsTable.tsx:31-59` (thead)

**Step 1: Move W/L/+/-/RD headers before week headers**

Current order in `<thead>`: #, Team, [Weeks...], W, L, +/-, RD

New order: #, Team, W, L, +/-, RD, [Weeks...]

```tsx
<tr className="border-b border-cell-gray/50">
  <th className="sticky left-0 z-20 bg-cell-gray/60 backdrop-blur-sm px-3 py-2.5 text-center text-xs font-semibold text-gray-400 w-10">
    #
  </th>
  <th className="sticky left-10 z-20 bg-cell-gray/60 backdrop-blur-sm px-3 py-2.5 text-left text-xs font-semibold text-gray-400 min-w-[140px]">
    Team
  </th>
  <th className="px-3 py-2.5 text-center text-xs font-semibold text-gray-400 border-l border-cell-gray/50 min-w-[40px]">
    W
  </th>
  <th className="px-3 py-2.5 text-center text-xs font-semibold text-gray-400 min-w-[40px]">
    L
  </th>
  <th className="px-3 py-2.5 text-center text-xs font-semibold text-gray-400 min-w-[50px]">
    +/-
  </th>
  <th className="px-3 py-2.5 text-center text-xs font-semibold text-gray-400 min-w-[50px]">
    RD
  </th>
  {matchDays.map((md, idx) => (
    <th
      key={md.id}
      colSpan={2}
      className={cn(
        "px-3 py-2.5 text-center text-xs font-semibold text-gray-400 min-w-[80px]",
        idx === 0 && "border-l border-cell-gray/50",
      )}
    >
      Week {idx + 1}
    </th>
  ))}
</tr>
```

Note: Add `cn` import if not already present, and add `border-l border-cell-gray/50` to the first week header.

---

### Task 2: Reorder tbody columns

**Files:**
- Modify: `app/components/StandingsTable.tsx:62-168` (tbody rows)

**Step 1: Move W/L/+/-/RD cells before week cells**

In each row, the current order is: #, Team, [Week cells], W, L, +/-, RD

New order: #, Team, W, L, +/-, RD, [Week cells]

Move the W/L/+/-/RD `<td>` elements to right after the Team `<td>`, and add a `border-l` to the first week cell.

The W cell keeps its existing `border-l border-cell-gray/50`. For week cells, add `border-l border-cell-gray/50` to the first week cell only (when the week has a result or not).

**Step 2: Verify build**

Run: `npm run build`

**Step 3: Commit**

```bash
git add app/components/StandingsTable.tsx
git commit -m "feat: reorder standings columns - stats before weeks"
```
