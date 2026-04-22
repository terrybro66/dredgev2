/**
 * flood-risk-gb/index.ts
 *
 * EA Flood Monitoring API — flood warning areas for England.
 * Template: boundaries (geographic zones with name, category, coordinates)
 *
 * API docs: https://environment.data.gov.uk/flood-monitoring/doc/reference
 *
 * Query strategy: when a poly centroid is available, query by lat/lon + dist
 * (radius in km). Fallback: return all currently active flood warnings.
 */

import type { DomainAdapter } from "../registry";
import type { DomainConfigV2 } from "@dredge/schemas";

// ── Poly centroid (inlined — same logic as generic-adapter) ───────────────────

function polyCentroid(poly: string): { lat: number; lon: number } | null {
  if (!poly) return null;
  const pts = poly.split(":").map((p) => {
    const [lat, lon] = p.split(",").map(Number);
    return { lat, lon };
  });
  if (pts.length === 0) return null;
  const lat = pts.reduce((s, p) => s + p.lat, 0) / pts.length;
  const lon = pts.reduce((s, p) => s + p.lon, 0) / pts.length;
  return { lat, lon };
}

// ── Config ────────────────────────────────────────────────────────────────────

const config: DomainConfigV2 = {
  identity: {
    name: "flood-risk-gb",
    displayName: "Flood Risk",
    description:
      "EA flood warning areas — current and historical flood zones in England",
    countries: ["GB"],
    intents: ["flood risk", "flooding", "flood warnings", "flood zones"],
  },

  source: {
    type: "rest",
    endpoint: "https://environment.data.gov.uk/flood-monitoring/id/floodAreas",
  },

  template: {
    type: "boundaries",
    capabilities: {
      has_coordinates: true,
      has_category: true,
    },
  },

  fields: {
    description: { source: "label",          type: "string", role: "label" },
    category:    { source: "floodWatchArea",  type: "string", role: "dimension" },
    location:    { source: "riverOrSea",      type: "string", role: "label" },
    lat:         { source: "lat",             type: "number", role: "location_lat" },
    lon:         { source: "long",            type: "number", role: "location_lon" },
  },

  time: { type: "realtime" },

  recovery: [],

  storage: {
    storeResults: true,
    tableName: "query_results",
    prismaModel: "queryResult",
    extrasStrategy: "retain_unmapped",
  },

  visualisation: {
    default: "map",
    rules: [],
  },

  cache: { ttlHours: 1 },
};

// ── Fetcher ───────────────────────────────────────────────────────────────────

async function fetchFloodAreas(poly: string): Promise<Record<string, unknown>[]> {
  const centroid = polyCentroid(poly);
  const url = centroid
    ? `https://environment.data.gov.uk/flood-monitoring/id/floodAreas?lat=${centroid.lat.toFixed(4)}&long=${centroid.lon.toFixed(4)}&dist=15`
    : "https://environment.data.gov.uk/flood-monitoring/id/floodAreas?county=England&_limit=50";

  const res = await fetch(url, {
    headers: { Accept: "application/json" },
  });

  if (!res.ok) {
    throw new Error(`EA flood API returned ${res.status}`);
  }

  const json = (await res.json()) as { items?: unknown[] };
  return (json.items ?? []) as Record<string, unknown>[];
}

// ── Row normalisation ─────────────────────────────────────────────────────────

function normaliseRow(raw: Record<string, unknown>): Record<string, unknown> {
  return {
    description: raw.label ?? null,
    category:    raw.floodWatchArea ?? null,
    location:    raw.riverOrSea ?? null,
    lat:         typeof raw.lat  === "number" ? raw.lat  : null,
    lon:         typeof raw.long === "number" ? raw.long : null,
    extras: {
      eaAreaCode:        raw.eaAreaCode ?? null,
      quickDialNumber:   raw.quickDialNumber ?? null,
      floodWatchAreaUrl: raw["@id"] ?? null,
      polyUrl:           raw.polygon ?? null,
    },
    raw,
  };
}

// ── Adapter ───────────────────────────────────────────────────────────────────

export const floodRiskGbAdapter: DomainAdapter = {
  config,

  async fetchData(_plan: unknown, poly: string): Promise<unknown[]> {
    try {
      const rawRows = await fetchFloodAreas(poly);
      return rawRows.map(normaliseRow);
    } catch (err) {
      console.warn(
        JSON.stringify({
          event: "flood_risk_fetch_error",
          error: err instanceof Error ? err.message : String(err),
        }),
      );
      return [];
    }
  },

  flattenRow(row: unknown): Record<string, unknown> {
    return normaliseRow(row as Record<string, unknown>);
  },

  async storeResults(
    queryId: string,
    rows: unknown[],
    prismaClient: any,
  ): Promise<void> {
    if (rows.length === 0) return;
    const data = (rows as Record<string, unknown>[]).map((row) => ({
      query_id:    queryId,
      domain_name: "flood-risk-gb",
      source_tag:  "flood-risk-gb",
      date:        null,
      lat:         (row.lat  as number) ?? null,
      lon:         (row.lon  as number) ?? null,
      location:    (row.location    as string) ?? null,
      description: (row.description as string) ?? null,
      category:    (row.category    as string) ?? null,
      value:       null,
      raw:         (row.raw    as object) ?? row,
      extras:      (row.extras as object) ?? null,
      snapshot_id: (row.snapshot_id as string) ?? null,
    }));
    await prismaClient.queryResult.createMany({ data });
  },
};
