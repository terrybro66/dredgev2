import type { DomainConfigV2 } from "@dredge/schemas";
import type { DomainAdapter } from "../registry";
import { fetchCrimes, normalizeCrimeCategory } from "./fetcher";
import { recoverFromEmpty } from "./recovery";
import { resolveTemporalRangeForCrime } from "../../temporal-resolver";

const crimeConfig: DomainConfigV2 = {
  identity: {
    name: "crime-uk",
    displayName: "UK Crime",
    description: "Street-level crime data for England, Wales and Northern Ireland from data.police.uk",
    countries: ["GB"],
    intents: ["crime"],
    sourceLabel: "data.police.uk",
  },
  source: {
    type: "rest",
    endpoint: "https://data.police.uk/api",
  },
  template: {
    type: "incidents",
    capabilities: {
      has_coordinates: true,
      has_time_series: true,
      has_category: true,
    },
    spatialAggregation: true,
  },
  fields: {
    description: { source: "location.street.name", type: "string", role: "label" },
    category: { source: "category", type: "string", role: "dimension" },
    lat: { source: "location.latitude", type: "number", role: "location_lat" },
    lon: { source: "location.longitude", type: "number", role: "location_lon" },
  },
  time: {
    type: "time_series",
    resolution: "month",
  },
  recovery: [],
  storage: {
    storeResults: true,
    tableName: "query_results",
    prismaModel: "queryResult",
    extrasStrategy: "retain_unmapped",
    defaultOrderBy: { date: "asc" },
  },
  visualisation: {
    default: "map",
    rules: [{ condition: "multi_month", view: "bar" }],
  },
  rateLimit: { requestsPerMinute: 30 },
};

export const crimeUkAdapter: DomainAdapter = {
  config: crimeConfig,

  fetchData: (plan: any, poly: string) => fetchCrimes(plan, poly),

  flattenRow: (row: unknown) => row as Record<string, unknown>,

  async storeResults(queryId: string, rows: unknown[], prismaClient: any): Promise<void> {
    if (rows.length === 0) return;
    await prismaClient.queryResult.createMany({
      data: (rows as Record<string, unknown>[]).map((row) => {
        const loc = row.location as Record<string, unknown> | undefined;
        const street = loc?.street as Record<string, unknown> | undefined;
        const outcome = row.outcome_status as Record<string, unknown> | undefined;
        return {
          query_id: queryId,
          domain_name: "crime-uk",
          source_tag: "data.police.uk",
          date: row.month ? new Date(`${row.month as string}-01`) : null,
          lat: loc?.latitude != null ? parseFloat(String(loc.latitude)) : null,
          lon: loc?.longitude != null ? parseFloat(String(loc.longitude)) : null,
          location: (street?.name as string) ?? null,
          description: (street?.name as string) ?? null,
          category: (row.category as string) ?? null,
          value: null,
          raw: row as object,
          extras: {
            persistent_id: (row.persistent_id as string) ?? null,
            outcome_category: (outcome?.category as string) ?? null,
            outcome_date: (outcome?.date as string) ?? null,
          },
          snapshot_id: null,
        };
      }),
    });
  },

  recoverFromEmpty: (plan: any, poly: string, prisma: any) =>
    recoverFromEmpty(plan, poly, prisma),

  normalizePlan: (plan: any) => ({
    ...plan,
    category: normalizeCrimeCategory(plan.category),
  }),

  resolveTemporalRange: (temporal: string) =>
    resolveTemporalRangeForCrime(temporal),
};
