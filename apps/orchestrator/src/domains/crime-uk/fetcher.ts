import axios from "axios";
import { z } from "zod";
import { PoliceCrimeSchema, QueryPlan } from "@dredge/schemas";
import { expandDateRange } from "../../intent";
import { getLatestMonth, isMonthAvailable } from "../../availability";
import pLimit from "p-limit";

const POLICE_API_BASE = "https://data.police.uk/api";

export type RawCrime = z.infer<typeof PoliceCrimeSchema>;

// ── Category normalisation ────────────────────────────────────────────────────
//
// The LLM returns free-text category names ("crime statistics", "vehicle crime")
// that are not valid police.uk API slugs.  This map converts the most common
// variants to the exact slugs the API accepts.  Anything not found here is
// slugified (spaces → dashes, lower-cased) and validated against the known-good
// set; unknown slugs fall back to "all-crime" so the query always returns data.

const VALID_SLUGS = new Set([
  "all-crime",
  "anti-social-behaviour",
  "bicycle-theft",
  "burglary",
  "criminal-damage-arson",
  "drugs",
  "other-crime",
  "other-theft",
  "possession-of-weapons",
  "public-order",
  "robbery",
  "shoplifting",
  "theft-from-the-person",
  "vehicle-crime",
  "violent-crime",
]);

const CATEGORY_SLUG_MAP: Record<string, string> = {
  // generic / LLM summary terms
  "crime statistics":   "all-crime",
  "crime":              "all-crime",
  "all crime":          "all-crime",
  "all-crime":          "all-crime",
  "unknown":            "all-crime",
  // common LLM variants (space instead of dash, missing suffix, etc.)
  "vehicle crime":      "vehicle-crime",
  "bicycle theft":      "bicycle-theft",
  "violent crime":      "violent-crime",
  "anti social behaviour": "anti-social-behaviour",
  "anti-social behaviour": "anti-social-behaviour",
  "criminal damage":    "criminal-damage-arson",
  "criminal damage and arson": "criminal-damage-arson",
  "weapons":            "possession-of-weapons",
  "possession of weapons": "possession-of-weapons",
  "public order":       "public-order",
  "theft from person":  "theft-from-the-person",
  "theft from the person": "theft-from-the-person",
  "other theft":        "other-theft",
  "other crime":        "other-crime",
};

export function normalizeCrimeCategory(raw: string): string {
  const lower = raw.trim().toLowerCase();
  if (CATEGORY_SLUG_MAP[lower]) return CATEGORY_SLUG_MAP[lower];
  const slugified = lower.replace(/\s+/g, "-");
  if (VALID_SLUGS.has(slugified)) return slugified;
  return "all-crime";
}

export async function fetchCrimesForMonth(
  plan: QueryPlan,
  poly: string,
  month: string,
): Promise<RawCrime[]> {
  const points = poly.split(":");
  if (points.length > 100) {
    throw new Error(`Polygon exceeds 100 points (got ${points.length})`);
  }

  const category = normalizeCrimeCategory(plan.category);
  const url = `${POLICE_API_BASE}/crimes-street/${category}`;

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
          category,
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
          category,
          month,
        }),
      );
      // wait 2s and retry once
      await new Promise((r) => setTimeout(r, 2000));
      const retry = await axios.get(
        `${POLICE_API_BASE}/crimes-street/${category}`,
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
  const allMonths = expandDateRange(plan.date_from, plan.date_to);

  // Pre-filter by availability — only request months the police.uk API has
  // published.  Falls open when the availability cache hasn't loaded yet
  // (getLatestMonth returns null), so startup without Redis is safe.
  const latest = await getLatestMonth("police-uk");
  const months = latest
    ? (await Promise.all(allMonths.map(async (m) => (await isMonthAvailable("police-uk", m)) ? m : null))).filter((m): m is string => m !== null)
    : allMonths;

  if (months.length === 0) {
    // Every requested month is beyond current API availability.
    // Return [] so recoverWithLatestMonth can substitute the latest known month.
    console.log(
      JSON.stringify({
        event: "police_api_months_unavailable",
        requested: allMonths,
        latest,
      }),
    );
    return [];
  }

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
