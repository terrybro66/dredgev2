import type { DomainConfigV2 } from "@dredge/schemas";
import type { DomainAdapter } from "../registry";
import { fetchCrimes, normalizeCrimeCategory } from "./fetcher";
import { storeResults } from "./store";
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
    tableName: "crime_results",
    prismaModel: "crimeResult",
    extrasStrategy: "retain_unmapped",
    defaultOrderBy: { month: "asc" },
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
  storeResults: (queryId: string, rows: unknown[], prisma: any) =>
    storeResults(queryId, rows as any[], prisma),
  recoverFromEmpty: (plan: any, poly: string, prisma: any) =>
    recoverFromEmpty(plan, poly, prisma),
  normalizePlan: (plan: any) => ({
    ...plan,
    category: normalizeCrimeCategory(plan.category),
  }),
  resolveTemporalRange: (temporal: string) =>
    resolveTemporalRangeForCrime(temporal),
};
