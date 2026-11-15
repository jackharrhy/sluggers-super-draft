import { Link } from "react-router";
import { cn } from "~/utils/cn";
import type { MatchDayResult } from "~/utils/standings.server";

type TeamStandingsProps = {
  matchDays: Array<{
    id: number;
    name: string | null;
    orderInSeason: number | null;
  }>;
  row: {
    wins: number;
    losses: number;
    wlRatio: number;
    runDifferential: number;
    matchDayResults: [number, MatchDayResult][];
  };
};

export function TeamStandings({ matchDays, row }: TeamStandingsProps) {
  const resultsMap = new Map(row.matchDayResults);

  return (
    <div className="overflow-x-auto rounded-xl border border-cell-gray/50 bg-cell-gray/30">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-cell-gray/50">
            <th className="px-3 py-2.5 text-center text-xs font-semibold text-gray-400 min-w-[40px]">
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
        </thead>
        <tbody>
          <tr className="bg-cell-gray/40">
            <td className="px-3 py-2.5 text-center font-rodin text-green-300">
              {row.wins}
            </td>
            <td className="px-3 py-2.5 text-center font-rodin text-red-300/80">
              {row.losses}
            </td>
            <td
              className={cn(
                "px-3 py-2.5 text-center font-rodin",
                row.wlRatio > 0
                  ? "text-green-300"
                  : row.wlRatio < 0
                    ? "text-red-300/80"
                    : "text-gray-400",
              )}
            >
              {row.wlRatio > 0 ? `+${row.wlRatio}` : row.wlRatio}
            </td>
            <td
              className={cn(
                "px-3 py-2.5 text-center font-rodin",
                row.runDifferential > 0
                  ? "text-green-300"
                  : row.runDifferential < 0
                    ? "text-red-300/80"
                    : "text-gray-400",
              )}
            >
              {row.runDifferential > 0
                ? `+${row.runDifferential}`
                : row.runDifferential}
            </td>
            {matchDays.map((md, idx) => {
              const result = resultsMap.get(md.id);
              if (!result) {
                return (
                  <td
                    key={`${md.id}-empty`}
                    colSpan={2}
                    className={cn(
                      "px-3 py-2.5 text-center text-gray-500",
                      idx === 0 && "border-l border-cell-gray/50",
                    )}
                  >
                    -
                  </td>
                );
              }

              return (
                <td
                  key={md.id}
                  colSpan={2}
                  className={cn(
                    "px-3 py-2.5 text-center",
                    result.isWin ? "bg-green-500/20" : "bg-red-500/20",
                    idx === 0 && "border-l border-cell-gray/50",
                  )}
                >
                  <Link
                    to={`/match/${result.matchId}`}
                    className="hover:underline"
                  >
                    <span
                      className={cn(
                        "font-rodin",
                        result.isWin ? "text-green-300" : "text-gray-300/80",
                      )}
                    >
                      {result.userScore}
                    </span>
                    <span className="text-gray-200/50 font-bold mx-1">-</span>
                    <span
                      className={cn(
                        "font-rodin",
                        !result.isWin ? "text-red-300" : "text-gray-300/80",
                      )}
                    >
                      {result.opponentScore}
                    </span>
                  </Link>
                </td>
              );
            })}
          </tr>
        </tbody>
      </table>
    </div>
  );
}
