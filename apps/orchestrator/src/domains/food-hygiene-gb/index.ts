/**
 * food-hygiene-gb/index.ts
 *
 * DomainAdapter for FSA food hygiene ratings.
 * Returns food establishments with hygiene ratings for a given location.
 *
 * Intent:  "food hygiene"
 * Source:  FSA Ratings API (api.ratings.food.gov.uk)
 * Viz:     map (lat/lon present on most rows)
 * Refresh: weekly (ratings updated by local authorities)
 * Countries: GB
 */

import type { DomainAdapter } from "../registry";
import { fetchFoodEstablishments, type FoodEstablishment } from "./fetcher";

export const foodHygieneGbAdapter: DomainAdapter = {
  config: {
    name: "food-hygiene-gb",
    tableName: "query_results",
    prismaModel: "queryResult",
    countries: ["GB"],
    intents: ["food hygiene"],
    apiUrl: "https://api.ratings.food.gov.uk/Establishments",
    apiKeyEnv: null,
    locationStyle: "coordinates",
    params: {},
    flattenRow: {},
    categoryMap: {},
    vizHintRules: { defaultHint: "table", multiMonthHint: "table" },
    cacheTtlHours: 168, // 1 week
    storeResults: true,
  },

  async fetchData(plan: any, _poly: string): Promise<unknown[]> {
    // FSA API searches by place name, not polygon — use plan.location directly
    // FSA API works best with just the town/city name — strip county, country
    const location = (plan.location ?? "")
      .split(",")[0]
      .trim();
    return fetchFoodEstablishments(location);
  },

  flattenRow(row: unknown): Record<string, unknown> {
    const r = row as FoodEstablishment;
    return {
      description: r.name,
      category: r.businessType ?? "Food Business",
      location: r.address ?? r.localAuthority ?? null,
      lat: r.lat,
      lon: r.lon,
      extras: {
        rating: r.rating,
        ratingDate: r.ratingDate,
        postCode: r.postCode,
        localAuthority: r.localAuthority,
        businessType: r.businessType,
      },
    };
  },

  async storeResults(queryId: string, rows: unknown[], prisma: any): Promise<void> {
    if (rows.length === 0) return;
    const flat = rows.map((r) => foodHygieneGbAdapter.flattenRow(r));
    await prisma.queryResult.createMany({
      data: flat.map((row) => ({
        query_id: queryId,
        domain_name: "food-hygiene-gb",
        source_tag: "fsa-ratings",
        lat: (row.lat as number) ?? null,
        lon: (row.lon as number) ?? null,
        location: (row.location as string) ?? null,
        description: (row.description as string) ?? null,
        category: (row.category as string) ?? null,
        value: null,
        raw: row,
        extras: (row.extras as object) ?? null,
        snapshot_id: null,
        date: null,
      })),
    });
  },
};
