/**
 * food-hygiene-gb/index.ts — Phase 0 migration
 *
 * Migrated from flat DomainConfig to DomainConfigV2 + pipeline executor.
 * Template: listings (name, price, category, location, date)
 * Source:   FSA Ratings API (api.ratings.food.gov.uk)
 */

import type { DomainConfigV2 } from "@dredge/schemas";
import { createPipelineAdapter } from "../generic-adapter";
import { fetchFoodEstablishments } from "./fetcher";

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

  fields: {
    description: { source: "BusinessName", type: "string", role: "label" },
    category: { source: "BusinessType", type: "string", role: "dimension" },
    location: { source: "AddressLine3", type: "string", role: "label" },
    lat: { source: "geocode.latitude", type: "number", role: "location_lat" },
    lon: { source: "geocode.longitude", type: "number", role: "location_lon" },
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

  async fetchData(plan: any, _poly: string): Promise<unknown[]> {
    const location = (plan.location ?? "").split(",")[0].trim();
    const rawRows = await fetchFoodEstablishments(location);
    return rawRows.map((row) => base.flattenRow(row));
  },
};
