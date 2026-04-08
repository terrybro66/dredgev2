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

const OVERPASS_URL = "https://overpass-api.de/api/interpreter";

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
    // Convert "lat1,lon1:lat2,lon2:..." to Overpass poly format "lat1 lon1 lat2 lon2 ..."
    const polyStr = poly
      .split(":")
      .map((pair) => pair.replace(",", " "))
      .join(" ");
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

export async function fetchCinemas(poly: string | null): Promise<CinemaRow[]> {
  const query = buildQuery(poly);

  const res = await fetch(OVERPASS_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `data=${encodeURIComponent(query)}`,
    signal: AbortSignal.timeout(35_000),
  });

  if (!res.ok) {
    throw new Error(`Overpass API error: ${res.status} ${res.statusText}`);
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
