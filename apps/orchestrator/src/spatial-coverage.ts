/**
 * spatial-coverage.ts — Layer 2 of the cross-domain chip system
 *
 * After a domain fetch, cache its data bounding box in Redis so the chip
 * generator can suppress affinity chips for domains that have never returned
 * data in the current area.
 *
 * Redis key:  domain_bbox:{domainName}
 * Value:      JSON { xmin, ymin, xmax, ymax }
 * TTL:        7 days (refreshed on every successful fetch with rows)
 *
 * Bootstrap behaviour: if no bbox is cached for a domain the chip is always
 * shown — it may return empty and recoverFromEmpty fires. Only suppress once
 * we have confirmed the domain has no coverage in this area.
 *
 * Failure mode: all Redis errors are swallowed. The chip ranker proceeds
 * without spatial filtering — at worst a user sees a chip that returns empty.
 */

import type { Bbox } from "./poly";
import { getRedisClient } from "./redis";

const KEY_PREFIX = "domain_bbox:";
const TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days

// ── Write ─────────────────────────────────────────────────────────────────────

/**
 * Derive a bounding box from result rows and persist it to Redis.
 * Silently no-ops if rows is empty, Redis is unavailable, or rows have no
 * coordinates.
 */
export async function cacheDomainBbox(
  domainName: string,
  rows: unknown[],
): Promise<void> {
  if (rows.length === 0) return;

  let xmin = Infinity, ymin = Infinity, xmax = -Infinity, ymax = -Infinity;
  let found = false;

  for (const row of rows) {
    const r = row !== null && typeof row === "object"
      ? (row as Record<string, unknown>)
      : {};

    const lat = asNumber(r["lat"] ?? r["latitude"]);
    const lon = asNumber(r["lon"] ?? r["longitude"]);

    if (lat == null || lon == null) continue;
    found = true;
    if (lat < ymin) ymin = lat;
    if (lat > ymax) ymax = lat;
    if (lon < xmin) xmin = lon;
    if (lon > xmax) xmax = lon;
  }

  if (!found) return;

  const bbox: Bbox = { xmin, ymin, xmax, ymax };

  try {
    const redis = getRedisClient();
    await redis.set(
      `${KEY_PREFIX}${domainName}`,
      JSON.stringify(bbox),
      "EX",
      TTL_SECONDS,
    );
  } catch {
    // Redis unavailable — degrade gracefully
  }
}

// ── Read ──────────────────────────────────────────────────────────────────────

/**
 * Return the cached bboxes for a set of domain names.
 * Domains with no cache entry are omitted — chips for those domains are shown
 * unconditionally (bootstrap behaviour).
 */
export async function getDomainBboxes(
  domainNames: string[],
): Promise<Map<string, Bbox>> {
  if (domainNames.length === 0) return new Map();

  const result = new Map<string, Bbox>();

  try {
    const redis = getRedisClient();
    const keys = domainNames.map((n) => `${KEY_PREFIX}${n}`);
    const values = await redis.mget(...keys);

    for (let i = 0; i < domainNames.length; i++) {
      const raw = values[i];
      if (raw == null) continue;
      try {
        const bbox = JSON.parse(raw) as Bbox;
        result.set(domainNames[i], bbox);
      } catch {
        // Corrupt entry — skip
      }
    }
  } catch {
    // Redis unavailable — return empty map (no suppression)
  }

  return result;
}

// ── Overlap check ─────────────────────────────────────────────────────────────

/**
 * Return true if bbox A overlaps bbox B (AABB intersection test).
 * Used to decide whether to suppress an affinity chip: if the cached domain
 * bbox doesn't overlap the current query bbox, the domain has no data here.
 */
export function bboxOverlaps(a: Bbox, b: Bbox): boolean {
  return (
    a.xmin <= b.xmax &&
    a.xmax >= b.xmin &&
    a.ymin <= b.ymax &&
    a.ymax >= b.ymin
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function asNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}
