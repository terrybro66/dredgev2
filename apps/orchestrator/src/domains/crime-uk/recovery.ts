import { FallbackInfo, QueryPlan } from "@dredge/schemas";
import { fetchCrimes } from "./fetcher";
import { geocodeToPolygon } from "../../geocoder";
import { getLatestMonth, isMonthAvailable } from "../../availability";

export interface RecoveryResult {
  data: unknown[];
  fallback: FallbackInfo;
}

// ── Strategy 1: date fallback ─────────────────────────────────────────────────

export async function recoverWithLatestMonth(
  plan: QueryPlan,
  poly: string,
): Promise<RecoveryResult | null> {
  const latest = await getLatestMonth("police-uk");
  if (!latest) return null;

  // Month exists in availability — just no data there, don't substitute
  if (await isMonthAvailable("police-uk", plan.date_from)) return null;

  const fallbackPlan: QueryPlan = {
    ...plan,
    date_from: latest,
    date_to: latest,
  };
  const data = await fetchCrimes(fallbackPlan, poly);
  if (data.length === 0) return null;

  return {
    data,
    fallback: {
      field: "date",
      original: plan.date_from,
      used: latest,
      explanation: `No data available for ${plan.date_from} — showing ${latest} instead`,
    },
  };
}

// ── Strategy 2: smaller radius ────────────────────────────────────────────────

export async function recoverWithSmallerRadius(
  plan: QueryPlan,
  poly: string,
  prisma: any,
): Promise<RecoveryResult | null> {
  let smallerPoly: string;
  try {
    const geocoded = await geocodeToPolygon(`${plan.location} 2km`, prisma);
    smallerPoly = geocoded.poly;
  } catch {
    return null;
  }

  const data = await fetchCrimes(plan, smallerPoly);
  if (data.length === 0) return null;

  return {
    data,
    fallback: {
      field: "radius",
      original: "5km",
      used: "2km",
      explanation:
        "No results for the full area — showing a smaller radius instead",
    },
  };
}

// ── Strategy 3: all-crime broadening ─────────────────────────────────────────

export async function recoverWithAllCrime(
  plan: QueryPlan,
  poly: string,
): Promise<RecoveryResult | null> {
  if (plan.category === "all-crime") return null;

  const fallbackPlan: QueryPlan = { ...plan, category: "all-crime" };
  const data = await fetchCrimes(fallbackPlan, poly);
  if (data.length === 0) return null;

  return {
    data,
    fallback: {
      field: "category",
      original: plan.category,
      used: "all-crime",
      explanation: `No ${plan.category} found — showing all crime types instead`,
    },
  };
}

// ── Orchestrator ──────────────────────────────────────────────────────────────

export async function recoverFromEmpty(
  plan: QueryPlan,
  poly: string,
  prisma: any,
): Promise<RecoveryResult | null> {
  return (
    (await recoverWithLatestMonth(plan, poly)) ??
    (await recoverWithSmallerRadius(plan, poly, prisma)) ??
    (await recoverWithAllCrime(plan, poly))
  );
}
