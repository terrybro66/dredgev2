import axios from "axios";
import Redis from "ioredis";
import { getRedisClient } from "./redis";

// ── In-memory store ───────────────────────────────────────────────────────────

const store = new Map<string, string[]>();

// ── Redis-backed cache (shared across instances) ──────────────────────────────

let availabilityCache: AvailabilityCache | undefined;

function getAvailabilityCache(): AvailabilityCache {
  if (!availabilityCache) {
    availabilityCache = createAvailabilityCache();
  }
  return availabilityCache;
}

// ── loadAvailability ──────────────────────────────────────────────────────────

/**
 * Fetches `url`, extracts month strings via `extractMonths`, and stores them
 * sorted most-recent-first in the in-memory map keyed by `source`.
 *
 * Non-fatal: network/parse errors are logged and swallowed so the server
 * can start even when the upstream API is unreachable.
 */
export async function loadAvailability(
  source: string,
  url: string,
  extractMonths: (data: unknown) => string[],
): Promise<void> {
  try {
    const { data } = await axios.get(url);
    const months = extractMonths(data).sort().reverse();
    store.set(source, months);
    const cache = getAvailabilityCache();
    await cache.set(source, months);
    console.log(
      JSON.stringify({
        event: "availability_loaded",
        source,
        count: months.length,
      }),
    );
  } catch (err) {
    console.error(
      JSON.stringify({
        event: "availability_failed",
        source,
        error: err instanceof Error ? err.message : String(err),
      }),
    );
  }
}

// ── getLatestMonth ────────────────────────────────────────────────────────────

/**
 * Returns the most recent month string for `source`, or `null` if the source
 * has never been loaded or was loaded with an empty array.
 *
 * Checks Redis when the in-memory map is empty (e.g. after a restart where
 * loadAvailability failed but a prior run populated Redis).
 */
export async function getLatestMonth(source: string): Promise<string | null> {
  let months = store.get(source);
  if (!months || months.length === 0) {
    months = await tryRestoreFromRedis(source);
  }
  if (!months || months.length === 0) return null;
  return months[0];
}

// ── isMonthAvailable ──────────────────────────────────────────────────────────

/**
 * Returns `true` when `month` is in the loaded list for `source`.
 * Falls open: returns `true` when the source has never been loaded
 * AND Redis has no cached copy (assume available).
 */
export async function isMonthAvailable(source: string, month: string): Promise<boolean> {
  let months = store.get(source);
  if (!months || months.length === 0) {
    months = await tryRestoreFromRedis(source);
  }
  if (!months || months.length === 0) return true;
  return months.includes(month);
}

/**
 * Attempt to re-populate the in-memory store from the Redis cache.
 * Returns the months array or null if Redis has nothing.
 */
async function tryRestoreFromRedis(source: string): Promise<string[] | null> {
  try {
    const cache = getAvailabilityCache();
    const months = await cache.get(source);
    if (months && months.length > 0) {
      store.set(source, months);
      console.log(
        JSON.stringify({ event: "availability_restored_from_redis", source, count: months.length }),
      );
      return months;
    }
  } catch {
    // Redis unavailable — fall through
  }
  return null;
}

// ── getAvailableMonths ────────────────────────────────────────────────────────

/**
 * Returns the full sorted (most-recent-first) month array for `source`,
 * or `[]` if the source has never been loaded.
 */
export function getAvailableMonths(source: string): string[] {
  return store.get(source) ?? [];
}

// ── Redis-backed cache factory ────────────────────────────────────────────────

const TTL = parseInt(process.env.AVAILABILITY_CACHE_TTL_SECONDS ?? "3600", 10);
const KEY_PREFIX = "availability:";

interface AvailabilityCache {
  get: (source: string) => Promise<string[] | null>;
  set: (source: string, months: string[]) => Promise<void>;
}

// ── Test helpers ──────────────────────────────────────────────────────────────

/** Resets all in-memory state. For use in tests only. */
export async function resetStore(): Promise<void> {
  store.clear();
  if (availabilityCache) {
    const client = getRedisClient();
    const keys = await client.keys(`${KEY_PREFIX}*`);
    if (keys.length > 0) await client.del(...keys);
  }
  availabilityCache = undefined;
}

export function createAvailabilityCache(
  redisClient?: Redis,
): AvailabilityCache {
  const client = redisClient ?? getRedisClient();
  const memoryFallback = new Map<string, string[]>();

  const isConnected = () =>
    client.status === "ready" || client.status === "connecting";

  return {
    get: async (source: string) => {
      if (isConnected()) {
        const val = await client.get(KEY_PREFIX + source);
        if (!val) return null;
        return JSON.parse(val) as string[];
      }
      return memoryFallback.get(source) ?? null;
    },

    set: async (source: string, months: string[]) => {
      if (isConnected()) {
        await client.set(
          KEY_PREFIX + source,
          JSON.stringify(months),
          "EX",
          TTL,
        );
      } else {
        memoryFallback.set(source, months);
      }
    },
  };
}
