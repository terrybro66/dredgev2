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
 * Spatial relevance: 1.0 for chips that operate on the result directly;
 * 0.5 for chips that need the user's current location and none is stored.
 */
function computeSpatialRelevance(
  chip: Chip,
  memory: ConversationMemory,
): number {
  const needsLocation =
    chip.action === "calculate_travel" || chip.action === "fetch_domain";
  if (needsLocation) {
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
}

/**
 * Score every chip, annotate with scoreBreakdown, and return the top
 * CHIP_DISPLAY_MAX chips sorted by score descending.
 */
export function rankChips(input: RankChipsInput): Chip[] {
  const { chips, handle, memory, domainRelationships = [], clickCounts = {} } = input;

  const scored: Chip[] = chips.map((chip) => {
    const scoreBreakdown: ChipScore = {
      frequency:          computeFrequency(chip, memory, clickCounts),
      spatialRelevance:   computeSpatialRelevance(chip, memory),
      recency:            computeRecency(chip, memory),
      relationshipWeight: computeRelationshipWeight(chip, handle, domainRelationships),
    };
    return {
      ...chip,
      score:          computeChipScore(scoreBreakdown),
      scoreBreakdown,
    };
  });

  return scored
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    .slice(0, CHIP_DISPLAY_MAX);
}
