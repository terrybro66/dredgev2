/**
 * co-occurrence-log.ts — Phase D.9
 *
 * Records domain co-occurrence from a session's result_stack. Every time
 * two domains appear in the same session we increment a shared Redis sorted
 * set. relationship-discovery.ts reads these counts to produce learned
 * DomainRelationship weights that supplement the seeded entries in
 * domain-relationships.ts.
 *
 * Redis key:  domains:cooccurrence   (global, no per-session TTL)
 * Members:    "domain-a:domain-b"    (pair sorted alphabetically, colon separator)
 * Scores:     raw integer co-occurrence count (incremented per session event)
 *
 * Pair encoding:
 *   Given domains ["transport", "crime-uk"] → member = "crime-uk:transport"
 *   (sorted so the same two domains always produce the same key regardless of
 *    the order they were queried in the session)
 */

import { getRedisClient } from "./redis";

export const COOCCURRENCE_KEY = "domains:cooccurrence";

/**
 * Given an array of domain names active in a session, increment the
 * co-occurrence counter for every unique unordered pair.
 *
 * Domains are deduplicated before pairing so repeated queries to the same
 * domain in one session count as a single observation.
 *
 * No-op if fewer than 2 unique domains are present.
 * Silently swallows Redis errors so query execution is never blocked.
 */
export async function recordCoOccurrence(domains: string[]): Promise<void> {
  const unique = Array.from(new Set(domains.filter(Boolean)));
  if (unique.length < 2) return;

  const redis = getRedisClient();
  const pipeline = redis.pipeline();

  for (let i = 0; i < unique.length; i++) {
    for (let j = i + 1; j < unique.length; j++) {
      const pair = [unique[i], unique[j]].sort().join(":");
      pipeline.zincrby(COOCCURRENCE_KEY, 1, pair);
    }
  }

  try {
    await pipeline.exec();
  } catch (err) {
    console.warn(
      JSON.stringify({
        event: "redis_write_error",
        key: "cooccurrence",
        domains: unique,
        error: err instanceof Error ? err.message : String(err),
      }),
    );
  }
}

/**
 * Return all recorded co-occurrence pairs with their counts, sorted by count
 * descending (most frequent first).
 *
 * Returns [] on Redis error.
 */
export async function getCoOccurrenceCounts(): Promise<
  Array<{ pair: string; count: number }>
> {
  try {
    const redis = getRedisClient();
    // ZRANGEBYSCORE with scores, highest first
    const raw = await redis.zrangebyscore(
      COOCCURRENCE_KEY,
      1,          // minimum count of 1 (skip zero entries if any)
      "+inf",
      "WITHSCORES",
    );

    const results: Array<{ pair: string; count: number }> = [];
    for (let i = 0; i < raw.length; i += 2) {
      results.push({ pair: raw[i], count: Number(raw[i + 1]) });
    }
    // Sort descending by count
    results.sort((a, b) => b.count - a.count);
    return results;
  } catch {
    return [];
  }
}

/**
 * Reset all co-occurrence data. Used in tests and admin resets.
 */
export async function clearCoOccurrences(): Promise<void> {
  try {
    await getRedisClient().del(COOCCURRENCE_KEY);
  } catch {
    // no-op
  }
}
