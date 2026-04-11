/**
 * hunting-zones-gb/fetcher.ts — Phase D.10
 *
 * Fetches GB open-access land areas from the Natural England ArcGIS REST API.
 * These are Countryside and Rights of Way (CRoW) Act 2000 open access areas —
 * the statutory land base for game management and shooting in England.
 *
 * Source: Natural England Open Data
 * URL:    https://environment.data.gov.uk/arcgis/rest/services/NE/
 *                 CRoW_Open_Access_Land/FeatureServer/0/query
 *
 * Output coordinates: WGS84 (EPSG:4326) via outSR=4326 + returnCentroid=true.
 * Area in hectares: Shape_Area (m²) ÷ 10,000.
 *
 * Results are filtered to the supplied polygon bounding box when one is given,
 * or returned as a national sample (up to MAX_RESULTS) when not.
 */

import { parsePoly } from "../../poly";

const BASE_URL =
  "https://environment.data.gov.uk/arcgis/rest/services/NE/CRoW_Open_Access_Land/FeatureServer/0/query";

const MAX_RESULTS = 100;

export interface HuntingZoneRow {
  name: string;
  county: string | null;
  area_ha: number | null;
  lat: number | null;
  lon: number | null;
  access_type: string | null; // "Open Country", "Registered Common Land", etc.
  source_id: string;
}

interface ArcGISFeature {
  attributes: Record<string, unknown>;
  centroid?: { x: number; y: number };
  geometry?: { x?: number; y?: number; rings?: number[][][] };
}

interface ArcGISResponse {
  features?: ArcGISFeature[];
  error?: { message?: string };
}

/**
 * Fetch open access land zones, optionally constrained to a bounding box
 * derived from the supplied polygon string.
 *
 * @param poly  WKT/encoded polygon string from geocoder (may be empty/null)
 */
export async function fetchHuntingZones(
  poly: string | null,
): Promise<HuntingZoneRow[]> {
  const params = new URLSearchParams({
    where: "1=1",
    outFields: "OBJECTID,NAME,COUNTY,CATEGORY,Shape_Area",
    outSR: "4326",
    returnGeometry: "true",
    resultRecordCount: String(MAX_RESULTS),
    f: "json",
  });

  // When a polygon is provided, add a geometry envelope filter.
  // ArcGIS REST expects geometry as a JSON object string.
  if (poly && poly.trim()) {
    params.set("geometry", parsePoly(poly).toArcGisEnvelope());
    params.set("geometryType", "esriGeometryEnvelope");
    params.set("spatialRel", "esriSpatialRelIntersects");
    params.set("inSR", "4326");
  }

  const url = `${BASE_URL}?${params.toString()}`;
  const res = await fetch(url, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(10_000),
  });

  if (!res.ok) {
    throw new Error(`NE ArcGIS API returned ${res.status}`);
  }

  const json = (await res.json()) as ArcGISResponse;
  console.log(JSON.stringify({ event: "arcgis_response", error: json.error ?? null, features: json.features?.length ?? 0 }));
  if (json.error) {
    throw new Error(`NE ArcGIS API error: ${json.error.message ?? "unknown"}`);
  }

  return (json.features ?? [])
    .map(featureToRow)
    .filter((r): r is HuntingZoneRow => r !== null);
}

// ── Internal helpers ──────────────────────────────────────────────────────────

function featureToRow(feature: ArcGISFeature): HuntingZoneRow | null {
  const a = feature.attributes;
  const name = (a.NAME as string | undefined)?.trim();
  if (!name) return null;

  // Centroid from ArcGIS returnCentroid (preferred)
  let lat: number | null = null;
  let lon: number | null = null;

  if (feature.centroid) {
    lon = feature.centroid.x;
    lat = feature.centroid.y;
  } else if (feature.geometry) {
    // Fallback: first ring first point
    const ring = feature.geometry.rings?.[0];
    if (ring && ring[0]) {
      lon = ring[0][0];
      lat = ring[0][1];
    }
  }

  // area_ha: Shape_Area is in m² (projected); divide by 10,000
  const shapeArea = typeof a.Shape_Area === "number" ? a.Shape_Area : null;
  const area_ha = shapeArea !== null ? Math.round(shapeArea / 10_000) : null;

  return {
    name,
    county: (a.COUNTY as string | undefined) ?? null,
    area_ha,
    lat,
    lon,
    access_type: (a.CATEGORY as string | undefined) ?? null,
    source_id: String(a.OBJECTID ?? ""),
  };
}

