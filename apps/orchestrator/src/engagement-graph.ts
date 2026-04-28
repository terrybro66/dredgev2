/**
 * engagement-graph.ts — Layer 3 of the chip affinity system
 *
 * Directed template-level transition graph. Every time a user clicks a
 * fetch_domain chip and the result loads successfully, we record the template
 * type of the source (the result they came from) and the template type of the
 * target (the domain they navigated to).
 *
 * This produces a directed weighted graph at the TEMPLATE level (6 nodes, ≤ 30
 * edges) that:
 *   - Scales automatically — new domains inherit from their template backbone
 *   - Survives cold-start — unobserved pairs return multiplier 1.0 (always shown)
 *   - Learns from real navigation — high-click edges are boosted in ranking
 *   - Decays over time — monthly halving prevents stale signal from dominating
 *
 * Three layers in the chip affinity system:
 *   Layer 1: affinityInto (domain config) — explicit domain author declarations
 *   Layer 2: TEMPLATE_AFFINITY matrix    — fallback for auto-discovered domains
 *   Layer 3: engagement-graph (this file) — ranking multiplier from real clicks
 *
 * Layers 1 and 2 control WHICH chips are generated.
 * Layer 3 controls HOW they are ranked among each other.
 *
 * Redis keys:
 *   engagement:transitions           — sorted set: member="from:to", score=count
 *   engagement:transitions:decayed_at — string: ISO timestamp of last decay
 *
 * Integration:
 *   recordTemplateTransition()       — called fire-and-forget in /chip handler
 *   getTemplateTransitionWeights()   — called in execute path, passed to suggestFollowups
 *   decayAllTransitions()            — called by monthly cron (index.ts)
 */

import { getRedisClient } from "./redis";

export const TRANSITIONS_KEY = "engagement:transitions";
export const TRANSITIONS_DECAY_KEY = "engagement:transitions:decayed_at";

/**
 * Raw click count that maps to normalised weight 1.0.
 * A pair clicked 100 times → weight 1.0 (maximum boost).
 */
export const ENGAGEMENT_SCALE = 100;

/**
 * Minimum click count before the engagement signal is trusted.
 * Pairs with fewer than this many clicks are excluded from the weights map —
 * callers treat their absence as "unobserved" and use multiplier 1.0.
 */
export const ENGAGEMENT_MIN_OBSERVATIONS = 10;

/** Fraction to multiply scores by on each decay event. */
export const ENGAGEMENT_DECAY_FACTOR = 0.5;

/** How many milliseconds between lazy decay events (30 days). */
export const ENGAGEMENT_DECAY_INTERVAL_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Score below which a decayed entry is removed entirely.
 * An entry that starts at 100 and is halved 7 times reaches ~0.78 — just
 * below 1. We remove entries at 0.5 so they can never reach the
 * ENGAGEMENT_MIN_OBSERVATIONS threshold again without fresh clicks.
 */
const DECAY_REMOVE_THRESHOLD = 0.5;

// ── Write path ────────────────────────────────────────────────────────────────

/**
 * Record a directed template transition from `fromTemplate` to `toTemplate`.
 *
 * Call fire-and-forget after a fetch_domain chip resolves successfully.
 * Never throws — all errors are logged and swallowed.
 *
 * Transitions where from === to are ignored (self-loops add no signal).
 */
export async function recordTemplateTransition(
  fromTemplate: string,
  toTemplate: string,
): Promise<void> {
  if (!fromTemplate || !toTemplate || fromTemplate === toTemplate) return;
  const member = `${fromTemplate}:${toTemplate}`;
  try {
    await getRedisClient().zincrby(TRANSITIONS_KEY, 1, member);
  } catch (err) {
    console.warn(
      JSON.stringify({
        event: "engagement_graph_write_error",
        member,
        error: err instanceof Error ? err.message : String(err),
      }),
    );
  }
}

// ── Read path ─────────────────────────────────────────────────────────────────

/**
 * Return a Map of observed template transition weights, normalised to [0, 1].
 *
 * Only pairs with at least ENGAGEMENT_MIN_OBSERVATIONS clicks are included.
 * Callers treat a missing key as "unobserved" → multiplier 1.0 (no change).
 *
 * Applies lazy decay: if the last recorded decay was more than
 * ENGAGEMENT_DECAY_INTERVAL_MS ago, halves all scores before returning.
 * Double-decay under concurrent calls is harmless — it's a mild extra
 * penalty, not data corruption.
 *
 * Returns an empty Map on Redis error — callers degrade gracefully to
 * multiplier 1.0 for all chips.
 */
export async function getTemplateTransitionWeights(): Promise<Map<string, number>> {
  try {
    const redis = getRedisClient();

    // Lazy decay
    const decayedAt = await redis.get(TRANSITIONS_DECAY_KEY);
    const lastDecay = decayedAt ? new Date(decayedAt).getTime() : 0;
    if (Date.now() - lastDecay > ENGAGEMENT_DECAY_INTERVAL_MS) {
      await decayAllTransitions(ENGAGEMENT_DECAY_FACTOR);
    }

    // Fetch members that have crossed the observation threshold
    const raw = await redis.zrangebyscore(
      TRANSITIONS_KEY,
      ENGAGEMENT_MIN_OBSERVATIONS,
      "+inf",
      "WITHSCORES",
    );

    const weights = new Map<string, number>();
    for (let i = 0; i < raw.length; i += 2) {
      const member = raw[i];
      const count = Number(raw[i + 1]);
      if (!member) continue;
      weights.set(member, Math.min(count / ENGAGEMENT_SCALE, 1.0));
    }
    return weights;
  } catch {
    return new Map();
  }
}

// ── Decay ─────────────────────────────────────────────────────────────────────

/**
 * Apply exponential decay to all stored transition counts.
 *
 * Multiplies every score by `factor` (default 0.5 — halves all counts).
 * Entries that fall below DECAY_REMOVE_THRESHOLD are deleted — they can no
 * longer reach ENGAGEMENT_MIN_OBSERVATIONS without new clicks.
 *
 * Call from a monthly cron job registered in index.ts. Also called lazily
 * by getTemplateTransitionWeights when the decay interval has elapsed.
 */
export async function decayAllTransitions(
  factor = ENGAGEMENT_DECAY_FACTOR,
): Promise<void> {
  try {
    const redis = getRedisClient();

    const raw = await redis.zrangebyscore(
      TRANSITIONS_KEY,
      "-inf",
      "+inf",
      "WITHSCORES",
    );

    const pipeline = redis.pipeline();

    for (let i = 0; i < raw.length; i += 2) {
      const member = raw[i];
      const newScore = Number(raw[i + 1]) * factor;
      if (newScore < DECAY_REMOVE_THRESHOLD) {
        pipeline.zrem(TRANSITIONS_KEY, member);
      } else {
        pipeline.zadd(TRANSITIONS_KEY, newScore, member);
      }
    }

    pipeline.set(TRANSITIONS_DECAY_KEY, new Date().toISOString());
    await pipeline.exec();
  } catch (err) {
    console.warn(
      JSON.stringify({
        event: "engagement_graph_decay_error",
        error: err instanceof Error ? err.message : String(err),
      }),
    );
  }
}

// ── Admin / test utilities ────────────────────────────────────────────────────

/**
 * Return all stored transitions with their raw click counts, sorted by count
 * descending. Unfiltered — includes pairs below ENGAGEMENT_MIN_OBSERVATIONS.
 *
 * Used by admin tooling and tests. Returns [] on Redis error.
 */
export async function getAllTransitions(): Promise<
  Array<{ pair: string; count: number }>
> {
  try {
    const redis = getRedisClient();
    const raw = await redis.zrangebyscore(
      TRANSITIONS_KEY,
      "-inf",
      "+inf",
      "WITHSCORES",
    );
    const results: Array<{ pair: string; count: number }> = [];
    for (let i = 0; i < raw.length; i += 2) {
      results.push({ pair: raw[i], count: Number(raw[i + 1]) });
    }
    results.sort((a, b) => b.count - a.count);
    return results;
  } catch {
    return [];
  }
}

/**
 * Delete all transition data and the decay timestamp.
 * Used in tests and admin resets.
 */
export async function clearTransitions(): Promise<void> {
  try {
    await getRedisClient().del(TRANSITIONS_KEY, TRANSITIONS_DECAY_KEY);
  } catch {
    // no-op
  }
}
