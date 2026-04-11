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

export interface SearchStrategy {
  /** SerpAPI query template — {intent} and {location} are replaced at runtime */
  queryTemplate: string;
  /** Ranked preferred domains — first match in SerpAPI results wins */
  preferredDomains?: string[];
}

export interface CuratedSource {
  /** 2–4 word intent label — must match what the semantic classifier returns */
  intent: string;
  /** ISO 3166-1 alpha-2 country codes. Empty array = match any country */
  countryCodes: string[];
  /** Human-readable name for logging and admin UI */
  name: string;
  /** URL — required for non-scrape types. Optional when searchStrategy is present */
  url?: string;
  /** Transport type */
  type: "rest" | "csv" | "xlsx" | "pdf" | "scrape";
  /** Required when type === "scrape" */
  extractionPrompt?: string;
  /** When present on scrape-type sources, URL is discovered via SerpAPI at query time */
  searchStrategy?: SearchStrategy;
  /** false = return live results and discard; true = store in query_results */
  storeResults: boolean;
  /** How fresh this data needs to be */
  refreshPolicy: "realtime" | "daily" | "weekly" | "static";
  /** Maps source-specific field names to canonical query_results column names */
  fieldMap: Record<string, string>;
  /**
   * Optional: inject resolved lat/lon into the REST URL as query params.
   * When present, the fetchData closure appends these before calling the API.
   */
  locationParams?: {
    latParam: string;
    lonParam: string;
    radiusParam?: string;
    radiusKm?: number;
  };
}

export const CURATED_SOURCES: CuratedSource[] = [
  // ── Cinema listings (ephemeral — URL resolved via SerpAPI at query time) ────
  {
    intent: "cinema listings",
    countryCodes: ["GB"],
    name: "cinema-listings-gb",
    type: "scrape" as const,
    searchStrategy: {
      queryTemplate: "{intent} {location}",
      preferredDomains: [
        "odeon.co.uk",
        "myvue.com",
        "cineworld.co.uk",
        "picturehouses.com",
        "everymancinema.com",
      ],
    },
    extractionPrompt:
      "Find all movies currently showing on this cinema page. " +
      "Look for film listings, showtimes, or posters. " +
      "Return each film as an object with fields: title (string), showtime (string, if available), " +
      "certificate (string, e.g. PG/12A/15/18, if shown). " +
      "Return ALL films as an array under the key 'items'.",
    storeResults: false,
    refreshPolicy: "realtime",
    fieldMap: { title: "description", showtime: "date" },
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
    locationParams: {
      latParam: "lat",
      lonParam: "long",
      radiusParam: "dist",
      radiusKm: 20,
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

  // ── Hunting / game management zones (persistent) ───────────────────────────
  {
    intent:        "hunting zones",
    countryCodes:  ["GB"],
    name:          "Natural England CRoW Open Access Land",
    url:           "https://environment.data.gov.uk/arcgis/rest/services/NE/CRoW_Open_Access_Land/FeatureServer/0/query",
    type:          "rest",
    storeResults:  true,
    refreshPolicy: "weekly",
    fieldMap: {
      NAME:        "description",
      COUNTY:      "location",
      CATEGORY:    "category",
      Shape_Area:  "value",
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
