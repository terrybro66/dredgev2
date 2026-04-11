import { getRedisClient } from "./redis";

const SESSION_LOCATION_TTL = 60 * 60 * 24; // 24 hours

export interface SessionLocation {
  lat: number;
  lon: number;
  display_name: string;
  country_code: string;
}

export async function setUserLocation(
  sessionId: string,
  location: SessionLocation,
): Promise<void> {
  try {
    const redis = getRedisClient();
    await redis.set(
      `session:location:${sessionId}`,
      JSON.stringify(location),
      "EX",
      SESSION_LOCATION_TTL,
    );
  } catch {
    // Redis unavailable — non-fatal
  }
}

export async function getUserLocation(
  sessionId: string,
): Promise<SessionLocation | null> {
  try {
    const redis = getRedisClient();
    const raw = await redis.get(`session:location:${sessionId}`);
    if (!raw) return null;
    return JSON.parse(raw) as SessionLocation;
  } catch {
    return null;
  }
}

// ── Chip click tracking — C.8 ─────────────────────────────────────────────────

const CHIP_CLICKS_TTL = 60 * 60 * 24; // 24 hours

/**
 * Increment the click counter for a chip action type in the session.
 * Fire-and-forget safe — all Redis errors are silently swallowed.
 */
export async function recordChipClick(
  sessionId: string,
  actionType: string,
): Promise<void> {
  try {
    const redis = getRedisClient();
    const key = `session:chip_clicks:${sessionId}`;
    await redis.hincrby(key, actionType, 1);
    await redis.expire(key, CHIP_CLICKS_TTL);
  } catch {
    // non-fatal
  }
}

/**
 * Return all chip click counts for the session, keyed by action type.
 * Returns an empty object when the session has no history or Redis is down.
 */
export async function getChipClickCounts(
  sessionId: string,
): Promise<Record<string, number>> {
  try {
    const redis = getRedisClient();
    const raw = await redis.hgetall(`session:chip_clicks:${sessionId}`);
    if (!raw) return {};
    return Object.fromEntries(
      Object.entries(raw).map(([k, v]) => [k, parseInt(v, 10)]),
    );
  } catch {
    return {};
  }
}
