import type { Route } from "./+types/player";
import { db } from "~/database/db";
import {
  eventDraft,
  eventTrade,
  tradePlayers,
  eventMatchStateChange,
  matchBattingOrders,
  events,
  users,
} from "~/database/schema";
import { PlayerIcon } from "~/components/PlayerIcon";
import { PlayerInfo } from "~/components/PlayerInfo";
import { CanvasDrawing } from "~/components/CanvasDrawing";
import { cn } from "~/utils/cn";
import { Link } from "react-router";
import { desc, eq, inArray, and } from "drizzle-orm";
import { resolveMentionsMultiple } from "~/utils/mentions.server";
import { Events } from "~/components/Events";
import { getUser, requireUser } from "~/auth.server";
import {
  getPlayerDrawingUserIds,
  getPlayerDrawingUrl,
  savePlayerDrawing,
  listImageFiles,
} from "~/utils/drawing.server";

export async function loader({
  params: { playerId },
  request,
}: Route.LoaderArgs) {
  const playerIdNum = Number(playerId);

  const player = await db.query.players.findFirst({
    where: (players, { eq }) => eq(players.id, playerIdNum),
    with: {
      team: true,
      lineup: true,
      stats: true,
    },
  });

  if (!player) {
    throw new Response("Player not found", { status: 404 });
  }

  const user = await getUser(request);

  // Get all user IDs that have drawings for this player
  const drawingUserIds = await getPlayerDrawingUserIds(playerIdNum);

  // Fetch user info for each drawing
  const drawingUsers =
    drawingUserIds.length > 0
      ? await db
          .select({ id: users.id, name: users.name })
          .from(users)
          .where(inArray(users.id, drawingUserIds))
      : [];

  // Build drawings data with URLs
  const drawings = drawingUsers.map((drawingUser) => ({
    userId: drawingUser.id,
    userName: drawingUser.name,
    url: getPlayerDrawingUrl(playerIdNum, drawingUser.id),
  }));

  // Get current user's drawing URL if they have one
  const currentUserDrawingUrl =
    user && drawingUserIds.includes(user.id)
      ? getPlayerDrawingUrl(playerIdNum, user.id)
      : null;

  // Load available images for the image browser
  const [playerImages, miiImages, teamLogoImages] = await Promise.all([
    listImageFiles("images/players/sideview/right"),
    listImageFiles("images/miis"),
    listImageFiles("images/teams/logos/large"),
  ]);

  // Get event IDs for draft events involving this player
  const draftEventIds = await db
    .select({ eventId: eventDraft.eventId })
    .from(eventDraft)
    .where(eq(eventDraft.playerId, playerIdNum));

  // Get trade IDs where this player is involved
  const playerTradeIds = await db
    .select({ tradeId: tradePlayers.tradeId })
    .from(tradePlayers)
    .where(eq(tradePlayers.playerId, playerIdNum));

  // Get event IDs for trade events
  const tradeEventIds =
    playerTradeIds.length > 0
      ? await db
          .select({ eventId: eventTrade.eventId })
          .from(eventTrade)
          .where(
            inArray(
              eventTrade.tradeId,
              playerTradeIds.map((t) => t.tradeId),
            ),
          )
      : [];

  // Get match IDs where this player participates
  const playerMatchIds = await db
    .select({ matchId: matchBattingOrders.matchId })
    .from(matchBattingOrders)
    .where(eq(matchBattingOrders.playerId, playerIdNum));

  // Get event IDs for match state change events (finished only)
  const matchEventIds =
    playerMatchIds.length > 0
      ? await db
          .select({ eventId: eventMatchStateChange.eventId })
          .from(eventMatchStateChange)
          .where(
            and(
              inArray(
                eventMatchStateChange.matchId,
                playerMatchIds.map((m) => m.matchId),
              ),
              eq(eventMatchStateChange.toState, "finished"),
            ),
          )
      : [];

  // Combine all event IDs
  const allEventIds = [
    ...draftEventIds.map((e) => e.eventId),
    ...tradeEventIds.map((e) => e.eventId),
    ...matchEventIds.map((e) => e.eventId),
  ];

  // Query all events with full relations
  const playerEvents =
    allEventIds.length > 0
      ? await db.query.events.findMany({
          where: (events, { inArray }) => inArray(events.id, allEventIds),
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
          },
          orderBy: [desc(events.createdAt)],
        })
      : [];

  // Resolve mentions for trade texts
  const tradeProposalTexts = playerEvents
    .filter((e) => e.trade?.trade?.proposalText)
    .map((e) => e.trade!.trade!.proposalText);

  const tradeResponseTexts = playerEvents
    .filter((e) => e.trade?.trade?.responseText)
    .map((e) => e.trade!.trade!.responseText);

  const { mergedContext } = await resolveMentionsMultiple(db, [
    ...tradeProposalTexts,
    ...tradeResponseTexts,
  ]);

  return {
    player,
    events: playerEvents,
    mentionContext: {
      players: Array.from(mergedContext.players.entries()),
      teams: Array.from(mergedContext.teams.entries()),
    },
    user,
    drawings,
    currentUserDrawingUrl,
    availableImages: {
      players: playerImages,
      miis: miiImages,
      teamLogos: teamLogoImages,
    },
  };
}

export async function action({
  params: { playerId },
  request,
}: Route.ActionArgs) {
  const user = await requireUser(request);
  const playerIdNum = Number(playerId);

  if (isNaN(playerIdNum) || playerIdNum <= 0) {
    return {
      success: false,
      error: "Invalid player ID",
    };
  }

  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent !== "save-drawing") {
    return {
      success: false,
      error: "Invalid action",
    };
  }

  const imageData = formData.get("imageData");

  if (!imageData || typeof imageData !== "string") {
    return {
      success: false,
      error: "No image data provided",
    };
  }

  // Parse base64 data URL
  const base64Match = imageData.match(/^data:image\/png;base64,(.+)$/);
  if (!base64Match) {
    return {
      success: false,
      error: "Invalid image format",
    };
  }

  try {
    // Convert base64 to Buffer
    const imageBuffer = Buffer.from(base64Match[1], "base64");

    // Validate image size (max 5MB)
    if (imageBuffer.length > 5 * 1024 * 1024) {
      return {
        success: false,
        error: "Image too large (max 5MB)",
      };
    }

    // Save drawing
    await savePlayerDrawing(playerIdNum, user.id, imageBuffer);

    return {
      success: true,
      message: "Drawing saved successfully",
    };
  } catch (error) {
    console.error("Error saving drawing:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to save drawing",
    };
  }
}

export default function Player({
  loaderData,
  actionData,
}: Route.ComponentProps) {
  const {
    player: { stats, ...player },
    events: playerEvents,
    mentionContext: mentionContextData,
    user,
    drawings,
    currentUserDrawingUrl,
    availableImages,
  } = loaderData;

  const mentionContext = {
    players: new Map(mentionContextData.players),
    teams: new Map(mentionContextData.teams),
  };

  return (
    <div className="flex flex-col gap-4 items-center">
      <h1 className="text-2xl font-rodin font-bold">{player.name}</h1>

      <div className="flex flex-col items-center gap-6 border-2 border-cell-gray/50 bg-cell-gray/40 rounded-lg p-8">
        <PlayerIcon
          player={player}
          size="xl"
          isStarred={player.lineup?.isStarred ?? false}
          isCaptain={
            player.team?.captainId !== null &&
            player.team?.captainId !== undefined &&
            player.id === player.team.captainId
          }
        />

        <div className="text-center space-y-2">
          <p>
            Team:{" "}
            {player.team ? (
              <Link to={`/team/${player.team.id}`} className="hover:underline">
                {player.team.name}
              </Link>
            ) : (
              <span className={cn("text-green-400 font-semibold")}>
                Free Agent
              </span>
            )}
          </p>
        </div>

        {stats && <PlayerInfo stats={stats} />}
      </div>

      <div className="w-full max-w-2xl">
        <h2 className="text-xl font-semibold mb-4">Draw on {player.name}</h2>
        {actionData && (
          <div
            className={cn(
              "mb-4 p-3 rounded",
              actionData.success
                ? "bg-green-100 text-green-800"
                : "bg-red-100 text-red-800",
            )}
          >
            {actionData.success
              ? actionData.message || "Drawing saved successfully!"
              : actionData.error || "Failed to save drawing"}
          </div>
        )}
        <CanvasDrawing
          playerId={player.id}
          userId={user?.id ?? null}
          existingDrawingUrl={currentUserDrawingUrl}
          availableImages={availableImages}
        />
      </div>

      {drawings.length > 0 && (
        <div className="w-full max-w-2xl">
          <h2 className="text-xl font-semibold mb-4">All Drawings</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {drawings.map((drawing) => (
              <div
                key={drawing.userId}
                className="border-2 border-cell-gray/50 bg-cell-gray/40 rounded-lg p-4"
              >
                <p className="text-sm text-gray-600 mb-2">
                  By {drawing.userName}
                </p>
                <img
                  src={drawing.url}
                  alt={`Drawing by ${drawing.userName}`}
                  className="w-full h-auto rounded border border-gray-300"
                />
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="w-full max-w-2xl">
        <h2 className="text-xl font-semibold mb-4">Player History</h2>
        <Events events={playerEvents} mentionContext={mentionContext} />
      </div>
    </div>
  );
}
