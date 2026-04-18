/**
 * cinemas-gb/index.ts — Phase 1 migration to DomainConfigV2
 *
 * Track A persistent domain for UK cinema locations.
 * Stores: name, chain, lat, lon, address — NOT showtimes.
 *
 * Intent: "cinemas" (distinct from "cinema listings" which is Track B scrape)
 * Source: OpenStreetMap via Overpass API
 * Refresh: weekly (venue data changes slowly)
 * Coverage: national GB, filtered to polygon when one is supplied
 *
 * Showtimes are Track B (C.11) — triggered as a connected query from a
 * cinema result chip, not as a standalone query.
 */

import type { DomainConfigV2 } from "@dredge/schemas";
import { createPipelineAdapter } from "../generic-adapter";
import { fetchCinemas, type CinemaRow } from "./fetcher";

const config: DomainConfigV2 = {
  identity: {
    name: "cinemas-gb",
    displayName: "Cinemas GB",
    description: "UK cinema locations from OpenStreetMap",
    countries: ["GB"],
    intents: ["cinemas"],
    sourceLabel: "openstreetmap",
  },
  source: {
    type: "overpass",
    query: `[out:json];node["amenity"="cinema"]({{bbox}});out body;`,
    spatial: "polygon",
  },
  template: {
    type: "places",
    capabilities: { has_coordinates: true, has_category: true },
  },
  fields: {
    description: { source: "tags.name", type: "string", role: "label" },
    category: { source: "tags.operator", type: "string", role: "dimension" },
    lat: { source: "lat", type: "number", role: "location_lat" },
    lon: { source: "lon", type: "number", role: "location_lon" },
    location: { source: "tags.addr:city", type: "string", role: "label" },
  },
  time: { type: "static" },
  recovery: [],
  storage: {
    storeResults: true,
    tableName: "query_results",
    prismaModel: "queryResult",
    extrasStrategy: "retain_unmapped",
  },
  visualisation: { default: "map", rules: [] },
  cache: { ttlHours: 168 },
};

const base = createPipelineAdapter(config);

export const cinemasGbAdapter = {
  ...base,
  async fetchData(_plan: unknown, poly: string): Promise<unknown[]> {
    const rows = await fetchCinemas(poly || null);
    return rows.map((r: CinemaRow) => ({
      description: r.name,
      category: r.chain,
      lat: r.lat,
      lon: r.lon,
      location: r.address ?? r.name,
      extras: { chain: r.chain, address: r.address, website: r.website, osm_id: r.osm_id },
      raw: r,
    }));
  },
};
