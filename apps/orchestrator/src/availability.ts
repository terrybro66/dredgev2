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
    const cache = getAvailabilityCache();
    const cached = await cache.get(source);
    if (cached) {
      store.set(source, cached);
      console.log(
        JSON.stringify({
          event: "availability_loaded_from_cache",
          source,
          count: cached.length,
        }),
      );
      return;
    }
    const { data } = await axios.get(url);
    const months = extractMonths(data).sort().reverse();
    store.set(source, months);
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
 */
export function getLatestMonth(source: string): string | null {
  const months = store.get(source);
  if (!months || months.length === 0) return null;
  return months[0];
}

// ── isMonthAvailable ──────────────────────────────────────────────────────────

/**
 * Returns `true` when `month` is in the loaded list for `source`.
 * Falls open: returns `true` when the source has never been loaded,
 * or when it was loaded with an empty array (assume available).
 */
export function isMonthAvailable(source: string, month: string): boolean {
  const months = store.get(source);
  if (!months || months.length === 0) return true;
  return months.includes(month);
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
