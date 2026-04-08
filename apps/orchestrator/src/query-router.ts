/**
 * QueryRouter — Phase C.1
 *
 * Three-tier routing for multi-turn query flows:
 *
 *   Tier 1 — Template match  (reachable-area, itinerary, cross-domain)
 *   Tier 2 — Refinement merge (narrowing of active_plan via pattern matching)
 *   Tier 3 — Fresh query      (falls through to normal intent → domain pipeline)
 *
 * The LLM fallback described in the architecture is a Phase C.1 stub — logged
 * Tier 3 calls will graduate to relationship entries or templates as patterns
 * emerge from production usage.
 *
 * All methods are synchronous except route(), which is async to allow the
 * LLM fallback to be wired in later without a breaking interface change.
 */

import type { QueryPlan } from "@dredge/schemas";
import {
  REFINEMENT_PATTERNS,
  type RefinementType,
  type ConversationMemory,
} from "./types/connected";

// ── Template matching ─────────────────────────────────────────────────────────

export interface TemplateMatch {
  name: "reachable-area" | "itinerary" | "cross-domain";
  params: Record<string, string>;
}

const TEMPLATE_PATTERNS: ReadonlyArray<{
  re: RegExp;
  name: TemplateMatch["name"];
  extract: (m: RegExpMatchArray) => Record<string, string>;
}> = [
  {
    // "X within N hours/minutes of Y by Z" or "X within N hours of Y"
    re: /\bwithin\s+(\d+)\s+(hour|minute|km|mile)s?\s+of\b/i,
    name: "reachable-area",
    extract: (m) => ({ amount: m[1], unit: m[2] }),
  },
  {
    // "plan a day of X" or "plan my day in X"
    re: /\bplan\s+(a|my)\s+day\b/i,
    name: "itinerary",
    extract: () => ({}),
  },
  {
    // "X and Y in the same area" or "X and Y in <place>"
    re: /\b(\w[\w\s]+)\s+and\s+(\w[\w\s]+)\s+in\b/i,
    name: "cross-domain",
    extract: (m) => ({ domainA: m[1].trim(), domainB: m[2].trim() }),
  },
];

export function matchTemplate(query: string): TemplateMatch | null {
  for (const { re, name, extract } of TEMPLATE_PATTERNS) {
    const m = query.match(re);
    if (m) return { name, params: extract(m) };
  }
  return null;
}

// ── Refinement detection ──────────────────────────────────────────────────────

// Queries that open with an interrogative word are new queries, not refinements.
// "What is the flood risk in York" contains "in York" (location_shift pattern)
// but is clearly a new intent, not a narrowing of the active plan.
const QUESTION_OPENER_RE =
  /^\s*(what|where|when|who|how|why|is|are|can|do|does)\b/i;

export function detectRefinement(
  query: string,
  activePlan: QueryPlan | null,
): RefinementType | null {
  if (!activePlan) return null;
  if (QUESTION_OPENER_RE.test(query)) return null;
  for (const { re, type } of REFINEMENT_PATTERNS) {
    if (re.test(query)) return type;
  }
  return null;
}

// ── Refinement application ────────────────────────────────────────────────────

/**
 * Attempts to produce a new QueryPlan by applying a RefinementType to the
 * existing plan. Returns null if the refinement cannot be resolved (caller
 * treats as a fresh query).
 */
export function applyRefinement(
  plan: QueryPlan,
  type: RefinementType,
  query: string,
): QueryPlan | null {
  switch (type) {
    case "date_shift":
      return applyDateShift(plan, query);

    case "location_shift":
      return applyLocationShift(plan, query);

    case "category_filter":
      return applyCategoryFilter(plan, query);

    case "aggregation_change":
      // Aggregation is a viz concern, not a QueryPlan concern — plan unchanged.
      return { ...plan };
  }
}

// ── date_shift ────────────────────────────────────────────────────────────────

const DATE_SHIFT_RE =
  /\b(last|past|previous)\s+(?:(\d+)\s+)?(year|month|week)s?\b/i;

function applyDateShift(plan: QueryPlan, query: string): QueryPlan | null {
  const m = query.match(DATE_SHIFT_RE);
  if (!m) return null;

  const amount = m[2] ? parseInt(m[2], 10) : 1;
  const unit = m[3].toLowerCase() as "year" | "month" | "week";

  // Convert everything to months
  const shiftMonths =
    unit === "year" ? amount * 12 : unit === "week" ? Math.ceil(amount / 4) : amount;

  // Parse date_to as the anchor (end of the range we're shifting from)
  const [toYear, toMonth] = plan.date_to.split("-").map(Number);
  const toTotal = toYear * 12 + toMonth;
  const fromTotal = toTotal - shiftMonths;

  if (fromTotal < 1) return null; // pre-epoch, bail

  const fromYear = Math.floor((fromTotal - 1) / 12);
  const fromMonth = ((fromTotal - 1) % 12) + 1;

  return {
    ...plan,
    date_from: `${fromYear}-${String(fromMonth).padStart(2, "0")}`,
    date_to: plan.date_to,
  };
}

// ── location_shift ────────────────────────────────────────────────────────────

const LOCATION_RE = /\b(?:in|near|around|for)\s+([A-Z][a-zA-Z\s]+?)(?:\s*$|[,.])/;

function applyLocationShift(plan: QueryPlan, query: string): QueryPlan | null {
  const m = query.match(LOCATION_RE);
  if (!m) return null;
  const location = m[1].trim();
  if (!location) return null;
  return { ...plan, location };
}

// ── category_filter ───────────────────────────────────────────────────────────

const CATEGORY_RE = /\bjust\s+(\w[\w\s-]*?)(?:\s*$|[,.])/i;

function applyCategoryFilter(plan: QueryPlan, query: string): QueryPlan | null {
  const m = query.match(CATEGORY_RE);
  if (!m) return null;
  const category = m[1].trim().toLowerCase();
  if (!category) return null;
  return { ...plan, category };
}

// ── RouteResult ───────────────────────────────────────────────────────────────

export type RouteResult =
  | { type: "refinement"; mergedPlan: QueryPlan }
  | { type: "template"; template: TemplateMatch }
  | { type: "fresh_query"; clearActivePlan: boolean };

// ── QueryRouter ───────────────────────────────────────────────────────────────

export class QueryRouter {
  /**
   * Route a query against the current conversation memory.
   *
   * Priority order:
   *   1. Template match  — composite/spatial patterns take unconditional priority
   *   2. Refinement      — narrowing of active_plan via REFINEMENT_PATTERNS
   *   3. Fresh query     — falls through to normal intent pipeline
   *
   * Tier 3 LLM fallback is intentionally omitted in this phase. Unresolvable
   * queries fall through to fresh_query and are logged. Recurring patterns in
   * those logs will graduate to Tier 1 templates or Tier 2 relationship entries.
   */
  async route(query: string, memory: ConversationMemory): Promise<RouteResult> {
    const { context } = memory;

    // Tier 1 — template
    const template = matchTemplate(query);
    if (template) {
      return { type: "template", template };
    }

    // Tier 2 — refinement
    const refinementType = detectRefinement(query, context.active_plan);
    if (refinementType) {
      const mergedPlan = applyRefinement(
        context.active_plan!,
        refinementType,
        query,
      );
      if (mergedPlan) {
        return { type: "refinement", mergedPlan };
      }
      // apply returned null — cannot merge, fall through as fresh query
      console.log(
        JSON.stringify({
          event: "refinement_unresolvable",
          refinementType,
          query,
        }),
      );
    }

    // Tier 3 — fresh query (LLM fallback stub — patterns logged for future promotion)
    console.log(
      JSON.stringify({
        event: "query_router_fresh",
        query,
        hasActivePlan: context.active_plan !== null,
      }),
    );
    return {
      type: "fresh_query",
      clearActivePlan: context.active_plan !== null,
    };
  }
}
