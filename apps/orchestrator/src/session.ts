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
