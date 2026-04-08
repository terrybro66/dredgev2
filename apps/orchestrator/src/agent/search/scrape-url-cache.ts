import { getRedisClient } from "../../redis";

const SCRAPE_URL_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days

export interface ScrapeUrlEntry {
  url: string;
  extractionPrompt: string;
}

function makeKey(intent: string, location: string): string {
  const slug = (s: string) => s.toLowerCase().replace(/\s+/g, "-");
  return `scrape:url:${slug(intent)}:${slug(location)}`;
}

export async function getCachedScrapeUrl(
  intent: string,
  location: string,
): Promise<ScrapeUrlEntry | null> {
  try {
    const redis = getRedisClient();
    const raw = await redis.get(makeKey(intent, location));
    if (!raw) return null;
    return JSON.parse(raw) as ScrapeUrlEntry;
  } catch {
    return null;
  }
}

export async function setCachedScrapeUrl(
  intent: string,
  location: string,
  entry: ScrapeUrlEntry,
): Promise<void> {
  try {
    const redis = getRedisClient();
    await redis.setex(
      makeKey(intent, location),
      SCRAPE_URL_TTL_SECONDS,
      JSON.stringify(entry),
    );
  } catch {
    // Non-fatal — cache write failure does not break the scrape pipeline
  }
}
