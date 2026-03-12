import axios from "axios";
import {
  NominatimResponseSchema,
  CoordinatesSchema,
  PolygonSchema,
} from "@dredge/schemas";

const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";
const USER_AGENT = "dredge/1.0";

async function queryNominatim(location: string) {
  const response = await axios.get(NOMINATIM_URL, {
    params: { q: location, format: "json", limit: 1 },
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

  const hit = NominatimResponseSchema.parse(raw)[0];
  const rawHit = raw[0] as { lat: string; lon: string };

  return { ...hit, lat: rawHit.lat, lon: rawHit.lon };
}

export async function geocodeToPolygon(
  location: string,
  prisma: any,
  radiusMeters = 5000,
): Promise<{ poly: string; display_name: string }> {
  const { lat, lon, display_name } = await geocodeToCoordinates(location);

  // generate a 16-point polygon approximation of a 5km circle via PostGIS
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
  return { poly, display_name };
}

export async function geocodeToCoordinates(
  location: string,
): Promise<{ lat: number; lon: number; display_name: string }> {
  const hit = await queryNominatim(location);
  const raw = hit as unknown as {
    lat: string;
    lon: string;
    display_name: string;
  };

  return CoordinatesSchema.parse({
    lat: Number(raw.lat),
    lon: Number(raw.lon),
    display_name: hit.display_name,
  });
}
