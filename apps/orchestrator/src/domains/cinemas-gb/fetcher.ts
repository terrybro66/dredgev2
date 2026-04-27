/**
 * cinemas-gb/fetcher.ts
 *
 * Fetches UK cinema locations from the Overpass API (OpenStreetMap).
 * Returns venues with name, chain, lat, lon, address — stored persistently
 * in query_results (Track A). Showtimes are Track B (C.11).
 *
 * Overpass query: all amenity=cinema nodes and ways within the bounding
 * polygon, with a fallback to a GB-wide country-code query when no polygon
 * is provided.
 *
 * Rate limit: Overpass public instance allows ~1 req/s. We add a 1s delay
 * between retries only.
 */

import { parsePoly } from "../../poly";

// Public Overpass instances in priority order.
// Verified working: private.coffee and osm.ch respond reliably.
// If the primary returns 403/406/429/5xx we try the next in order.
const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
  "https://overpass.osm.ch/api/interpreter",
];

// Known chain name normalisations (lowercase match → display name)
const CHAIN_MAP: Record<string, string> = {
  odeon:        "Odeon",
  vue:          "Vue",
  cineworld:    "Cineworld",
  picturehouse: "Picturehouse",
  everyman:     "Everyman",
  curzon:       "Curzon",
  bfi:          "BFI",
  empire:       "Empire",
  showcase:     "Showcase",
  reel:         "Reel Cinemas",
};

function inferChain(name: string | undefined): string {
  if (!name) return "Independent";
  const lower = name.toLowerCase();
  for (const [key, display] of Object.entries(CHAIN_MAP)) {
    if (lower.includes(key)) return display;
  }
  return "Independent";
}

export interface CinemaRow {
  name: string;
  chain: string;
  lat: number;
  lon: number;
  address: string | null;
  website: string | null;
  osm_id: string;
}

function buildQuery(poly: string | null): string {
  if (poly) {
    const polyStr = parsePoly(poly).toOverpassPoly();
    return `
[out:json][timeout:25];
(
  node["amenity"="cinema"](poly:"${polyStr}");
  way["amenity"="cinema"](poly:"${polyStr}");
);
out center tags;
`.trim();
  }

  // Fallback: entire GB bounding box
  return `
[out:json][timeout:30];
area["ISO3166-1"="GB"][admin_level=2]->.gb;
(
  node["amenity"="cinema"](area.gb);
  way["amenity"="cinema"](area.gb);
);
out center tags;
`.trim();
}

/**
 * POST to one Overpass endpoint; returns the raw Response or throws.
 */
async function postToOverpass(
  endpoint: string,
  query: string,
): Promise<Response> {
  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Accept": "application/json",
      "User-Agent": "dredge/1.0 (https://github.com/dredge)",
    },
    body: `data=${encodeURIComponent(query)}`,
    signal: AbortSignal.timeout(35_000),
  });
  return res;
}

const RETRY_DELAY_MS = 300;

export async function fetchCinemas(poly: string | null): Promise<CinemaRow[]> {
  const query = buildQuery(poly);

  let lastError: Error | null = null;
  let res: Response | null = null;

  for (let i = 0; i < OVERPASS_ENDPOINTS.length; i++) {
    const endpoint = OVERPASS_ENDPOINTS[i];
    if (i > 0) await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
    try {
      const r = await postToOverpass(endpoint, query);
      // 429 = rate limited, 5xx = server error → try next mirror
      if (r.status === 400) {
        // Bad Overpass QL syntax — will fail on every mirror, don't retry
        throw new Error(`Overpass API error: ${r.status} ${r.statusText}`);
      }
      if (!r.ok) {
        // 403 (IP block), 406 (busy), 429 (rate limit), 5xx — try next mirror
        lastError = new Error(`Overpass ${endpoint}: ${r.status} ${r.statusText}`);
        continue;
      }
      res = r;
      break;
    } catch (err) {
      if (err instanceof Error && err.message.startsWith("Overpass API error")) {
        throw err; // fatal 4xx — don't retry
      }
      lastError = err instanceof Error ? err : new Error(String(err));
      // network error or timeout — try next mirror
    }
  }

  if (!res) {
    throw lastError ?? new Error("All Overpass endpoints failed");
  }

  const data = (await res.json()) as {
    elements: Array<{
      id: number;
      type: string;
      lat?: number;
      lon?: number;
      center?: { lat: number; lon: number };
      tags?: Record<string, string>;
    }>;
  };

  return data.elements
    .map((el) => {
      const lat = el.lat ?? el.center?.lat;
      const lon = el.lon ?? el.center?.lon;
      if (!lat || !lon) return null;

      const tags = el.tags ?? {};
      const name = tags["name"] ?? tags["brand"] ?? "Unknown Cinema";
      const street = tags["addr:street"] ?? null;
      const city   = tags["addr:city"] ?? tags["addr:town"] ?? null;
      const address = [street, city].filter(Boolean).join(", ") || null;

      return {
        name,
        chain:   inferChain(name),
        lat,
        lon,
        address,
        website: tags["website"] ?? tags["contact:website"] ?? null,
        osm_id:  `${el.type}/${el.id}`,
      } satisfies CinemaRow;
    })
    .filter((r): r is CinemaRow => r !== null);
}
