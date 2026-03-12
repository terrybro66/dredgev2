import { DomainAdapter } from "./registry";
import { fetchCrimes } from "../crime/fetcher";
import { storeResults } from "../crime/store";

export const crimeUkAdapter: DomainAdapter = {
  config: {
    name: "crime-uk",
    tableName: "crime_results",
    prismaModel: "crimeResult",
    countries: ["GB"],
    intents: ["crime"],
    apiUrl: "https://data.police.uk/api",
    apiKeyEnv: null,
    locationStyle: "polygon",
    params: {},
    flattenRow: { raw: "$" },
    categoryMap: {},
    vizHintRules: { defaultHint: "map", multiMonthHint: "bar" },
  },
  fetchData: (plan: any, poly: string) => fetchCrimes(plan, poly),
  flattenRow: (row: unknown) => row as Record<string, unknown>,
  storeResults: (queryId: string, rows: unknown[], prisma: any) =>
    storeResults(queryId, rows as any[], prisma),
};
