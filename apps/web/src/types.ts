// ── Shared data types ─────────────────────────────────────────────────────────
// Used by viz components, VizRenderer, App.tsx, and extracted result components.

/** Generic row produced by any domain adapter via query_results. */
export interface QueryRow {
  id?: string;
  date?: string | null;
  lat?: number | null;
  lon?: number | null;
  location?: string | null;
  description?: string | null;
  category?: string | null;
  value?: string | number | null;
  domain_name?: string;
  extras?: Record<string, unknown>;
  // crime-uk legacy fields (still written to query_results)
  month?: string;
  street?: string;
  outcome_category?: string;
  // pre-query_results lat/lon names carried by some rows
  latitude?: number | null;
  longitude?: number | null;
  [key: string]: unknown;
}

/** Pre-aggregated spatial bin returned by the server when result sets are large. */
export interface AggregatedBin {
  lat: number;
  lon: number;
  count: number;
}

/** Weather row — fields split at storage: temperature_max→value, rest in extras. */
export interface WeatherRow {
  id: string;
  date: string;
  temperature_max: number | null;
  temperature_min: number | null;
  precipitation: number | null;
  wind_speed: number | null;
  description: string | null;
}

// ── VizHint ───────────────────────────────────────────────────────────────────
// Driven by adapter config (visualisation.default) and returned in API responses.
// Extend this union — and VizSpec below — when adding new renderer types.

export type VizHint = "map" | "bar" | "table" | "dashboard";

// ── VizSpec — discriminated union for VizRenderer ────────────────────────────
// Each variant carries exactly the props its renderer needs.
// To add a new renderer: add a variant here, handle it in VizRenderer.tsx.

export type VizSpec =
  | { type: "map";       rows: QueryRow[] | AggregatedBin[]; aggregated: boolean }
  | { type: "bar";       rows: QueryRow[]; months: string[] }
  | { type: "table";     rows: QueryRow[]; activeFilter?: { field: string; value: string }; onClearFilter?: () => void }
  | { type: "dashboard"; rows: QueryRow[] };

// ── buildVizSpec ─────────────────────────────────────────────────────────────
// Converts the flat API response fields into a typed VizSpec.

export function buildVizSpec(
  hint: VizHint,
  rows: QueryRow[] | AggregatedBin[],
  opts: {
    aggregated?: boolean;
    months?: string[];
    activeFilter?: { field: string; value: string };
    onClearFilter?: () => void;
  } = {},
): VizSpec {
  switch (hint) {
    case "map":
      return { type: "map", rows, aggregated: opts.aggregated ?? false };
    case "bar":
      return { type: "bar", rows: rows as QueryRow[], months: opts.months ?? [] };
    case "table":
      return {
        type: "table",
        rows: rows as QueryRow[],
        activeFilter: opts.activeFilter,
        onClearFilter: opts.onClearFilter,
      };
    case "dashboard":
      return { type: "dashboard", rows: rows as QueryRow[] };
  }
}
