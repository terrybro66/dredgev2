/**
 * cinemas-gb/showtimes.ts — Phase C.11
 *
 * Fetches live showtimes for a named cinema (Track B — ephemeral).
 *
 * Pipeline:
 *   1. Check scrape URL cache (Redis, 7-day TTL)
 *   2. On miss: resolve URL via SerpAPI for "{cinema name} showtimes"
 *   3. Scrape with Stagehand using curated extraction prompt
 *   4. Return raw rows (caller wraps in ephemeral ResultHandle)
 *
 * The cache key uses the cinema's OSM id (stable) rather than its name
 * (may vary in spelling) to avoid cache fragmentation.
 */

import { resolveUrlForQuery } from "../../agent/search/serp";
import {
  getCachedScrapeUrl,
  setCachedScrapeUrl,
} from "../../agent/search/scrape-url-cache";

const CINEMA_DOMAINS = [
  "odeon.co.uk",
  "myvue.com",
  "cineworld.co.uk",
  "picturehouses.com",
  "everymancinema.com",
  "curzon.com",
  "bfi.org.uk",
];

const SHOWTIMES_EXTRACTION_PROMPT =
  "Find all movies currently showing on this cinema page. " +
  "Look for film listings, showtimes, or now showing sections. " +
  "Return each film as an object with fields: title (string), " +
  "showtime (string, if available), certificate (string, e.g. PG/12A/15/18, if shown). " +
  "Return ALL films as an array under the key 'items'.";

export interface ShowtimeRow {
  title: string;
  showtime: string | null;
  certificate: string | null;
  cinema: string;
  _sourceTag: string;
}

/**
 * Fetch live showtimes for a specific cinema.
 *
 * @param cinemaName   Display name of the cinema, e.g. "Odeon Leicester Square"
 * @param cacheKey     Stable cache key — use osm_id when available, else slugified name
 */
export async function fetchShowtimes(
  cinemaName: string,
  cacheKey: string,
): Promise<ShowtimeRow[]> {
  // 1. Cache check
  const cached = await getCachedScrapeUrl("cinema-showtimes", cacheKey);

  let fetchUrl: string;
  let extractionPrompt: string;

  if (cached) {
    console.log(
      JSON.stringify({
        event: "showtime_url_cache_hit",
        cinema: cinemaName,
        url: cached.url,
      }),
    );
    fetchUrl = cached.url;
    extractionPrompt = cached.extractionPrompt;
  } else {
    // 2. Resolve URL via SerpAPI
    const serpQuery = `${cinemaName} what's on showtimes`;
    fetchUrl =
      (await resolveUrlForQuery(serpQuery, CINEMA_DOMAINS)) ?? "";

    if (!fetchUrl) {
      console.warn(
        JSON.stringify({
          event: "showtime_url_not_found",
          cinema: cinemaName,
        }),
      );
      return [];
    }

    extractionPrompt = SHOWTIMES_EXTRACTION_PROMPT;

    console.log(
      JSON.stringify({
        event: "showtime_url_resolved",
        cinema: cinemaName,
        url: fetchUrl,
      }),
    );

    // 3. Populate cache
    await setCachedScrapeUrl("cinema-showtimes", cacheKey, {
      url: fetchUrl,
      extractionPrompt,
    });
  }

  // 4. Scrape
  const { createScrapeProvider } = await import(
    "../../providers/scrape-provider"
  );
  const provider = createScrapeProvider({ extractionPrompt });

  let raw: Record<string, unknown>[] = [];
  try {
    raw = (await provider.fetchRows(fetchUrl)) as Record<string, unknown>[];
  } catch (err) {
    console.warn(
      JSON.stringify({
        event: "showtime_scrape_error",
        cinema: cinemaName,
        error: String(err),
      }),
    );
    return [];
  }

  // 5. Normalise
  return raw.map((row) => ({
    title:       String(row.title ?? row.description ?? "Unknown"),
    showtime:    row.showtime != null ? String(row.showtime) : null,
    certificate: row.certificate != null ? String(row.certificate) : null,
    cinema:      cinemaName,
    _sourceTag:  fetchUrl,
  }));
}
