/**
 * chip-ranker.ts — Phase C.4
 *
 * rankChips() scores every unranked chip produced by generateChips() and
 * returns the top CHIP_DISPLAY_MAX (3) chips ordered by score descending.
 *
 * Scoring formula (from connected.ts):
 *   score = (frequency        × 0.4)   — click history in current session
 *         + (spatialRelevance × 0.3)   — does the user have a location to act on?
 *         + (recency          × 0.2)   — how recent is the referenced handle?
 *         + (relationshipWeight × 0.1) — domain affinity weight (C.5)
 *
 * Cold-start behaviour:
 *   frequency      = 0  (no history yet; populated by C.8 ConversationMemory store)
 *   relationshipWeight = 0  (no entries yet; seeded by C.5)
 *   → most chips score 0.50 at cold start, travel chips score 0.35 without a
 *     session location — map/filter chips surface ahead of travel chips as intended.
 */

import type {
  Chip,
  ChipScore,
  ConversationMemory,
  DomainRelationship,
  ResultHandle,
} from "./types/connected";
import { computeChipScore, CHIP_DISPLAY_MAX } from "./types/connected";

// ── Scoring components ────────────────────────────────────────────────────────

/**
 * Frequency: how often chips of this action type have been clicked in the
 * current session. Normalised to [0, 1] — 10 clicks = 1.0.
 */
function computeFrequency(
  chip: Chip,
  _memory: ConversationMemory,
  clickCounts: Record<string, number>,
): number {
  const count = clickCounts[chip.action] ?? 0;
  return Math.min(count / 10, 1.0);
}

/**
 * Spatial relevance: 1.0 for chips that operate on the result or carry their
 * own spatial context (fetch_domain affinity chips use the active_poly, not
 * the user's GPS location); 0.5 for calculate_travel which genuinely needs
 * the user's current physical location to compute a route.
 */
function computeSpatialRelevance(
  chip: Chip,
  memory: ConversationMemory,
): number {
  if (chip.action === "calculate_travel") {
    return memory.context.location != null ? 1.0 : 0.5;
  }
  return 1.0;
}

/**
 * Recency: how fresh is the referenced ResultHandle in the result_stack?
 * Newest (index 0) = 1.0, older handles decay. No ref = 1.0 (not stale).
 */
function computeRecency(chip: Chip, memory: ConversationMemory): number {
  const ref = chip.args.ref;
  if (!ref) return 1.0;

  const stack = memory.context.result_stack;
  const idx = stack.findIndex((h) => h.id === ref);
  if (idx === -1) return 0.1;   // referenced handle not found — may be stale
  if (idx === 0)  return 1.0;
  if (idx === 1)  return 0.7;
  if (idx === 2)  return 0.4;
  return 0.1;
}

/**
 * Relationship weight: domain affinity score seeded by C.5.
 * 0 for any (fromDomain, toDomain) pair not in the relationship table.
 */
function computeRelationshipWeight(
  chip: Chip,
  handle: ResultHandle,
  relationships: DomainRelationship[],
): number {
  const toDomain = chip.args.domain;
  if (!toDomain || relationships.length === 0) return 0;
  const rel = relationships.find(
    (r) => r.fromDomain === handle.domain && r.toDomain === toDomain,
  );
  return rel?.weight ?? 0;
}

// ── Public API ────────────────────────────────────────────────────────────────

export interface RankChipsInput {
  /** Unranked chips from generateChips(). */
  chips: Chip[];
  /** The ResultHandle the chips operate on (used for relationship lookup). */
  handle: ResultHandle;
  /** Current session memory (location, result_stack, click history). */
  memory: ConversationMemory;
  /** Domain relationship weights from C.5 seed data. Empty list is safe. */
  domainRelationships?: DomainRelationship[];
  /** Per-action click counts from the session's chip_clicks Redis hash (C.8). */
  clickCounts?: Record<string, number>;
  /**
   * Layer 3 engagement graph multipliers, keyed by chip dedupe key
   * ("action:domain::").  When present, the chip's base score is multiplied
   * by this value before sorting.
   *
   * Range:
   *   1.0 — unobserved pair (key absent from map) → no change
   *   [0.5, 1.5] — observed pair; low-clicked edges penalised, popular boosted
   *
   * Obtain via computeEngagementMultipliers() from suggest-followups.ts.
   */
  engagementMultipliers?: Map<string, number>;
}

/**
 * Canonical chip dedupe key — matches the format used in generateChips().
 * Used here to look up per-chip engagement multipliers.
 */
function chipKey(chip: Chip): string {
  return `${chip.action}:${chip.args.domain ?? ""}:${chip.args.constraint ?? ""}:${chip.args.field ?? ""}`;
}

/**
 * Score every chip, annotate with scoreBreakdown, and return the top
 * CHIP_DISPLAY_MAX chips sorted by score descending.
 *
 * When engagementMultipliers is supplied (Layer 3), each chip's base score is
 * scaled by the multiplier for its (source template → target template) pair:
 *   - Key absent from map → multiplier 1.0 (unobserved, no change)
 *   - Key present → value in [0.5, 1.5] (penalise ignored / boost popular)
 */
export function rankChips(input: RankChipsInput): Chip[] {
  const {
    chips, handle, memory,
    domainRelationships = [],
    clickCounts = {},
    engagementMultipliers,
  } = input;

  const scored: Chip[] = chips.map((chip) => {
    const scoreBreakdown: ChipScore = {
      frequency:          computeFrequency(chip, memory, clickCounts),
      spatialRelevance:   computeSpatialRelevance(chip, memory),
      recency:            computeRecency(chip, memory),
      relationshipWeight: computeRelationshipWeight(chip, handle, domainRelationships),
    };
    const baseScore = computeChipScore(scoreBreakdown);
    const multiplier = engagementMultipliers?.get(chipKey(chip)) ?? 1.0;
    return {
      ...chip,
      score:          baseScore * multiplier,
      scoreBreakdown,
    };
  });

  return scored
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    .slice(0, CHIP_DISPLAY_MAX);
}
