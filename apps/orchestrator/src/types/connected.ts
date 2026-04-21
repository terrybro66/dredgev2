/**
 * Connected query types — Phase C.0
 *
 * This file contains ONLY type definitions and a small number of pure-data
 * constants (REFINEMENT_PATTERNS, CAPABILITY_RULES). No I/O, no async functions,
 * no imports from infrastructure modules (Redis, Prisma, OpenAI).
 *
 * All downstream Phase C and D files import from here. Do not duplicate these
 * types elsewhere.
 */

import type { QueryPlan, VizHint } from "@dredge/schemas";
import type { SessionLocation } from "../session";

// ── Capability ────────────────────────────────────────────────────────────────

/**
 * Capabilities are inferred from the shape of a ResultHandle's data at query
 * time. They drive which chips are offered. They are never declared by the
 * domain author.
 *
 * Inference rules:
 *   has_coordinates      — ≥ 80% of rows have non-null lat + lon
 *   has_time_series      — rows span ≥ 2 distinct dates with a value or count field
 *   has_polygon          — result includes GeoJSON polygon geometry
 *   has_schedule         — rows have start_time and end_time in extras
 *   has_category         — rows have non-null category with ≥ 2 distinct values
 *   has_regulatory_reference — result type is DecisionResult from a RegulatoryAdapter
 *   has_training_requirement — regulatory result includes a non-empty conditions[]
 */
export type Capability =
  | "has_coordinates"
  | "has_time_series"
  | "has_polygon"
  | "has_schedule"
  | "has_category"
  | "has_regulatory_reference"
  | "has_training_requirement";

// ── ResultHandle ──────────────────────────────────────────────────────────────

/**
 * A typed abstraction that all chips and tools operate on. Every query result —
 * whether from query_results, a live API call, or a spatial computation —
 * produces a ResultHandle.
 *
 * Persistent handles (ephemeral: false):
 *   - data is in query_results; this handle carries row count + domain info only
 *   - survive across server restarts
 *
 * Ephemeral handles (ephemeral: true):
 *   - data is stored in Redis at session:handle:{sessionId}:{id}
 *   - TTL: 3600s (1 hour)
 *   - capped at MAX_EPHEMERAL_ROWS rows; if a source returns more the adapter
 *     must force ephemeral: false and write to query_results
 *   - evicted from result_stack when stack exceeds RESULT_STACK_MAX; Redis key
 *     is deleted immediately on eviction (no wait for TTL)
 *   - do NOT survive beyond Redis TTL; chip execution validates handle presence
 *     before firing and returns type: "error", error: "stale_reference" if absent
 */
export interface ResultHandle {
  id: string;              // "qr_456" | "ephemeral_abc"
  type: string;            // "cinema_venue" | "crime_incident" | "flood_warning" | "decision_result"
  domain: string;          // adapter name, e.g. "crime-uk"
  capabilities: Capability[];
  ephemeral: boolean;
  rowCount: number;
  data: unknown[] | null;  // non-null only when ephemeral: true
}

export const MAX_EPHEMERAL_ROWS = 100;
export const RESULT_STACK_MAX = 5;
export const EPHEMERAL_TTL_SECONDS = 3600;        // 1 hour
export const SESSION_TTL_SECONDS = 86400;         // 24 hours (QueryContext)
export const USER_PROFILE_TTL_SECONDS = 2592000;  // 30 days (UserProfile), refreshed on use

// ── ClarificationField / ClarificationRequest ─────────────────────────────────

/**
 * A single question the orchestrator poses to the user.
 *
 * target determines where the answer is stored in ConversationMemory:
 *   active_filters   — query constraints (date, category) — may be replaced per turn
 *   user_attributes  — facts about the user (age, residency) — persist for the session
 */
export interface ClarificationField {
  field: string;                                              // "date" | "age" | "residency"
  prompt: string;                                             // "What date are you going?"
  input_type: "text" | "number" | "select" | "boolean";
  options?: string[];                                         // for select type
  target: "active_filters" | "user_attributes";
}

/**
 * Returned by the orchestrator when it needs user input before producing a
 * result (regulatory/eligibility queries only). For data queries, the system
 * returns a partial result with filter chips instead.
 */
export interface ClarificationRequest {
  intent: string;                  // what the system will do once all questions are answered
  questions: ClarificationField[];
}

// ── DecisionResult / RegulatoryAdapter ───────────────────────────────────────

/**
 * Returned by RegulatoryAdapters (licensing, eligibility, planning permission).
 * Never written to query_results. Becomes a ResultHandle with type: "decision_result"
 * and has_regulatory_reference capability.
 */
export interface DecisionResult {
  eligibility: "eligible" | "ineligible" | "conditional";
  conditions: string[];                    // "Must complete Food Hygiene Level 2"
  next_questions: ClarificationField[];    // further attributes needed; may be empty
  references: string[];                    // links to official guidance
  /** Optional chips surfaced after a decision — e.g. "Find hunting zones near me".
   *  Rendered by DecisionResultPanel and dispatched via handleChipAction. */
  suggested_chips?: Chip[];
}

// ── Chip ──────────────────────────────────────────────────────────────────────

/**
 * Chip actions determine what executes when the user clicks.
 *
 *   filter_by          — narrow the current result by field + value
 *   overlay_spatial    — spatial join of two ResultHandles
 *   calculate_travel   — route from session.location to result coordinates
 *   compare_location   — same domain query with a different location
 *   fetch_domain       — cross-domain transition (loads a related domain)
 *   show_map           — switch viz to map
 *   show_chart         — switch viz to chart/dashboard
 *   clarify            — open an inline input; answer stored in user_attributes,
 *                        current regulatory query re-executes with new attribute
 */
export type ChipAction =
  | "filter_by"
  | "overlay_spatial"
  | "calculate_travel"
  | "compare_location"
  | "fetch_domain"
  | "show_map"
  | "show_chart"
  | "clarify";

export interface ChipArgs {
  ref?: string;                          // ResultHandle id, e.g. "qr_456"
  domain?: string;                       // target domain for fetch_domain
  filters?: Record<string, unknown>;     // for filter_by
  location?: string;                     // for compare_location
  field?: string;                        // for filter_by and clarify
  constraint?: string;                   // for filter_by: "no_overlap", etc.
  value?: unknown;                       // for filter_by: pre-bound filter value
}

export interface Chip {
  label: string;
  action: ChipAction;
  args: ChipArgs;
  score?: number;                        // computed by chip ranker; top 3 shown
  scoreBreakdown?: ChipScore;            // per-component scores for "Why this chip?" tooltip
                                         // and dev-mode reasoning sidebar
}

// ── Chip ranking formula ──────────────────────────────────────────────────────

/**
 * All valid chips are generated from capability inference, then scored:
 *
 *   score = (frequency_in_session_history × 0.4)
 *         + (spatial_relevance           × 0.3)
 *         + (recency_in_session          × 0.2)
 *         + (domain_relationship_weight  × 0.1)
 *
 * The top CHIP_DISPLAY_MAX are returned to the frontend. DomainRelationship
 * weights are looked up by (fromDomain, toDomain) pair at scoring time.
 */
export const CHIP_DISPLAY_MAX = 3;

export interface ChipScore {
  frequency: number;             // 0–1: how often this chip type is clicked in session history
  spatialRelevance: number;      // 0–1: spatial proximity of target domain to current result
  recency: number;               // 0–1: how recent in result_stack is the referenced handle
  relationshipWeight: number;    // 0–1: from DomainRelationship entry, 0 if none exists
}

export function computeChipScore(s: ChipScore): number {
  return (s.frequency * 0.4)
    + (s.spatialRelevance * 0.3)
    + (s.recency * 0.2)
    + (s.relationshipWeight * 0.1);
}

// ── DomainRelationship ────────────────────────────────────────────────────────

/**
 * A weighting input to chip ranking. NOT a routing mechanism.
 *
 * DomainRelationship entries adjust the score of already-valid chips. A chip
 * for "Show affected transport routes" appears because the result has_coordinates.
 * The relationship entry for (flood-risk, transport) boosts that chip's rank.
 * Without the entry the chip still appears, just with a lower score.
 */
export interface DomainRelationship {
  fromDomain: string;
  toDomain: string;
  relationshipType: "complements" | "extends" | "supercedes" | "conflicts";
  weight: number;           // 0–1; used as relationshipWeight in ChipScore
}

// ── QueryContext ──────────────────────────────────────────────────────────────

/**
 * Query-scoped session state. Expires with the session.
 *
 * Redis key:  session:context:{sessionId}
 * TTL:        SESSION_TTL_SECONDS (24h inactivity)
 *
 * Size limits enforced on every write:
 *   active_filters  — max 20 KV pairs; keys ≤ 64 chars, values ≤ 2,000 chars
 *   result_stack    — max RESULT_STACK_MAX handles
 *   total           — max 64KB; oversized writes log a warning and drop the
 *                     offending key — the write is never rejected
 *
 * ResultHandle storage: stored as a Redis hash at
 *   session:handles:{sessionId}
 * with handleId as the field and serialised ResultHandle as the value.
 * A single DEL clears all handles — no SCAN required.
 */
export interface QueryContext {
  location: SessionLocation | null;

  /** The most recent successfully executed QueryPlan. Used by the QueryRouter
   *  to detect refinement turns and merge new constraints rather than treating
   *  the follow-up as a new query. */
  active_plan: QueryPlan | null;

  /** The polygon string (WKT) for the most recent query's resolved location.
   *  Carried forward to chip-triggered queries so they cover the same area
   *  without re-geocoding. */
  active_poly: string | null;

  /** Last RESULT_STACK_MAX ResultHandle ids, newest first. Full handle data
   *  lives in the session:handles:{sessionId} Redis hash. */
  result_stack: ResultHandle[];

  /** Current query constraints accumulated across turns.
   *  Replacement semantics per type:
   *    category, date, location  → replaces existing value of that key
   *    exclude / negation keys   → composes (AND); multiple exclusions stack */
  active_filters: Record<string, unknown>;
}

// ── UserProfile ───────────────────────────────────────────────────────────────

/**
 * User-scoped state that persists across sessions.
 *
 * Redis key:  user:profile:{userId}
 * TTL:        USER_PROFILE_TTL_SECONDS (30 days, refreshed on use)
 *
 * user_attributes collected during ClarificationRequest flows (age, residency,
 * game species, business type) are stored here so the system does not
 * re-issue the same clarification questions when the user returns.
 *
 * Size limits:
 *   user_attributes   — max 50 KV pairs; keys ≤ 64 chars, values ≤ 2,000 chars
 *   location_history  — max 10 entries (home, work, recent places)
 *   total             — max 32KB
 */
export interface UserProfile {
  /** Facts about the user that feed into eligibility logic. Populated by
   *  ClarificationRequest answers with target: "user_attributes". */
  user_attributes: Record<string, unknown>;

  /** Learned locations (home, work, recently searched). Used to personalise
   *  "near me" resolution and chip spatial relevance scoring. */
  location_history: SessionLocation[];
}

// ── ConversationMemory ────────────────────────────────────────────────────────

/**
 * Composed view of QueryContext + UserProfile. Used by code that needs
 * both (e.g. the QueryRouter, chip ranker). Assembled from the two Redis
 * stores — never persisted as a single key.
 */
export interface ConversationMemory {
  context: QueryContext;
  profile: UserProfile;
}

// ── active_filters merge semantics (QueryContext.active_filters) ──────────────

/**
 * Keys whose values should compose (AND) rather than replace when a new value
 * arrives for the same filter type. All other filter keys replace on update.
 */
export const COMPOSING_FILTER_KEYS: ReadonlySet<string> = new Set([
  "exclude",
  "not",
  "exclude_category",
]);

// ── RefinementMerge ───────────────────────────────────────────────────────────

/**
 * The QueryRouter uses RefinementMerge to detect when a free-text follow-up is
 * a narrowing of the active_plan rather than a new query.
 *
 * Merge classification uses pattern matching first, LLM fallback second.
 * apply() returns null when the merge cannot be performed — the router then
 * treats the follow-up as a fresh query and clears active_plan.
 */
export type RefinementType =
  | "date_shift"
  | "location_shift"
  | "category_filter"
  | "aggregation_change";

export interface RefinementMerge {
  type: RefinementType;
  apply(plan: QueryPlan, refinement: string): QueryPlan | null;
}

export const REFINEMENT_PATTERNS: ReadonlyArray<{
  re: RegExp;
  type: RefinementType;
}> = [
  {
    re: /\b(last|past|previous)\s+(\d+\s+)?(year|month|week)s?\b/i,
    type: "date_shift",
  },
  {
    re: /\b(in|near|around|for)\s+[A-Z][a-z]/,
    type: "location_shift",
  },
  {
    re: /\bjust\s+\w+/i,
    type: "category_filter",
  },
  {
    re: /\bby\s+(month|week|day|year)s?\b/i,
    type: "aggregation_change",
  },
];

// ── OrchestratorResponse ──────────────────────────────────────────────────────

/**
 * Every /execute response is one of these four shapes. The frontend branches
 * on `type`.
 *
 * pending_clarification on type: "result" is returned when the regulatory
 * adapter produces a DecisionResult with non-empty next_questions — i.e. there
 * is a result but further input is needed to refine it. The standalone
 * type: "clarification" is returned when there is no result yet at all (e.g.
 * hunting licence before age and residency are known).
 *
 * A type: "result_with_clarification" union member was considered and rejected —
 * it would proliferate as more hybrid states emerge. The optional field is
 * additive without changing the union shape.
 */
export type OrchestratorResponse =
  | {
      type: "result";
      handle: ResultHandle;
      chips: Chip[];
      viz: VizHint;
      pending_clarification?: ClarificationRequest;
    }
  | {
      type: "clarification";
      request: ClarificationRequest;
    }
  | {
      type: "not_supported";
      message: string;
      supported: string[];
    }
  | {
      type: "error";
      error: string;
      message: string;
      /** Present when error === "stale_reference". A chip that re-runs the
       *  original query so the user can recover with one click rather than
       *  retyping their query. */
      refresh_chip?: Chip;
    };

// ── WorkflowTemplate — Phase D.7 ─────────────────────────────────────────────

/**
 * A WorkflowInputField is a single question asked of the user before a
 * workflow begins. Answers are passed into the first step's input_mappings
 * under source: "workflow_input".
 */
export interface WorkflowInputField {
  field:      string;
  prompt:     string;
  input_type: "text" | "number" | "select";
  options?:   string[];
  required:   boolean;
}

/**
 * Maps a step's domain-adapter input field to either a user-supplied workflow
 * input or the output of a previous step.
 *
 *   source: "workflow_input"  → from is a key in WorkflowTemplate.input_schema
 *   source: "step_output"     → from is "stepId.fieldPath"
 *                               (dot-path into a previous step's ResultHandle)
 */
export interface WorkflowStepInput {
  targetField: string;
  source:      "workflow_input" | "step_output";
  from:        string;
}

/**
 * A single step in a workflow. Each step maps to one domain adapter call.
 * output_key is the name under which the step's ResultHandle is stored in
 * workflow state for subsequent steps to reference.
 */
export interface WorkflowStep {
  id:             string;
  domain:         string;
  description:    string;
  input_mappings: WorkflowStepInput[];
  output_key:     string;
  optional?:      boolean;   // step is skipped when its required inputs are absent
}

/**
 * A named, reusable multi-step query flow.
 *
 * WorkflowTemplates are pure data — they declare structure but contain no
 * async logic. The execution engine (D.8) interprets them at runtime.
 *
 * trigger_intents: free-text patterns that cause the chip ranker to surface
 * a "Run workflow" chip. Matching is substring, case-insensitive.
 *
 * required_domains: domain slugs that must be registered before this workflow
 * is offered. An empty array means the workflow is always available.
 */
export interface WorkflowTemplate {
  id:               string;
  name:             string;
  description:      string;
  trigger_intents:  string[];
  input_schema:     WorkflowInputField[];
  steps:            WorkflowStep[];
  required_domains: string[];
}

// ── WorkflowResult — Phase D.8 ────────────────────────────────────────────────

/**
 * Result of a single executed workflow step.
 *
 * status:
 *   success  — adapter returned rows; handle is populated
 *   skipped  — step.optional === true and a required input was absent
 *   error    — adapter threw; error message recorded; workflow continues if optional
 *   not_implemented — domain slug not registered; step skipped gracefully
 */
export interface WorkflowStepResult {
  step_id:    string;
  output_key: string;
  status:     "success" | "skipped" | "error" | "not_implemented";
  handle?:    ResultHandle;
  /** Raw rows kept in executor state for downstream step_output mappings. */
  rows?:      Record<string, unknown>[];
  error?:     string;
}

/**
 * Final result returned by executeWorkflow().
 *
 * status:
 *   complete — all non-optional steps succeeded
 *   partial  — at least one optional step was skipped or failed
 *   failed   — a required step failed
 *
 * handles contains only the success-step handles, in step order.
 * The frontend renders them as a stacked result set.
 */
export interface WorkflowResult {
  workflow_id:  string;
  status:       "complete" | "partial" | "failed";
  step_results: WorkflowStepResult[];
  handles:      ResultHandle[];
}

// ── Domain Validation & Auto‑Approval ────────────────────────────────────────

export type ValidationStatus = "pending" | "approved" | "rejected" | "auto_approved";

export interface DomainValidation {
  status: ValidationStatus;
  criteria: {
    hasRequiredFields: boolean;
    supportedCountry: boolean;
    safeSource: boolean;
    hasValidEndpoint: boolean;
  };
  notes: string[];
}

// ── Insight & Follow‑up Queries ──────────────────────────────────────────────

export interface InsightWithFollowUps {
  insight: string | null;
  followUps: Array<{
    label: string;
    intent: string;
    params: Record<string, unknown>;
  }>;
}
