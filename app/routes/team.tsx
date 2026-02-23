import type { Route } from "./+types/team";
import { TeamPlayerList } from "~/components/TeamPlayerList";
import { MentionDisplay } from "~/components/MentionEditor";
import { getUser } from "~/auth.server";
import { Link } from "react-router";
import { Lineup } from "~/components/Lineup";
import {
  getTeamWithPlayers,
  fillPlayersToTeamSize,
  checkCanEdit,
} from "~/utils/team.server";
import { resolveMentionsMultiple } from "~/utils/mentions.server";
import { db } from "~/database/db";
import { formatTimeAgo } from "~/utils/time";
import { ConferencePin } from "~/components/ConferencePin";
import { getStandingsData } from "~/utils/standings.server";
import { Events } from "~/components/Events";
import { TeamStandings } from "~/components/TeamStandings";
import { asc, desc, eq, or, inArray, and } from "drizzle-orm";
import {
  eventDraft,
  eventTrade,
  eventTradePreferencesUpdate,
  eventMatchStateChange,
  tradePlayers,
  matches as matchesTable,
  events,
  teams as teamsTable,
} from "~/database/schema";

export async function loader({
  params: { teamId },
  request,
}: Route.LoaderArgs) {
  const team = await getTeamWithPlayers(teamId);

  const players = team.players ?? [];
  const filledPlayers = fillPlayersToTeamSize(players);
  const teamWithFullPlayers = { ...team, players: filledPlayers };

  const user = await getUser(request);
  const canEdit = checkCanEdit(user, team.userId);

  const teamIdNum = Number(teamId);

  // Fetch standings + team events in parallel
  const [standingsData, draftEventIds, tradePrefsEventIds, teamMatchIds, teamTradeIds] =
    await Promise.all([
      getStandingsData(db),
      // Draft events where this team drafted a player
      db
        .select({ eventId: eventDraft.eventId })
        .from(eventDraft)
        .where(eq(eventDraft.teamId, teamIdNum)),
      // Trade preferences update events for this team
      db
        .select({ eventId: eventTradePreferencesUpdate.eventId })
        .from(eventTradePreferencesUpdate)
        .where(eq(eventTradePreferencesUpdate.teamId, teamIdNum)),
      // Matches involving this team
      db
        .select({ id: matchesTable.id })
        .from(matchesTable)
        .where(
          or(
            eq(matchesTable.teamAId, teamIdNum),
            eq(matchesTable.teamBId, teamIdNum),
          ),
        ),
      // Trades involving this team
      db
        .select({ tradeId: tradePlayers.tradeId })
        .from(tradePlayers)
        .where(
          or(
            eq(tradePlayers.fromTeamId, teamIdNum),
            eq(tradePlayers.toTeamId, teamIdNum),
          ),
        ),
    ]);

  const standingsPosition = standingsData.standings.findIndex(
    (row) => row.teamId === teamIdNum,
  );
  const rank = standingsPosition >= 0 ? standingsPosition + 1 : null;
  const teamStandingsRow = standingsPosition >= 0 ? standingsData.standings[standingsPosition] : null;
  const teamStandings = teamStandingsRow
    ? {
        matchDays: standingsData.matchDays,
        row: {
          ...teamStandingsRow,
          matchDayResults: Array.from(teamStandingsRow.matchDayResults.entries()),
        },
      }
    : null;

  // Get match state change event IDs (finished only)
  const matchEventIds =
    teamMatchIds.length > 0
      ? await db
          .select({ eventId: eventMatchStateChange.eventId })
          .from(eventMatchStateChange)
          .where(
            and(
              inArray(
                eventMatchStateChange.matchId,
                teamMatchIds.map((m) => m.id),
              ),
              eq(eventMatchStateChange.toState, "finished"),
            ),
          )
      : [];

  // Get trade event IDs
  const uniqueTradeIds = [...new Set(teamTradeIds.map((t) => t.tradeId))];
  const tradeEventIds =
    uniqueTradeIds.length > 0
      ? await db
          .select({ eventId: eventTrade.eventId })
          .from(eventTrade)
          .where(inArray(eventTrade.tradeId, uniqueTradeIds))
      : [];

  // Combine all event IDs
  const allEventIds = [
    ...draftEventIds.map((e) => e.eventId),
    ...tradePrefsEventIds.map((e) => e.eventId),
    ...matchEventIds.map((e) => e.eventId),
    ...tradeEventIds.map((e) => e.eventId),
  ];

  // Query all events with full relations
  const teamEvents =
    allEventIds.length > 0
      ? await db.query.events.findMany({
          where: inArray(events.id, allEventIds),
          with: {
            user: true,
            draft: {
              with: {
                player: {
                  with: {
                    lineup: true,
                  },
                },
                team: true,
              },
            },
            trade: {
              with: {
                trade: {
                  with: {
                    fromTeam: true,
                    toTeam: true,
                    tradePlayers: {
                      with: {
                        player: true,
                      },
                    },
                  },
                },
              },
            },
            matchStateChange: {
              with: {
                match: {
                  with: {
                    teamA: true,
                    teamB: true,
                  },
                },
              },
            },
            tradePreferencesUpdate: {
              with: {
                team: true,
              },
            },
          },
          orderBy: [desc(events.createdAt)],
        })
      : [];

  // Resolve mentions for trade texts and trade preferences
  const mentionTexts = [
    team.lookingFor,
    team.willingToTrade,
    ...teamEvents
      .filter((e) => e.trade?.trade?.proposalText)
      .map((e) => e.trade!.trade!.proposalText),
    ...teamEvents
      .filter((e) => e.trade?.trade?.responseText)
      .map((e) => e.trade!.trade!.responseText),
    ...teamEvents
      .filter((e) => e.tradePreferencesUpdate?.lookingFor)
      .map((e) => e.tradePreferencesUpdate!.lookingFor),
    ...teamEvents
      .filter((e) => e.tradePreferencesUpdate?.willingToTrade)
      .map((e) => e.tradePreferencesUpdate!.willingToTrade),
  ];

  const { mergedContext: mentionContext } = await resolveMentionsMultiple(
    db,
    mentionTexts,
  );

  // Determine prev/next team navigation order
  // Group by conference (alphabetical by name, null conference last), teams within each by ID
  const allTeamsForNav = await db.query.teams.findMany({
    columns: { id: true, conferenceId: true },
    with: { conference: { columns: { name: true } } },
    orderBy: (teams, { asc }) => asc(teams.id),
  });

  // Group by conference, then sort: conferences alphabetically, null last
  const confGroups = new Map<number | null, { name: string | null; teamIds: number[] }>();
  for (const t of allTeamsForNav) {
    const key = t.conferenceId;
    if (!confGroups.has(key)) {
      confGroups.set(key, { name: t.conference?.name ?? null, teamIds: [] });
    }
    confGroups.get(key)!.teamIds.push(t.id);
  }
  const sortedGroups = Array.from(confGroups.values()).sort((a, b) => {
    if (a.name === null && b.name === null) return 0;
    if (a.name === null) return 1;
    if (b.name === null) return -1;
    return a.name.localeCompare(b.name);
  });
  const orderedTeamIds = sortedGroups.flatMap((g) => g.teamIds);

  const currentIndex = orderedTeamIds.indexOf(teamIdNum);
  const prevTeamId =
    currentIndex >= 0
      ? orderedTeamIds[(currentIndex - 1 + orderedTeamIds.length) % orderedTeamIds.length]
      : null;
  const nextTeamId =
    currentIndex >= 0
      ? orderedTeamIds[(currentIndex + 1) % orderedTeamIds.length]
      : null;

  return {
    team: {
      ...teamWithFullPlayers,
    },
    canEdit,
    rank,
    teamStandings,
    teamEvents,
    prevTeamId,
    nextTeamId,
    mentionContext: {
      players: Array.from(mentionContext.players.entries()),
      teams: Array.from(mentionContext.teams.entries()),
    },
  };
}

export default function Team({
  loaderData: { team, canEdit, mentionContext, rank, teamStandings, teamEvents, prevTeamId, nextTeamId },
}: Route.ComponentProps) {
  // Reconstruct Map from serialized entries
  const context = {
    players: new Map(mentionContext.players),
    teams: new Map(mentionContext.teams),
  };

  // Filter out null players and split into lineup and bench
  const allPlayers = team.players.filter(
    (player): player is NonNullable<typeof player> => player !== null,
  );

  // Players with a lineup (batting order)
  const lineupPlayers = allPlayers
    .filter((player) => player.lineup?.battingOrder != null)
    .sort(
      (a, b) => (a.lineup?.battingOrder ?? 0) - (b.lineup?.battingOrder ?? 0),
    );

  // Players without a lineup (bench)
  const benchPlayers = allPlayers
    .filter((player) => player.lineup?.battingOrder == null)
    .sort((a, b) => a.name.localeCompare(b.name));

  // Create team objects for each list
  const lineupTeam = {
    ...team,
    players: lineupPlayers,
  };

  const benchTeam = {
    ...team,
    players: benchPlayers,
  };

  return (
    <div className="flex flex-col gap-4 items-center">
      <div className="flex items-center gap-4">
        {prevTeamId != null && (
          <Link to={`/team/${prevTeamId}`} className="text-gray-400 hover:text-gray-200 transition-colors">
            <span className="text-lg">&larr;</span>
          </Link>
        )}
        <div className="flex flex-col items-center gap-1">
          <h1 className="text-2xl font-rodin font-bold flex items-center gap-2">
            {rank && (
              <span className="text-lg font-rodin text-gray-400">#{rank}</span>
            )}
            {team.name}
            {team.conference && <ConferencePin conference={team.conference} />}
          </h1>
          <p className="text-gray-200/80">{team.user?.name}</p>
        </div>
        {nextTeamId != null && (
          <Link to={`/team/${nextTeamId}`} className="text-gray-400 hover:text-gray-200 transition-colors">
            <span className="text-lg">&rarr;</span>
          </Link>
        )}
      </div>

      {teamStandings && (
        <div className="w-full max-w-2xl">
          <TeamStandings
            matchDays={teamStandings.matchDays}
            row={teamStandings.row}
          />
        </div>
      )}

      {(team.lookingFor || team.willingToTrade) && (
        <div className="flex flex-col gap-4 border border-cell-gray/50 bg-cell-gray/30 rounded-lg p-4 w-full max-w-2xl">
          <h2 className="text-lg font-bold text-center">Trade Preferences</h2>
          <div className="flex flex-col gap-4">
            {team.lookingFor && (
              <div className="flex-1">
                <p className="text-sm font-semibold text-green-400 mb-1">
                  Looking For:
                </p>
                <MentionDisplay content={team.lookingFor} context={context} />
              </div>
            )}
            {team.willingToTrade && (
              <div className="flex-1">
                <p className="text-sm font-semibold text-orange-400 mb-1">
                  Willing to Trade:
                </p>
                <MentionDisplay
                  content={team.willingToTrade}
                  context={context}
                />
              </div>
            )}
          </div>
          {team.tradePreferencesUpdatedAt && (
            <span className="text-sm text-gray-300/80 italic">
              (updated {formatTimeAgo(new Date(team.tradePreferencesUpdatedAt))}
              )
            </span>
          )}
        </div>
      )}

      <div
        key={team.id}
        className="flex flex-row items-center gap-16 border-2 border-cell-gray/50 bg-cell-gray/40 rounded-lg p-4"
      >
        <div className="flex flex-col gap-6">
          {lineupPlayers.length > 0 && (
            <div className="flex flex-col gap-2">
              <TeamPlayerList team={lineupTeam} />
            </div>
          )}
          {benchPlayers.length > 0 && (
            <div className="flex flex-col gap-2">
              <p className="text-sm opacity-60">Bench:</p>
              <TeamPlayerList team={benchTeam} size="sm" />
            </div>
          )}
        </div>
        <Lineup
          players={allPlayers}
          captainId={team.captainId}
          captainStatsCharacter={team.captain?.statsCharacter}
        />
      </div>

      {canEdit && (
        <Link
          to={`/team/${team.id}/edit`}
          className="text-sm bg-blue-950 text-white px-4 py-2 rounded-md hover:bg-blue-900"
        >
          Edit
        </Link>
      )}

      <div className="w-full max-w-2xl">
        <h2 className="text-xl font-semibold mb-4">Team History</h2>
        <Events events={teamEvents} mentionContext={context} />
      </div>
    </div>
  );
}
