import path from "node:path";
import fs from "node:fs/promises";

/**
 * Get the file path for a player drawing
 */
export function getPlayerDrawingPath(playerId: number, userId: number): string {
  const drawingsDir = path.join(
    process.cwd(),
    "public",
    "images",
    "player-drawings",
    String(playerId),
  );
  return path.join(drawingsDir, `${userId}.png`);
}

/**
 * Get the URL path for a player drawing (for serving statically)
 */
export function getPlayerDrawingUrl(playerId: number, userId: number): string {
  return `/images/player-drawings/${playerId}/${userId}.png`;
}

/**
 * Ensure the drawing directory exists for a player
 */
export async function ensureDrawingDirectory(
  playerId: number,
): Promise<string> {
  const drawingsDir = path.join(
    process.cwd(),
    "public",
    "images",
    "player-drawings",
    String(playerId),
  );
  await fs.mkdir(drawingsDir, { recursive: true });
  return drawingsDir;
}

/**
 * Save a player drawing to disk
 */
export async function savePlayerDrawing(
  playerId: number,
  userId: number,
  imageBuffer: Buffer,
): Promise<void> {
  // Validate inputs to prevent path traversal
  if (!Number.isInteger(playerId) || playerId <= 0) {
    throw new Error("Invalid playerId");
  }
  if (!Number.isInteger(userId) || userId <= 0) {
    throw new Error("Invalid userId");
  }

  await ensureDrawingDirectory(playerId);
  const filePath = getPlayerDrawingPath(playerId, userId);
  await fs.writeFile(filePath, imageBuffer);
}

/**
 * Check if a player drawing exists
 */
export async function playerDrawingExists(
  playerId: number,
  userId: number,
): Promise<boolean> {
  try {
    const filePath = getPlayerDrawingPath(playerId, userId);
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Get all user IDs that have drawings for a player
 * This scans the directory for existing drawings
 */
export async function getPlayerDrawingUserIds(
  playerId: number,
): Promise<number[]> {
  try {
    const drawingsDir = path.join(
      process.cwd(),
      "public",
      "images",
      "player-drawings",
      String(playerId),
    );
    const files = await fs.readdir(drawingsDir);
    const userIds: number[] = [];

    for (const file of files) {
      if (file.endsWith(".png")) {
        const userIdStr = file.replace(".png", "");
        const userId = Number.parseInt(userIdStr, 10);
        if (!Number.isNaN(userId) && userId > 0) {
          userIds.push(userId);
        }
      }
    }

    return userIds;
  } catch {
    // Directory doesn't exist yet, return empty array
    return [];
  }
}

/**
 * List image files from a directory
 */
export async function listImageFiles(
  directory: string,
): Promise<{ name: string; url: string }[]> {
  try {
    const dirPath = path.join(process.cwd(), "public", directory);
    const files = await fs.readdir(dirPath);
    const images: { name: string; url: string }[] = [];

    for (const file of files) {
      if (
        file.toLowerCase().endsWith(".png") ||
        file.toLowerCase().endsWith(".webp") ||
        file.toLowerCase().endsWith(".jpg") ||
        file.toLowerCase().endsWith(".jpeg")
      ) {
        images.push({
          name: file,
          url: `/${directory}/${file}`,
        });
      }
    }

    return images.sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return [];
  }
}
