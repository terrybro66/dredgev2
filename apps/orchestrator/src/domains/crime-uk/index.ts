import { DomainAdapter } from "../registry";
import { fetchCrimes, normalizeCrimeCategory } from "./fetcher";
import { storeResults } from "./store";
import { recoverFromEmpty } from "./recovery";
import { resolveTemporalRangeForCrime } from "../../temporal-resolver";

export const crimeUkAdapter: DomainAdapter = {
  config: {
    name: "crime-uk",
    tableName: "crime_results",
    prismaModel: "crimeResult",
    defaultOrderBy: { month: "asc" },
    countries: ["GB"],
    intents: ["crime"],
    apiUrl: "https://data.police.uk/api",
    apiKeyEnv: null,
    locationStyle: "polygon",
    params: {},
    flattenRow: { raw: "$" },
    categoryMap: {},
    vizHintRules: { defaultHint: "map", multiMonthHint: "bar" },
    rateLimit: { requestsPerMinute: 30 },
    cacheTtlHours: null,
    temporality: "time-series" as const,
    spatialAggregation: true,
    sourceLabel: "data.police.uk",
  },
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
