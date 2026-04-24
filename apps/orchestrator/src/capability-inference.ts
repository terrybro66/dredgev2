/**
 * Capability inference — Phase C.2
 *
 * inferCapabilities()  — inspects row shapes and returns the Capability[] array
 * generateChips()      — maps capabilities to the initial Chip[] set (unranked)
 *
 * Neither function makes network calls or reads from the database.
 * Ranking (C.3) is a separate step that scores and trims the chip list to
 * CHIP_DISPLAY_MAX before it reaches the frontend.
 */

import type { TemplateType } from "@dredge/schemas";
import type { Capability, Chip, ResultHandle } from "./types/connected";
import type { DomainAdapter } from "./domains/registry";

// ── Row field accessors ───────────────────────────────────────────────────────

function asRecord(row: unknown): Record<string, unknown> {
  return row !== null && typeof row === "object"
    ? (row as Record<string, unknown>)
    : {};
}

function getField(row: unknown, ...keys: string[]): unknown {
  const r = asRecord(row);
  for (const k of keys) {
    if (r[k] !== undefined && r[k] !== null) return r[k];
  }
  // also check inside extras object
  const extras = asRecord(r["extras"]);
  for (const k of keys) {
    if (extras[k] !== undefined && extras[k] !== null) return extras[k];
  }
  return undefined;
}

// ── Individual capability checks ──────────────────────────────────────────────

/** has_coordinates — ≥ 80% of rows have non-null lat+lon or latitude+longitude */
function checkCoordinates(rows: unknown[]): boolean {
  if (rows.length === 0) return false;
  const withCoords = rows.filter((r) => {
    const lat = getField(r, "lat", "latitude");
    const lon = getField(r, "lon", "longitude");
    return lat != null && lon != null;
  });
  return withCoords.length / rows.length >= 0.8;
}

/** has_time_series — ≥ 2 distinct date values AND a numeric value or count field */
function checkTimeSeries(rows: unknown[]): boolean {
  if (rows.length < 2) return false;
  const hasNumeric = rows.some((r) => {
    const v = getField(r, "value");
    const c = getField(r, "count");
    return typeof v === "number" || typeof c === "number";
  });
  if (!hasNumeric) return false;
  const dates = new Set<string>();
  for (const r of rows) {
    const d = getField(r, "date");
    if (typeof d === "string") dates.add(d);
  }
  return dates.size >= 2;
}

/** has_polygon — any row has a GeoJSON Polygon or MultiPolygon geometry */
function checkPolygon(rows: unknown[]): boolean {
  return rows.some((r) => {
    const geom = asRecord(r)["geometry"];
    if (geom == null || typeof geom !== "object") return false;
    const t = (geom as Record<string, unknown>)["type"];
    return t === "Polygon" || t === "MultiPolygon";
  });
}

/** has_schedule — rows (or their extras) have both start_time and end_time */
function checkSchedule(rows: unknown[]): boolean {
  return rows.some((r) => {
    const start = getField(r, "start_time");
    const end = getField(r, "end_time");
    return start != null && end != null;
  });
}

/** has_category — non-null category field with ≥ 2 distinct values */
function checkCategory(rows: unknown[]): boolean {
  const values = new Set<string>();
  for (const r of rows) {
    const c = getField(r, "category");
    if (typeof c === "string" && c.length > 0) values.add(c);
  }
  return values.size >= 2;
}

// ── Public: inferCapabilities ─────────────────────────────────────────────────

/**
 * Infer capabilities from the shape of result rows.
 *
 * has_regulatory_reference and has_training_requirement are NOT inferred here —
 * they are set explicitly by RegulatoryAdapters when constructing the ResultHandle.
 */
export function inferCapabilities(rows: unknown[]): Capability[] {
  const caps: Capability[] = [];
  if (checkCoordinates(rows)) caps.push("has_coordinates");
  if (checkTimeSeries(rows)) caps.push("has_time_series");
  if (checkPolygon(rows)) caps.push("has_polygon");
  if (checkSchedule(rows)) caps.push("has_schedule");
  if (checkCategory(rows)) caps.push("has_category");
  return caps;
}

// ── Chip templates per capability ─────────────────────────────────────────────

type ChipTemplate = Omit<Chip, "args"> & { args: Omit<Chip["args"], "ref"> };

const CAPABILITY_CHIPS: Record<Capability, ChipTemplate[]> = {
  has_coordinates: [
    {
      label: "Show on map",
      action: "show_map",
      args: {},
    },
    {
      label: "Show as table",
      action: "show_table",
      args: {},
    },
    {
      label: "Get directions",
      action: "calculate_travel",
      args: {},
    },
  ],
  has_time_series: [
    {
      label: "Show as chart",
      action: "show_chart",
      args: {},
    },
  ],
  has_polygon: [
    {
      label: "Overlay with another layer",
      action: "overlay_spatial",
      args: {},
    },
  ],
  has_schedule: [
    {
      label: "See shows that don't clash",
      action: "filter_by",
      args: { constraint: "no_overlap" },
    },
  ],
  has_category: [
    {
      label: "Filter by category",
      action: "filter_by",
      args: { field: "category" },
    },
  ],
  has_regulatory_reference: [
    {
      label: "More information needed",
      action: "clarify",
      args: {},
    },
  ],
  has_training_requirement: [
    {
      label: "Training guidance",
      action: "fetch_domain",
      args: { domain: "training" },
    },
  ],
};

// ── Global action suppressions ────────────────────────────────────────────────
//
// Actions listed here are never emitted, regardless of domain or capability.
// Remove an entry only when the backing workflow is fully implemented.
//
//   overlay_spatial — no spatial join implementation; would error on click
//   clarify         — no /clarify backend handler; would error on click

const GLOBALLY_SUPPRESSED_ACTIONS = new Set(["overlay_spatial", "clarify"]);

// ── Per-domain action suppressions ───────────────────────────────────────────
//
// Chip actions listed here are not emitted for the named domain, regardless
// of which capabilities are inferred.  Remove an entry when the backing
// adapter or workflow exists and the action is safe to surface.

const SUPPRESSED_ACTIONS: Record<string, Set<string>> = {
  // calculate_travel opens the "reachable-area" workflow — useful for hunting
  // zones / cinemas, but confusing when applied to crime incident coordinates.
  "crime-uk": new Set(["calculate_travel"]),
};

// ── Domain-specific chip overrides ───────────────────────────────────────────
//
// Some domains generate chips that are not derivable from capability inference
// alone — they require knowledge of the domain's semantic role.
// These are injected AFTER the capability-based chips, before deduplication.

const DOMAIN_CHIPS: Record<string, ChipTemplate[]> = {
  "cinemas-gb": [
    {
      label: "What's on here?",
      action: "fetch_domain",
      args: { domain: "cinema-showtimes" },
    },
  ],
  "hunting-zones-gb": [
    {
      label: "Plan a day here",
      action: "fetch_domain",
      args: { domain: "hunting-day-plan" },
    },
  ],
};

// ── Template affinity engine ──────────────────────────────────────────────────
//
// After generating capability-based and domain-specific chips, scan all
// registered adapters for cross-domain affinity matches.
//
// Affinity matrix — edges represent "the source template type implies the
// user might also want results from a domain of the target template type":
//
//   incidents   →  boundaries  (spatial context)
//   incidents   →  places      (nearby venues)
//   incidents   →  forecasts   (conditions at time/location)
//   places      →  listings    (entity-level enrichment)
//   places      →  forecasts   (weather at that location)
//   listings    →  incidents   (area safety context)
//   boundaries  →  incidents   (what's happening inside this zone)
//   boundaries  →  places      (services within this zone)
//
// Only emit a chip if the target domain is currently registered AND is not
// the same domain as the current result AND is not a pipeline primitive.

const TEMPLATE_AFFINITY: Partial<Record<TemplateType, TemplateType[]>> = {
  incidents:  ["boundaries", "places", "forecasts"],
  places:     ["listings", "forecasts"],
  listings:   ["incidents"],
  boundaries: ["incidents", "places"],
};

/**
 * Domains that serve as pipeline primitives rather than user-facing data
 * sources. Excluded from cross-domain affinity chip generation.
 */
const PIPELINE_PRIMITIVE_DOMAINS = new Set(["geocoder", "travel-estimator"]);

/**
 * Build a human-readable label for a cross-domain affinity chip.
 * Tone matches existing chips: action-first, short.
 */
function affinityLabel(adapter: DomainAdapter): string {
  const displayName = adapter.config.identity.displayName;
  switch (adapter.config.template.type as TemplateType) {
    case "forecasts":   return `${displayName} forecast`;
    case "places":      return `${displayName} nearby`;
    case "listings":    return `${displayName} nearby`;
    case "incidents":   return `${displayName} in this area`;
    case "boundaries":  return `${displayName} zones`;
    default:            return displayName;
  }
}

// ── Public: generateChips ─────────────────────────────────────────────────────

/**
 * Generate all valid chips for a ResultHandle based on its capabilities,
 * domain-specific overrides, and cross-domain template affinity.
 *
 * Returns an unranked list — the chip ranker (C.4) scores and trims to
 * CHIP_DISPLAY_MAX before the response is sent.
 *
 * Pass `adapters` (all currently registered DomainAdapters) to enable
 * the template affinity engine. When omitted the engine is skipped and
 * only capability-based and domain-specific chips are returned.
 *
 * Every chip carries args.ref pointing back to the handle id so tools
 * can retrieve the result when the chip is clicked.
 */
export function generateChips(
  handle: ResultHandle,
  adapters: DomainAdapter[] = [],
): Chip[] {
  const chips: Chip[] = [];
  const seenKeys = new Set<string>();

  const dedupeKey = (tpl: ChipTemplate) =>
    `${tpl.action}:${tpl.args.domain ?? ""}:${tpl.args.constraint ?? ""}:${tpl.args.field ?? ""}`;

  const domainSuppressed = SUPPRESSED_ACTIONS[handle.domain] ?? new Set<string>();

  const push = (tpl: ChipTemplate) => {
    if (GLOBALLY_SUPPRESSED_ACTIONS.has(tpl.action)) return;
    if (domainSuppressed.has(tpl.action)) return;
    const key = dedupeKey(tpl);
    if (seenKeys.has(key)) return;
    seenKeys.add(key);
    chips.push({ ...tpl, args: { ...tpl.args, ref: handle.id } });
  };

  // 1. Capability-based chips
  for (const cap of handle.capabilities) {
    for (const tpl of CAPABILITY_CHIPS[cap] ?? []) push(tpl);
  }

  // 2. Domain-specific chips
  for (const tpl of DOMAIN_CHIPS[handle.domain] ?? []) push(tpl);

  // 3. Video guide chip — emitted for regulations template domains
  //    The frontend resolves a VideoSpec from chip.args.domain via mockSpecs,
  //    and later from a real spec builder when that is implemented.
  if (adapters.length > 0) {
    const sourceAdapter = adapters.find(
      (a) => a.config.identity.name === handle.domain,
    );
    if (sourceAdapter?.config.template.type === "regulations") {
      push({
        label: `Watch: ${sourceAdapter.config.identity.displayName} guide`,
        action: "play_video",
        args: {
          domain: handle.domain,
          intent: sourceAdapter.config.identity.intents[0] ?? handle.domain,
        },
      });
    }
  }

  // 5. Template affinity chips
  if (adapters.length > 0) {
    const sourceAdapter = adapters.find(
      (a) => a.config.identity.name === handle.domain,
    );
    const sourceTemplate = sourceAdapter?.config.template.type as
      | TemplateType
      | undefined;

    if (sourceTemplate) {
      const affinityTargets = TEMPLATE_AFFINITY[sourceTemplate] ?? [];
      for (const targetAdapter of adapters) {
        const targetName = targetAdapter.config.identity.name;
        if (targetName === handle.domain) continue;
        if (PIPELINE_PRIMITIVE_DOMAINS.has(targetName)) continue;
        const targetTemplate = targetAdapter.config.template.type as TemplateType;
        if (!affinityTargets.includes(targetTemplate)) continue;
        push({
          label: affinityLabel(targetAdapter),
          action: "fetch_domain",
          args: { domain: targetName },
        });
      }
    }
  }

  return chips;
}
