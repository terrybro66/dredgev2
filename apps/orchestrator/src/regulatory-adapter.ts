/**
 * regulatory-adapter.ts — Phase D.4
 *
 * RegulatoryAdapter interface and registry.
 *
 * A RegulatoryAdapter is fundamentally different from a DomainAdapter:
 *   - Receives user_attributes (collected via ClarificationRequest) not a polygon
 *   - Returns DecisionResult — eligibility, conditions, references
 *   - Never writes to query_results (no persistent storage)
 *   - No geocoder, no rate limiter, no cache
 *   - May return next_questions when more attributes are needed
 *
 * The /execute handler checks for regulatory intent after the clarification
 * check — if all required attributes are present it runs the adapter and
 * returns a result with type: "decision_result".
 */

import type {
  ClarificationField,
  DecisionResult,
} from "./types/connected";

// ── RegulatoryAdapter interface ───────────────────────────────────────────────

export interface RegulatoryAdapter {
  /** Unique name, e.g. "food-business-gb" */
  name: string;

  /** Intent strings this adapter handles (case-insensitive substring match) */
  intents: string[];

  /** ISO 3166-1 alpha-2 country codes. Empty = any country. */
  countries: string[];

  /**
   * The minimum set of user_attributes required before evaluate() can run.
   * If any are missing the adapter should populate next_questions in its result.
   */
  requiredAttributes: string[];

  /**
   * Evaluate eligibility given the user's collected attributes.
   * Must never throw — return ineligible with an explanation on any error.
   */
  evaluate(userAttributes: Record<string, unknown>): Promise<DecisionResult>;

  /**
   * Whether this regulatory adapter was auto‑approved during registration.
   * Defaults to false for dynamically discovered adapters; true for built‑in ones.
   */
  autoApproved?: boolean;
}

// ── Registry ──────────────────────────────────────────────────────────────────

const regulatoryRegistry = new Map<string, RegulatoryAdapter>();

export function registerRegulatoryAdapter(adapter: RegulatoryAdapter): void {
  regulatoryRegistry.set(adapter.name, adapter);
}

export function getRegulatoryAdapter(
  intent: string,
  countryCode: string,
): RegulatoryAdapter | undefined {
  const lower = intent.toLowerCase();
  for (const adapter of regulatoryRegistry.values()) {
    const intentMatch = adapter.intents.some((i) => lower.includes(i.toLowerCase()));
    const countryMatch =
      adapter.countries.length === 0 ||
      adapter.countries.includes(countryCode);
    if (intentMatch && countryMatch) return adapter;
  }
  return undefined;
}

export function clearRegulatoryRegistry(): void {
  regulatoryRegistry.clear();
}

// ── Helper: build missing-attribute questions ─────────────────────────────────

/**
 * Given a list of required attribute keys and the current user_attributes,
 * return ClarificationFields for whichever are missing.
 * Field definitions must be provided by the adapter.
 */
export function getMissingAttributeQuestions(
  required: string[],
  userAttributes: Record<string, unknown>,
  fieldDefs: ClarificationField[],
): ClarificationField[] {
  const missing = required.filter(
    (k) => userAttributes[k] === undefined || userAttributes[k] === null || userAttributes[k] === "",
  );
  return fieldDefs.filter((f) => missing.includes(f.field));
}
