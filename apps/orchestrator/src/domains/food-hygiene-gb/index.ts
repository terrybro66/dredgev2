/**
 * food-hygiene-gb/index.ts — Phase 0 migration
 *
 * Migrated from flat DomainConfig to DomainConfigV2 + pipeline executor.
 * Template: listings (name, price, category, location, date)
 * Source:   FSA Ratings API (api.ratings.food.gov.uk)
 */

import type { DomainConfigV2 } from "@dredge/schemas";
import { createPipelineAdapter } from "../generic-adapter";
import { fetchFoodEstablishments, fetchFoodEstablishmentsByCoord } from "./fetcher";

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
  return Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : null;
}

const config: DomainConfigV2 = {
  identity: {
    name: "food-hygiene-gb",
    displayName: "Food Hygiene Ratings",
    description:
      "FSA food hygiene ratings for restaurants, cafes, and food businesses in GB",
    countries: ["GB"],
    intents: ["food hygiene"],
  },

  source: {
    type: "rest",
    endpoint: "https://api.ratings.food.gov.uk/Establishments",
  },

  template: {
    type: "listings",
    capabilities: {
      has_coordinates: true,
      has_category: true,
    },
  },

  // Fields map to FoodEstablishment property names (the shape returned by the
  // fetcher after transforming raw FSA response — not the raw FSA field names).
  fields: {
    description: { source: "name",         type: "string", role: "label" },
    category:    { source: "businessType", type: "string", role: "dimension" },
    location:    { source: "address",      type: "string", role: "label" },
    lat:         { source: "lat",          type: "number", role: "location_lat" },
    lon:         { source: "lon",          type: "number", role: "location_lon" },
    value:       { source: "rating",       type: "string", role: "metric" },
  },

  time: { type: "static" },

  recovery: [],

  storage: {
    storeResults: true,
    tableName: "query_results",
    prismaModel: "queryResult",
    extrasStrategy: "retain_unmapped",
  },

  visualisation: {
    default: "table",
    rules: [],
  },
};

// The pipeline executor handles fetchData, flattenRow, storeResults.
// We override fetchData because the FSA API is queried by place name
// (not polygon/coordinates) — the fetcher takes plan.location directly.
const base = createPipelineAdapter(config);

export const foodHygieneGbAdapter = {
  ...base,

  async fetchData(plan: any, poly: string): Promise<unknown[]> {
    // Prefer lat/lon from the query polygon — more accurate than a city name
    // string and works correctly when called from a chip carrying a different
    // domain's polygon (e.g., a cinema location chip).
    const centroid = polyCentroid(poly);
    const rawRows = centroid
      ? await fetchFoodEstablishmentsByCoord(centroid.lat, centroid.lon)
      : await fetchFoodEstablishments((plan.location ?? "").split(",")[0].trim());
    return rawRows.map((row) => base.flattenRow(row));
  },
};
