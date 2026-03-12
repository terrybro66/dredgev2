import axios from "axios";
import {
  CoordinatesSchema,
  PolygonSchema,
} from "@dredge/schemas";

const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";
const USER_AGENT = "dredge/1.0";

// normalise a place name to a consistent cache key
function normalisePlaceName(location: string): string {
  return location.trim().toLowerCase();
}

async function queryNominatim(location: string) {
  const response = await axios.get(NOMINATIM_URL, {
    params: { q: location, format: "json", limit: 1, addressdetails: 1 },
    headers: { "User-Agent": USER_AGENT },
  });

  const raw = response.data;

  if (!Array.isArray(raw) || raw.length === 0) {
    throw {
      error: "geocode_failed",
      understood: { location },
      missing: ["coordinates"],
      message: `Could not find location: "${location}". Please try a more specific place name.`,
    };
  }

  const rawHit = raw[0] as {
    lat: string;
    lon: string;
    display_name: string;
    boundingbox: string[];
    address?: { country_code?: string };
  };

  const country_code = (rawHit.address?.country_code ?? "").toUpperCase();

  return {
    lat: rawHit.lat,
    lon: rawHit.lon,
    display_name: rawHit.display_name,
    boundingbox: rawHit.boundingbox,
    country_code,
  };
}

export async function geocodeToPolygon(
  location: string,
  prisma: any,
  radiusMeters = 5000,
): Promise<{ poly: string; display_name: string; country_code: string }> {
  const place_name = normalisePlaceName(location);

  // ── cache lookup ────────────────────────────────────────────────────────────
  const cached = await prisma.geocoderCache.findUnique({
    where: { place_name },
  });

  if (cached?.poly) {
    // full hit — centroid and polygon both cached, skip Nominatim and PostGIS
    console.log(`[geocoder] cache hit (full): ${place_name}`);
    return {
      poly: cached.poly,
      display_name: cached.display_name,
      country_code: cached.country_code,
    };
  }

  // ── resolve centroid ────────────────────────────────────────────────────────
  let lat: number;
  let lon: number;
  let display_name: string;
  let country_code: string;

  if (cached) {
    // partial hit — centroid cached, polygon not yet generated, skip Nominatim
    console.log(`[geocoder] cache hit (partial): ${place_name}`);
    lat = cached.lat;
    lon = cached.lon;
    display_name = cached.display_name;
    country_code = cached.country_code;
  } else {
    // cold miss — call Nominatim
    const hit = await queryNominatim(location);
    lat = Number(hit.lat);
    lon = Number(hit.lon);
    display_name = hit.display_name;
    country_code = hit.country_code;
  }

  // ── generate polygon via PostGIS ────────────────────────────────────────────
  const rows = await prisma.$queryRaw<{ poly: string }[]>`
    SELECT string_agg(
      round(ST_Y(pt)::numeric, 6) || ',' || round(ST_X(pt)::numeric, 6),
      ':'
      ORDER BY n
    ) AS poly
    FROM (
      SELECT
        n,
        ST_Project(
          ST_SetSRID(ST_MakePoint(${lon}, ${lat}), 4326)::geography,
          ${radiusMeters},
          radians(n * (360.0 / 16))
        )::geometry AS pt
      FROM generate_series(0, 15) AS n
    ) pts
  `;

  const poly = PolygonSchema.parse(rows[0].poly);

  // ── cache write ─────────────────────────────────────────────────────────────
  if (cached) {
    // update existing row with the generated polygon
    await prisma.geocoderCache.update({
      where: { place_name },
      data: { poly },
    });
  } else {
    // write new row with centroid and polygon
    await prisma.geocoderCache.create({
      data: { place_name, display_name, lat, lon, country_code, poly },
    });
  }

  return { poly, display_name, country_code };
}

export async function geocodeToCoordinates(
  location: string,
  prisma: any,
): Promise<{
  lat: number;
  lon: number;
  display_name: string;
  country_code: string;
}> {
  const place_name = normalisePlaceName(location);

  // ── cache lookup ────────────────────────────────────────────────────────────
  const cached = await prisma.geocoderCache.findUnique({
    where: { place_name },
  });

  if (cached) {
    console.log(`[geocoder] cache hit: ${place_name}`);
    return CoordinatesSchema.parse({
      lat: cached.lat,
      lon: cached.lon,
      display_name: cached.display_name,
      country_code: cached.country_code,
    });
  }

  // ── cold miss — call Nominatim ──────────────────────────────────────────────
  const hit = await queryNominatim(location);

  const result = CoordinatesSchema.parse({
    lat: Number(hit.lat),
    lon: Number(hit.lon),
    display_name: hit.display_name,
    country_code: hit.country_code,
  });

  // ── cache write (poly null — not needed for coordinate domains) ─────────────
  await prisma.geocoderCache.create({
    data: {
      place_name,
      display_name: result.display_name,
      lat: result.lat,
      lon: result.lon,
      country_code: result.country_code,
      poly: null,
    },
  });

  return result;
}