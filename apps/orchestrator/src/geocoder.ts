import axios from "axios";
import { Prisma } from "@prisma/client";

// ── Types ─────────────────────────────────────────────────────────────────────

interface GeocoderPrisma {
  geocoderCache: {
    findUnique: (args: {
      where: { place_name: string };
    }) => Promise<CacheRow | null>;
    create: (args: { data: CacheRow }) => Promise<unknown>;
    update: (args: {
      where: { place_name: string };
      data: Partial<CacheRow>;
    }) => Promise<unknown>;
  };
  $queryRaw: (...args: any[]) => Promise<{ poly: string }[]>;
}

interface CacheRow {
  place_name: string;
  display_name: string;
  lat: number;
  lon: number;
  country_code: string;
  poly: string | null;
}

interface CoordinateResult {
  lat: number;
  lon: number;
  display_name: string;
  country_code: string;
}

interface PolygonResult extends CoordinateResult {
  poly: string;
}

interface NominatimHit {
  display_name: string;
  boundingbox: string[];
  lat: string;
  lon: string;
  country_code: string;
  address?: { country_code?: string };
}

// ── IntentError ───────────────────────────────────────────────────────────────

function geocodeFailed(missing: string[]): never {
  throw { error: "geocode_failed", missing, message: "Geocoding failed" };
}

// ── Nominatim fetch ───────────────────────────────────────────────────────────
async function fetchNominatim(placeName: string): Promise<NominatimHit> {
  const response = await axios.get(
    "https://nominatim.openstreetmap.org/search",
    {
      params: { q: placeName, format: "json", limit: 1, addressdetails: 1 },
      headers: { "User-Agent": "dredge/1.0" },
      timeout: 10000,
    },
  );

  const hits: NominatimHit[] = response.data;
  if (!hits || hits.length === 0) {
    geocodeFailed(["coordinates"]);
  }
  const hit = hits[0];
  const country_code = (
    hit.address?.country_code ??
    hit.country_code ??
    ""
  ).toUpperCase();
  return { ...hit, country_code };
}
// ── Polygon generation (trig approximation, no PostGIS required) ──────────────

async function fetchPolygon(
  prisma: GeocoderPrisma,
  lat: number,
  lon: number,
): Promise<string> {
  const rows = await prisma.$queryRaw(
    Prisma.sql`
      SELECT string_agg(
        ST_Y(geom)::text || ',' || ST_X(geom)::text,
        ':'
        ORDER BY ord
      ) AS poly
      FROM (
        SELECT
          ST_Project(
            ST_SetSRID(ST_MakePoint(${lon}, ${lat}), 4326)::geography,
            5000,
            radians(ord * (360.0 / 16))
          )::geometry AS geom,
          ord
        FROM generate_series(0, 15) AS ord
      ) pts
    `,
  );
  return rows[0].poly;
}

// ── Nominatim reverse geocode ─────────────────────────────────────────────────

async function reverseGeocodeToDisplay(
  lat: number,
  lon: number,
): Promise<{ display_name: string; country_code: string }> {
  const response = await axios.get(
    "https://nominatim.openstreetmap.org/reverse",
    {
      params: { lat, lon, format: "json", zoom: 10, addressdetails: 1 },
      headers: { "User-Agent": "dredge/1.0" },
      timeout: 10000,
    },
  );
  const hit = response.data as {
    display_name?: string;
    address?: { country_code?: string };
    country_code?: string;
  };
  const country_code = (
    hit.address?.country_code ?? hit.country_code ?? ""
  ).toUpperCase();
  return {
    display_name: hit.display_name ?? `${lat.toFixed(4)}, ${lon.toFixed(4)}`,
    country_code,
  };
}

/**
 * Build a PolygonResult directly from browser/IP coordinates.
 * Reverse-geocodes to get a display name, then generates a 5 km polygon.
 * Used when the client provides GPS coords instead of a place name.
 */
export async function geocodeFromCoords(
  lat: number,
  lon: number,
  prisma: GeocoderPrisma,
): Promise<PolygonResult> {
  const { display_name, country_code } = await reverseGeocodeToDisplay(lat, lon);
  const poly = await fetchPolygon(prisma, lat, lon);
  return { lat, lon, display_name, country_code, poly };
}

// ── geocodeToCoordinates ──────────────────────────────────────────────────────

export async function geocodeToCoordinates(
  placeName: string,
  prisma: GeocoderPrisma,
): Promise<CoordinateResult> {
  const key = placeName.toLowerCase();

  // Cache hit
  const cached = await prisma.geocoderCache.findUnique({
    where: { place_name: key },
  });
  if (cached) {
    return {
      lat: cached.lat,
      lon: cached.lon,
      display_name: cached.display_name,
      country_code: cached.country_code,
    };
  }

  // Cache miss — call Nominatim
  const hit = await fetchNominatim(placeName);
  const lat = parseFloat(hit.lat);
  const lon = parseFloat(hit.lon);
  const country_code = (hit.country_code ?? "").toUpperCase();

  await prisma.geocoderCache.create({
    data: {
      place_name: key,
      display_name: hit.display_name,
      lat,
      lon,
      country_code,
      poly: null,
    },
  });

  return { lat, lon, display_name: hit.display_name, country_code };
}

// ── geocodeToPolygon ──────────────────────────────────────────────────────────

export async function geocodeToPolygon(
  placeName: string,
  prisma: GeocoderPrisma,
): Promise<PolygonResult> {
  const key = placeName.toLowerCase();

  const cached = await prisma.geocoderCache.findUnique({
    where: { place_name: key },
  });
  if (cached?.poly) {
    return {
      lat: cached.lat,
      lon: cached.lon,
      display_name: cached.display_name,
      country_code: cached.country_code,
      poly: cached.poly,
    };
  }

  let lat: number;
  let lon: number;
  let display_name: string;
  let country_code: string;

  if (cached) {
    // Partial hit — centroid cached but poly missing; skip Nominatim
    lat = cached.lat;
    lon = cached.lon;
    display_name = cached.display_name;
    country_code = cached.country_code;

    // Fetch poly from PostGIS then update the existing row
    const poly = await fetchPolygon(prisma, lat, lon);
    await prisma.geocoderCache.update({
      where: { place_name: key },
      data: { poly },
    });

    return { lat, lon, display_name, country_code, poly };
  }

  // Cold miss — call Nominatim first
  const hit = await fetchNominatim(placeName);
  lat = parseFloat(hit.lat);
  lon = parseFloat(hit.lon);
  display_name = hit.display_name;
  country_code = (hit.country_code ?? "").toUpperCase();

  // Fetch poly from PostGIS, then write a single complete cache row
  const poly = await fetchPolygon(prisma, lat, lon);
  await prisma.geocoderCache.create({
    data: { place_name: key, display_name, lat, lon, country_code, poly },
  });

  return { lat, lon, display_name, country_code, poly };
}
