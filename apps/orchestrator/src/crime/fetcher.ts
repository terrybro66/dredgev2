import axios from "axios";
import { z } from "zod";
import { PoliceCrimeSchema, QueryPlan } from "@dredge/schemas";
import { expandDateRange } from "./intent";

const POLICE_API_BASE = "https://data.police.uk/api";

export type RawCrime = z.infer<typeof PoliceCrimeSchema>;

export async function fetchCrimesForMonth(
  plan: QueryPlan,
  poly: string,
  month: string,
): Promise<RawCrime[]> {
  const points = poly.split(":");
  if (points.length > 100) {
    throw new Error(`Polygon exceeds 100 points (got ${points.length})`);
  }

  const url = `${POLICE_API_BASE}/crimes-street/${plan.category}`;
  const response = await axios.get(url, {
    params: { date: month, poly },
  });

  try {
    return z.array(PoliceCrimeSchema).parse(response.data);
  } catch (err) {
    console.warn("Police API response validation warning:", err);
    // return what was parseable rather than throwing
    return z.array(PoliceCrimeSchema).safeParse(response.data).data ?? [];
  }
}

export async function fetchCrimes(
  plan: QueryPlan,
  poly: string,
): Promise<RawCrime[]> {
  const months = expandDateRange(plan.date_from, plan.date_to);
  const results: RawCrime[] = [];

  for (const month of months) {
    const crimes = await fetchCrimesForMonth(plan, poly, month);
    results.push(...crimes);
  }

  return results;
}
