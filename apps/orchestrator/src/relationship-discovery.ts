/**
 * relationship-discovery.ts — Phase D.9
 *
 * Reads co-occurrence counts from Redis and produces learned DomainRelationship
 * entries. These are merged with the seeded entries from domain-relationships.ts
 * so the chip ranker benefits from both curated weights and observed usage.
 *
 * Weight formula:
 *   learned_weight = min(count / COOCCURRENCE_SCALE, 1.0)
 *
 *   COOCCURRENCE_SCALE = 50  →  50 co-occurrences produces weight 1.0
 *   A pair seen 10 times     →  weight 0.2
 *   A pair seen 100+ times   →  weight capped at 1.0
 *
 * Pairs with learned_weight < COOCCURRENCE_MIN_WEIGHT are discarded as noise.
 *
 * Merge semantics (getMergedRelationships):
 *   - Seeded entry exists for (from, to):
 *       keep seeded relationshipType; weight = max(seeded, learned)
 *   - No seeded entry for (from, to):
 *       add as new entry, relationshipType: "complements"
 *   Co-occurrence is symmetric so each stored pair (A, B) produces
 *   both A→B and B→A entries.
 */

import type { DomainRelationship } from "./types/connected";
import { DOMAIN_RELATIONSHIPS } from "./domain-relationships";
import { getCoOccurrenceCounts } from "./co-occurrence-log";

export const COOCCURRENCE_SCALE     = 50;   // count that maps to weight 1.0
export const COOCCURRENCE_MIN_WEIGHT = 0.1; // discard pairs below this threshold

// ── Learned relationships ─────────────────────────────────────────────────────

/**
 * Convert raw co-occurrence counts into directional DomainRelationship entries.
 * Each stored pair "A:B" produces two entries: A→B and B→A.
 * Entries below COOCCURRENCE_MIN_WEIGHT are filtered out.
 */
export async function getLearnedRelationships(): Promise<DomainRelationship[]> {
  const counts = await getCoOccurrenceCounts();
  const learned: DomainRelationship[] = [];

  for (const { pair, count } of counts) {
    const weight = Math.min(count / COOCCURRENCE_SCALE, 1.0);
    if (weight < COOCCURRENCE_MIN_WEIGHT) continue;

    const [domainA, domainB] = pair.split(":");
    if (!domainA || !domainB) continue;

    // Bidirectional — co-occurrence is symmetric
    learned.push({
      fromDomain:       domainA,
      toDomain:         domainB,
      relationshipType: "complements",
      weight,
    });
    learned.push({
      fromDomain:       domainB,
      toDomain:         domainA,
      relationshipType: "complements",
      weight,
    });
  }

  return learned;
}

// ── Merged relationships ──────────────────────────────────────────────────────

/**
 * Return the merged set of DomainRelationship entries: seeded entries
 * supplemented (and where applicable boosted) by learned weights.
 *
 * Result is sorted by weight descending so callers can use the first N entries
 * without further sorting.
 */
export async function getMergedRelationships(): Promise<DomainRelationship[]> {
  const learned = await getLearnedRelationships();

  // Build a mutable map from the seeded entries (fromDomain:toDomain → entry)
  const merged = new Map<string, DomainRelationship>();
  for (const rel of DOMAIN_RELATIONSHIPS) {
    merged.set(`${rel.fromDomain}:${rel.toDomain}`, { ...rel });
  }

  // Apply learned relationships
  for (const rel of learned) {
    const key      = `${rel.fromDomain}:${rel.toDomain}`;
    const existing = merged.get(key);
    if (existing) {
      // Boost weight if learned is higher; keep seeded relationshipType
      existing.weight = Math.max(existing.weight, rel.weight);
    } else {
      // New pair discovered from usage — add it
      merged.set(key, { ...rel });
    }
  }

  const result = Array.from(merged.values());
  result.sort((a, b) => b.weight - a.weight);
  return result;
}

// ── Utility ───────────────────────────────────────────────────────────────────

/**
 * Look up the merged weight for a specific (fromDomain, toDomain) pair.
 * Returns 0 if no relationship is found.
 *
 * Used by the chip ranker as a drop-in replacement for the static lookup.
 */
export async function getRelationshipWeight(
  fromDomain: string,
  toDomain:   string,
): Promise<number> {
  const merged = await getMergedRelationships();
  const found  = merged.find(
    (r) => r.fromDomain === fromDomain && r.toDomain === toDomain,
  );
  return found?.weight ?? 0;
}
