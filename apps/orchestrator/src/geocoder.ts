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
  $queryRaw: (...args: unknown[]) => Promise<{ poly: string }[]>;
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
      params: { q: placeName, format: "json", limit: 1 },
      headers: { "User-Agent": "dredge/1.0" },
    },
  );

  const hits: NominatimHit[] = response.data;
  if (!hits || hits.length === 0) {
    geocodeFailed(["coordinates"]);
  }
  return hits[0];
}

// ── PostGIS polygon fetch ─────────────────────────────────────────────────────

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
  const country_code = hit.country_code.toUpperCase();

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

  // Full cache hit (poly already stored)
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
    // Partial hit — centroid cached, poly missing
    lat = cached.lat;
    lon = cached.lon;
    display_name = cached.display_name;
    country_code = cached.country_code;
  } else {
    // Cold miss — call Nominatim
    // Cold miss — call Nominatim first
    const hit = await fetchNominatim(placeName);
    lat = parseFloat(hit.lat);
    lon = parseFloat(hit.lon);
    display_name = hit.display_name;
    country_code = hit.country_code.toUpperCase();

    // Fetch poly BEFORE create, so create gets the complete row
    const poly = await fetchPolygon(prisma, lat, lon);
    await prisma.geocoderCache.create({
      data: { place_name: key, display_name, lat, lon, country_code, poly },
    });

    return { lat, lon, display_name, country_code, poly };

    // Write centroid row first, then update with poly below
    await prisma.geocoderCache.create({
      data: {
        place_name: key,
        display_name,
        lat,
        lon,
        country_code,
        poly: null,
      },
    });
  }

  // Fetch polygon via PostGIS
  const poly = await fetchPolygon(prisma, lat, lon);

  if (cached) {
    // Partial hit: update existing row with the new poly
    await prisma.geocoderCache.update({
      where: { place_name: key },
      data: { poly },
    });
  } else {
    // Cold miss: update the row we just created to add the poly
    await prisma.geocoderCache.update({
      where: { place_name: key },
      data: { poly },
    });
  }

  return { lat, lon, display_name, country_code, poly };
}
