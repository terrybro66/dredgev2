/**
 * apps/orchestrator/src/curated-registry.ts
 *
 * A manually maintained list of known-good data sources, grouped by intent
 * and country code. Sits between the registered adapter lookup and the full
 * agentic discovery pipeline in the query execute handler.
 *
 * When a query matches a curated source, data is fetched immediately without
 * any LLM calls, browser automation, or human review.
 *
 * Rules:
 *   - Ephemeral sources (storeResults: false) must use refreshPolicy "realtime" or "static"
 *   - Scrape-type sources must include an extractionPrompt
 *   - All sources must declare a fieldMap mapping source fields to canonical names
 *
 * To add a new source: append an entry to CURATED_SOURCES. No code changes
 * required anywhere else.
 */

export interface CuratedSource {
  /** 2–4 word intent label — must match what the semantic classifier returns */
  intent: string;
  /** ISO 3166-1 alpha-2 country codes. Empty array = match any country */
  countryCodes: string[];
  /** Human-readable name for logging and admin UI */
  name: string;
  /** URL or URL template — use {location} for location-specific slugs */
  url: string;
  /** Transport type */
  type: "rest" | "csv" | "xlsx" | "pdf" | "scrape";
  /** Required when type === "scrape" */
  extractionPrompt?: string;
  /** false = return live results and discard; true = store in query_results */
  storeResults: boolean;
  /** How fresh this data needs to be */
  refreshPolicy: "realtime" | "daily" | "weekly" | "static";
  /** Maps source-specific field names to canonical query_results column names */
  fieldMap: Record<string, string>;
  locationSlugMap?: Record<string, string>;
}

export const CURATED_SOURCES: CuratedSource[] = [
  // ── Cinema listings (ephemeral) ─────────────────────────────────────────────
  {
    intent: "cinema listings",
    countryCodes: ["GB"],
    name: "Odeon UK",
    url: "https://www.odeon.co.uk/cinemas/{location}/",
    type: "scrape" as const,
    extractionPrompt:
      "Extract all movie titles and showtimes currently showing.",
    storeResults: false,
    refreshPolicy: "realtime",
    fieldMap: { title: "description", showtime: "date" },
    locationSlugMap: {
      braehead: "braehead",
      glasgow: "glasgow-fort",
      edinburgh: "edinburgh",
      birmingham: "birmingham",
      london: "west-end",
    },
  },
  {
    intent: "cinema listings",
    countryCodes: ["GB"],
    name: "Vue UK",
    url: "https://www.myvue.com/api/showtimes",
    type: "rest",
    storeResults: false,
    refreshPolicy: "realtime",
    fieldMap: {
      filmName: "description",
      performanceTime: "date",
      certificateCode: "extras.certificate",
    },
  },
  {
    intent: "cinema listings",
    countryCodes: ["GB"],
    name: "Cineworld UK",
    url: "https://www.cineworld.co.uk/api/quickbook/cinemas",
    type: "rest",
    storeResults: false,
    refreshPolicy: "realtime",
    fieldMap: {
      name: "description",
      date: "date",
    },
  },

  // ── Flood risk (persistent) ─────────────────────────────────────────────────
  {
    intent: "flood risk",
    countryCodes: ["GB"],
    name: "Environment Agency Flood Monitoring",
    url: "https://environment.data.gov.uk/flood-monitoring/id/floods",
    type: "rest",
    storeResults: true,
    refreshPolicy: "daily",
    fieldMap: {
      description: "description",
      eaAreaName: "location",
      severity: "category",
      message: "extras.message",
      severityLevel: "extras.severityLevel",
      timeRaised: "date",
      eaRegionName: "extras.region",
    },
  },

  // ── Transport (ephemeral) ───────────────────────────────────────────────────
  {
    intent: "transport",
    countryCodes: ["GB"],
    name: "TfL Unified API — Tube Status",
    url: "https://api.tfl.gov.uk/line/mode/tube/status",
    type: "rest",
    storeResults: false,
    refreshPolicy: "realtime",
    fieldMap: {
      name: "description",
      id: "extras.route_id",
    },
  },

  // ── ONS data (persistent) ───────────────────────────────────────────────────
  {
    intent: "population statistics",
    countryCodes: ["GB"],
    name: "ONS Population Estimates",
    url: "https://api.ons.gov.uk/v1/datasets/mid-year-pop-est/editions/time-series/versions/2/observations",
    type: "rest",
    storeResults: true,
    refreshPolicy: "static",
    fieldMap: {
      value: "value",
      geography: "location",
      time: "date",
    },
  },
];

/**
 * Find the first curated source matching the given intent and country code.
 * Intent matching is case-insensitive. Sources with empty countryCodes match
 * any country.
 *
 * Returns null if no match is found.
 */

export function resolveLocationSlug(
  resolvedLocation: string,
  slugMap: Record<string, string>,
): string | null {
  const lower = resolvedLocation.toLowerCase();
  for (const [key, slug] of Object.entries(slugMap)) {
    if (lower.includes(key.toLowerCase())) return slug;
  }
  return null;
}

export function findCuratedSource(
  intent: string,
  countryCode: string,
): CuratedSource | null {
  const normalised = intent.toLowerCase().trim();

  return (
    CURATED_SOURCES.find((source) => {
      const intentMatch = source.intent.toLowerCase() === normalised;
      const countryMatch =
        source.countryCodes.length === 0 ||
        source.countryCodes.includes(countryCode);
      return intentMatch && countryMatch;
    }) ?? null
  );
}
