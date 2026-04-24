/**
 * clarification.ts — Phase D.1
 *
 * Detects intents that require user input before a result can be produced
 * (regulatory/eligibility queries) and generates the appropriate
 * ClarificationRequest.
 *
 * Design rule (from CONNECTED_QUERIES.md):
 *   Data queries (crime, flood, cinema) → return best result without
 *     clarification. Offer filter/refinement chips.
 *   Regulatory/eligibility queries (hunting licence, food business,
 *     planning permission) → return ClarificationRequest first. There is
 *     no meaningful "all" result before eligibility attributes are known.
 *
 * This module is intentionally separate from the domain registry so it can
 * run before any adapter lookup — the orchestrator checks for clarification
 * before attempting data fetch.
 */

import type { ClarificationField, ClarificationRequest } from "./types/connected";

// ── Clarification rule ────────────────────────────────────────────────────────

interface ClarificationRule {
  /** Patterns that trigger this rule (case-insensitive substring match) */
  patterns: string[];
  /** What the system will do once all questions are answered */
  intent: string;
  questions: ClarificationField[];
}

const CLARIFICATION_RULES: ClarificationRule[] = [
  {
    patterns: ["hunting licence", "hunting license", "hunting permit", "deer stalking licence"],
    intent: "hunting licence eligibility",
    questions: [
      {
        field:      "age",
        prompt:     "How old are you?",
        input_type: "number",
        target:     "user_attributes",
      },
      {
        field:      "residency",
        prompt:     "Are you a UK resident?",
        input_type: "boolean",
        target:     "user_attributes",
      },
      {
        field:      "game_species",
        prompt:     "Which game species are you interested in?",
        input_type: "select",
        options:    ["Deer", "Pheasant", "Grouse", "Duck", "Other"],
        target:     "user_attributes",
      },
    ],
  },
  {
    patterns: [
      "food registration",
      "food business registration",
      "food business licence",
      "start a food business",
      "register a food business",
      "register food",
      "food hygiene rating",
      "food premises registration",
    ],
    intent: "food business registration eligibility",
    questions: [
      {
        field:      "business_type",
        prompt:     "Is this a new business or a change of use?",
        input_type: "select",
        options:    ["New business", "Change of use", "Change of ownership"],
        target:     "user_attributes",
      },
      {
        field:      "food_type",
        prompt:     "What type of food operation is it?",
        input_type: "select",
        options:    [
          "Restaurant / café",
          "Takeaway",
          "Market stall",
          "Home catering",
          "Food manufacturer",
          "Other",
        ],
        target:     "user_attributes",
      },
    ],
  },
  {
    patterns: [
      "planning permission",
      "planning application",
      "permitted development",
      "building regulations",
    ],
    intent: "planning permission eligibility",
    questions: [
      {
        field:      "development_type",
        prompt:     "What type of development are you planning?",
        input_type: "select",
        options:    [
          "House extension",
          "New dwelling",
          "Change of use",
          "Outbuilding / garage",
          "Loft conversion",
          "Other",
        ],
        target:     "user_attributes",
      },
      {
        field:      "listed_building",
        prompt:     "Is the property a listed building or in a conservation area?",
        input_type: "boolean",
        target:     "user_attributes",
      },
    ],
  },
];

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Check whether the given intent/category requires clarification before
 * data can be fetched. Returns a ClarificationRequest if so, null otherwise.
 *
 * Matching is intentionally broad — substring match, case-insensitive — so
 * natural language phrasings ("how do I get a hunting licence?") are caught
 * without requiring exact slug matching.
 */
export function buildClarificationRequest(
  intent: string,
): ClarificationRequest | null {
  const lower = intent.toLowerCase();

  for (const rule of CLARIFICATION_RULES) {
    if (rule.patterns.some((p) => lower.includes(p.toLowerCase()))) {
      return { intent: rule.intent, questions: rule.questions };
    }
  }

  return null;
}

/**
 * True when the intent matches a clarification rule.
 * Convenience wrapper used by the execute handler.
 */
export function requiresClarification(intent: string): boolean {
  return buildClarificationRequest(intent) !== null;
}
