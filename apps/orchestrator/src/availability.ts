import axios from "axios";

// ── In-memory store ───────────────────────────────────────────────────────────

const store = new Map<string, string[]>();

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
