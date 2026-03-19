import axios from "axios";
import { z } from "zod";
import { PoliceCrimeSchema, QueryPlan } from "@dredge/schemas";
import { expandDateRange } from "./intent";
import pLimit from "p-limit";

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

  try {
    const response = await axios.get(url, {
      params: { date: month, poly },
    });

    try {
      return z.array(PoliceCrimeSchema).parse(response.data);
    } catch (err) {
      console.warn("Police API response validation warning:", err);
      return z.array(PoliceCrimeSchema).safeParse(response.data).data ?? [];
    }
  } catch (err: any) {
    if (err?.response?.status === 404) {
      console.log(
        JSON.stringify({
          event: "police_api_no_data",
          category: plan.category,
          month,
          status: 404,
        }),
      );
      return [];
    }
    if (err?.response?.status === 429) {
      console.log(
        JSON.stringify({
          event: "police_api_rate_limited",
          category: plan.category,
          month,
        }),
      );
      // wait 2s and retry once
      await new Promise((r) => setTimeout(r, 2000));
      const retry = await axios.get(
        `${POLICE_API_BASE}/crimes-street/${plan.category}`,
        {
          params: { date: month, poly },
        },
      );
      return z.array(PoliceCrimeSchema).safeParse(retry.data).data ?? [];
    }
    throw err;
  }
}

import { setTimeout as sleep } from "timers/promises";

export async function fetchCrimes(
  plan: QueryPlan,
  poly: string,
): Promise<RawCrime[]> {
  const months = expandDateRange(plan.date_from, plan.date_to);
  const limit = pLimit(2); // reduce from 3 to 2

  const results = await Promise.all(
    months.map((month, i) =>
      limit(async () => {
        if (i > 0) await sleep(500); // 500ms gap between requests
        return fetchCrimesForMonth(plan, poly, month);
      }),
    ),
  );

  return results.flat();
}
