/**
 * domain-slug.ts
 *
 * Maps LLM-returned category strings to canonical domain slugs so that
 * refinement routing and cache hashing agree on what "domain" a query
 * belongs to, regardless of how the LLM phrased it.
 *
 * Used by:
 *   query.ts  — domain-match guard for Tier 2 refinement (Phase C)
 *   query.ts  — CATEGORY_TO_INTENT routing map (adapter selection)
 */

export const CATEGORY_TO_INTENT: Record<string, string> = {
  burglary: "crime",
  "all-crime": "crime",
  drugs: "crime",
  robbery: "crime",
  "violent-crime": "crime",
  "bicycle-theft": "crime",
  "anti-social-behaviour": "crime",
  "vehicle-crime": "crime",
  shoplifting: "crime",
  "criminal-damage-arson": "crime",
  "other-theft": "crime",
  "possession-of-weapons": "crime",
  "public-order": "crime",
  "theft-from-the-person": "crime",
  "other-crime": "crime",
  "crime statistics": "crime",
  flooding: "flood risk",
  "flood warnings": "flood risk",
  "flood alerts": "flood risk",
  "flood risk": "flood risk",
  "cinema listings": "cinemas",
  "cinema showtimes": "cinemas",
  "films showing": "cinemas",
  "hunting zones": "hunting zones",
  "open access land": "hunting zones",
  "game management areas": "hunting zones",
  "weather forecast": "weather",
  "weather data": "weather",
  "weather conditions": "weather",
  "current weather": "weather",
  temperature: "weather",
  forecast: "weather",
  precipitation: "weather",
  climate: "weather",
  "food businesses": "food hygiene",
  "food business registrations": "food hygiene",
  "food hygiene ratings": "food hygiene",
  "food hygiene": "food hygiene",
  "food safety": "food hygiene",
  "food establishments": "food hygiene",
  restaurants: "food hygiene",
  takeaways: "food hygiene",
  cafes: "food hygiene",
};

/**
 * Normalise an intent + category pair to a canonical domain slug.
 *
 * Resolution order:
 *   1. intent (already classified by semantic classifier) — most reliable
 *   2. CATEGORY_TO_INTENT[intent]                        — e.g. "crime statistics" → "crime"
 *   3. CATEGORY_TO_INTENT[category]                      — fallback on raw LLM category
 *   4. intent or category as-is                          — last resort
 */
export function normalizeToDomainSlug(
  intent: string | undefined,
  category: string,
): string {
  if (intent && CATEGORY_TO_INTENT[intent]) return CATEGORY_TO_INTENT[intent];
  if (intent && intent !== "unknown") return intent;
  return CATEGORY_TO_INTENT[category] ?? category ?? "unknown";
}
