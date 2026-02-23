import type { Route } from "./+types/matches";
import { Link, useSearchParams } from "react-router";
import { db } from "~/database/db";
import { matchDays, matches } from "~/database/schema";
import { asc, desc, isNull } from "drizzle-orm";
import { cn } from "~/utils/cn";
import { StandingsTable } from "~/components/StandingsTable";
import {
  getStandingsData,
  serializeStandingsData,
} from "~/utils/standings.server";
import {
  MatchDayCard,
  MatchCard,
  getMatchDayState,
  type MatchDayData,
} from "~/components/MatchDayCard";

function formatCountdown(targetDate: Date, now: Date): string | null {
  const diffMs = targetDate.getTime() - now.getTime();
  if (diffMs <= 0) return null;

  const totalMinutes = Math.floor(diffMs / (1000 * 60));
  const totalHours = Math.floor(totalMinutes / 60);
  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;
  const minutes = totalMinutes % 60;

  if (days > 0) return `Starts in ${days}d ${hours}h`;
  if (hours > 0) return `Starts in ${hours}h ${minutes}m`;
  return `Starts in ${minutes}m`;
}

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const sortOrder = url.searchParams.get("sort") ?? "asc";
  const showCompleted = url.searchParams.get("completed") === "true";

  const allMatchDays = await db.query.matchDays.findMany({
    with: {
      matches: {
        with: {
          teamA: {
            with: {
              captain: true,
              conference: true,
              user: true,
            },
          },
          teamB: {
            with: {
              captain: true,
              conference: true,
              user: true,
            },
          },
          location: true,
        },
        orderBy: [asc(matches.orderInDay), asc(matches.scheduledDate)],
      },
    },
    orderBy: [asc(matchDays.orderInSeason)],
  });

  const orphanMatches = await db.query.matches.findMany({
    where: isNull(matches.matchDayId),
    with: {
      teamA: {
        with: {
          captain: true,
          conference: true,
          user: true,
        },
      },
      teamB: {
        with: {
          captain: true,
          conference: true,
          user: true,
        },
      },
      location: true,
    },
    orderBy: [asc(matches.scheduledDate), desc(matches.createdAt)],
  });

  const standingsData = await getStandingsData(db);

  // Identify featured match days
  const now = new Date();

  const liveMatchDay = allMatchDays.find((md) =>
    md.matches.some((m) => m.state === "live"),
  );

  // Previous: last match day (by orderInSeason) where ALL matches are finished
  const previousMatchDay = [...allMatchDays]
    .reverse()
    .find(
      (md) =>
        md.matches.length > 0 &&
        md.matches.every((m) => m.state === "finished") &&
        md.id !== liveMatchDay?.id,
    );

  // Upcoming: first match day (by orderInSeason) where ALL matches are upcoming
  const upcomingMatchDay = allMatchDays.find(
    (md) =>
      md.matches.length > 0 &&
      md.matches.every((m) => m.state === "upcoming") &&
      md.id !== liveMatchDay?.id,
  );

  const upcomingCountdown =
    upcomingMatchDay?.date
      ? formatCountdown(new Date(upcomingMatchDay.date), now)
      : null;

  // IDs to exclude from the main list
  const featuredIds = new Set(
    [liveMatchDay?.id, previousMatchDay?.id, upcomingMatchDay?.id].filter(
      (id): id is number => id != null,
    ),
  );

  return {
    matchDays: allMatchDays,
    orphanMatches,
    standings: serializeStandingsData(standingsData),
    filters: { sortOrder, showCompleted },
    featured: {
      liveMatchDay: liveMatchDay ?? null,
      previousMatchDay: previousMatchDay ?? null,
      upcomingMatchDay: upcomingMatchDay ?? null,
      upcomingCountdown,
      featuredIds: [...featuredIds],
    },
  };
}

export default function Matches({ loaderData }: Route.ComponentProps) {
  const { matchDays, orphanMatches, standings, filters, featured } = loaderData;
  const [searchParams] = useSearchParams();

  const hasContent = matchDays.length > 0 || orphanMatches.length > 0;

  if (!hasContent) {
    return (
      <div className="text-center text-gray-400 italic py-8">
        No matches scheduled yet.
      </div>
    );
  }

  const featuredIdSet = new Set(featured.featuredIds);

  let filteredMatchDays = matchDays.filter(
    (md) => !featuredIdSet.has(md.id),
  );

  if (!filters.showCompleted) {
    filteredMatchDays = filteredMatchDays.filter((md) => {
      const state = getMatchDayState(md as MatchDayData);
      return state !== "finished";
    });
  }

  filteredMatchDays.sort((a, b) => {
    const dateA = a.date ? new Date(a.date).getTime() : null;
    const dateB = b.date ? new Date(b.date).getTime() : null;

    if (dateA !== null && dateB !== null) {
      return filters.sortOrder === "asc" ? dateA - dateB : dateB - dateA;
    }

    if (dateA !== null) return filters.sortOrder === "asc" ? -1 : 1;
    if (dateB !== null) return filters.sortOrder === "asc" ? 1 : -1;

    const orderA = a.orderInSeason ?? 0;
    const orderB = b.orderInSeason ?? 0;
    return filters.sortOrder === "asc" ? orderA - orderB : orderB - orderA;
  });

  const buildQueryString = (params: Record<string, string>) => {
    const newParams = new URLSearchParams(searchParams);
    for (const [key, value] of Object.entries(params)) {
      if (
        value === "" ||
        (key === "sort" && value === "asc") ||
        (key === "completed" && value === "false")
      ) {
        newParams.delete(key);
      } else {
        newParams.set(key, value);
      }
    }
    const str = newParams.toString();
    return str ? `?${str}` : "";
  };

  const showPrevious = !featured.liveMatchDay && featured.previousMatchDay;

  return (
    <div className="space-y-6">
      {(featured.liveMatchDay || showPrevious || featured.upcomingMatchDay) && (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          {featured.liveMatchDay && (
            <MatchDayCard
              matchDay={featured.liveMatchDay as MatchDayData}
            />
          )}
          {showPrevious && (
            <div className="relative">
              <span className="absolute -top-2.5 left-3 z-10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider rounded bg-gray-600/80 text-gray-300 border border-gray-500/50">
                Previous
              </span>
              <MatchDayCard
                matchDay={featured.previousMatchDay as MatchDayData}
              />
            </div>
          )}
          {featured.upcomingMatchDay && (
            <div className="relative">
              <div className="absolute -top-2.5 left-3 z-10 flex items-center gap-2">
                <span className="px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider rounded bg-blue-500/30 text-blue-300 border border-blue-400/50">
                  Up Next
                </span>
                {featured.upcomingCountdown && (
                  <span className="px-2 py-0.5 text-[10px] font-semibold rounded bg-blue-500/20 text-blue-200 border border-blue-400/40">
                    {featured.upcomingCountdown}
                  </span>
                )}
              </div>
              <MatchDayCard
                matchDay={featured.upcomingMatchDay as MatchDayData}
              />
            </div>
          )}
        </div>
      )}

      {standings.standings.length > 0 && (
        <div>
          <h2 className="text-xl font-bold mb-3">Standings</h2>
          <StandingsTable data={standings} />
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <Link
          to={`/matches${buildQueryString({ sort: "asc" })}`}
          preventScrollReset
          className={cn(
            "px-4 py-2 rounded border-2 transition-colors text-sm",
            filters.sortOrder === "asc"
              ? "bg-cell-gray/60 border-cell-gray"
              : "bg-cell-gray/40 border-cell-gray/50 hover:bg-cell-gray/60",
          )}
        >
          Dates Ascending
        </Link>
        <Link
          to={`/matches${buildQueryString({ sort: "desc" })}`}
          preventScrollReset
          className={cn(
            "px-4 py-2 rounded border-2 transition-colors text-sm",
            filters.sortOrder === "desc"
              ? "bg-cell-gray/60 border-cell-gray"
              : "bg-cell-gray/40 border-cell-gray/50 hover:bg-cell-gray/60",
          )}
        >
          Dates Descending
        </Link>
        <div className="w-px bg-cell-gray/50 mx-1" />
        <Link
          to={`/matches${buildQueryString({ completed: filters.showCompleted ? "false" : "true" })}`}
          preventScrollReset
          className="flex items-center gap-2 px-3 py-2 text-sm text-gray-300 hover:text-gray-100 transition-colors"
        >
          <span
            className={cn(
              "relative inline-flex h-5 w-9 items-center rounded-full transition-colors",
              filters.showCompleted ? "bg-green-500" : "bg-cell-gray",
            )}
          >
            <span
              className={cn(
                "inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform",
                filters.showCompleted ? "translate-x-4" : "translate-x-0.5",
              )}
            />
          </span>
          Show Completed
        </Link>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        {filteredMatchDays.map((matchDay) => (
          <MatchDayCard key={matchDay.id} matchDay={matchDay as MatchDayData} />
        ))}
      </div>

      {filteredMatchDays.length === 0 && (
        <div className="text-center text-gray-400 italic py-8">
          No match days to show with current filters.
        </div>
      )}

      {orphanMatches.length > 0 && (
        <div className="rounded-xl bg-cell-gray/30 border border-cell-gray/50 p-4">
          <h3 className="text-lg font-bold mb-3 text-gray-400">
            Unscheduled Matches
          </h3>
          <div className="space-y-2">
            {orphanMatches.map((match) => (
              <MatchCard key={match.id} match={match} showDate />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
