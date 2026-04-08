/**
 * cinemas-gb/index.ts — Phase C.10
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

import { DomainAdapter } from "../registry";
import { fetchCinemas, type CinemaRow } from "./fetcher";

export const cinemasGbAdapter: DomainAdapter = {
  config: {
    name:           "cinemas-gb",
    tableName:      "query_results",
    prismaModel:    "queryResult",
    countries:      ["GB"],
    intents:        ["cinemas"],
    apiUrl:         "https://overpass-api.de/api/interpreter",
    apiKeyEnv:      null,
    locationStyle:  "polygon",
    params:         {},
    flattenRow:     { name: "description", lat: "lat", lon: "lon" },
    categoryMap:    {},
    vizHintRules:   { defaultHint: "map", multiMonthHint: "map" },
    cacheTtlHours:  168, // 1 week
    storeResults:   true,
  },

  async fetchData(_plan: unknown, poly: string): Promise<unknown[]> {
    const rows = await fetchCinemas(poly || null);
    return rows;
  },

  flattenRow(row: unknown): Record<string, unknown> {
    const r = row as CinemaRow;
    return {
      description: r.name,
      category:    r.chain,
      lat:         r.lat,
      lon:         r.lon,
      location:    r.address ?? r.name,
      extras: {
        chain:   r.chain,
        address: r.address,
        website: r.website,
        osm_id:  r.osm_id,
      },
    };
  },

  async storeResults(
    queryId: string,
    rows: unknown[],
    prisma: any,
  ): Promise<void> {
    if (rows.length === 0) return;
    const flat = rows.map((r) => cinemasGbAdapter.flattenRow(r));
    await prisma.queryResult.createMany({
      data: flat.map((row) => ({
        domain_name:  "cinemas-gb",
        source_tag:   "openstreetmap",
        date:         null,
        lat:          (row.lat as number) ?? null,
        lon:          (row.lon as number) ?? null,
        location:     (row.location as string) ?? null,
        description:  (row.description as string) ?? null,
        category:     (row.category as string) ?? null,
        value:        null,
        raw:          row,
        extras:       (row.extras as object) ?? null,
        snapshot_id:  null,
      })),
    });
  },
};
