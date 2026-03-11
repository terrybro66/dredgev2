import { PoliceCrimeSchema, RawCrime, QueryPlan } from "@dredge/schemas";
import { expandDateRange } from "./intent";

const BASE_URL = "https://data.police.uk/api/crimes-street";

// TODO: implement fetchCrimesForMonth(plan, poly, month: string): Promise<RawCrime[]>
// - validate poly does not exceed 100 points before calling API
// - call BASE_URL/{plan.category} with params { date: month, poly }
// - validate response with z.array(PoliceCrimeSchema).parse()
// - PoliceCrimeSchema uses .passthrough() — unknown fields preserved
// - log a warning on validation errors but do not throw
// - return RawCrime[]

export async function fetchCrimesForMonth(
  _plan: QueryPlan,
  _poly: string,
  _month: string
): Promise<RawCrime[]> {
  throw new Error("TODO: implement fetchCrimesForMonth");
}

// TODO: implement fetchCrimes(plan, poly): Promise<RawCrime[]>
// - expand date range to months array using expandDateRange(plan.date_from, plan.date_to)
// - call fetchCrimesForMonth for each month SEQUENTIALLY — not in parallel
// - sequential note: parallel requests for large date ranges can fail against the Police API
// - merge and return all results as a single flat array

export async function fetchCrimes(
  _plan: QueryPlan,
  _poly: string
): Promise<RawCrime[]> {
  throw new Error("TODO: implement fetchCrimes");
}
