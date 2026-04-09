/**
 * co-occurrence-log.test.ts — Phase D.9
 *
 * Tests for recordCoOccurrence(), getCoOccurrenceCounts(), clearCoOccurrences().
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// ── Mock Redis ────────────────────────────────────────────────────────────────

const sortedSet = new Map<string, number>();

const mockRedis = {
  pipeline: () => {
    const ops: Array<{ member: string; incr: number }> = [];
    return {
      zincrby: (_key: string, incr: number, member: string) => {
        ops.push({ member, incr });
        return { zincrby: () => {} }; // chainable stub
      },
      exec: async () => {
        for (const { member, incr } of ops) {
          sortedSet.set(member, (sortedSet.get(member) ?? 0) + incr);
        }
        return ops.map(() => [null, "OK"]);
      },
    };
  },
  zrangebyscore: async (
    _key: string,
    min: number | string,
    _max: string,
    _withScores: string,
  ) => {
    const minNum = typeof min === "string" ? 0 : min;
    const result: string[] = [];
    for (const [member, score] of sortedSet.entries()) {
      if (score >= minNum) {
        result.push(member, String(score));
      }
    }
    return result;
  },
  del: async (_key: string) => {
    sortedSet.clear();
    return 1;
  },
};

vi.mock("../redis", () => ({
  getRedisClient: () => mockRedis,
}));

// ── Import under test ─────────────────────────────────────────────────────────

import {
  recordCoOccurrence,
  getCoOccurrenceCounts,
  clearCoOccurrences,
} from "../co-occurrence-log";

beforeEach(async () => {
  sortedSet.clear();
});

// ── recordCoOccurrence ────────────────────────────────────────────────────────

describe("recordCoOccurrence", () => {
  it("records a single pair from two domains", async () => {
    await recordCoOccurrence(["crime-uk", "transport"]);
    const counts = await getCoOccurrenceCounts();
    expect(counts).toHaveLength(1);
    expect(counts[0].pair).toBe("crime-uk:transport");
    expect(counts[0].count).toBe(1);
  });

  it("stores pairs in alphabetical order regardless of input order", async () => {
    await recordCoOccurrence(["transport", "crime-uk"]);
    const counts = await getCoOccurrenceCounts();
    expect(counts[0].pair).toBe("crime-uk:transport");
  });

  it("records all pairs from three domains", async () => {
    await recordCoOccurrence(["crime-uk", "transport", "weather"]);
    const counts = await getCoOccurrenceCounts();
    expect(counts).toHaveLength(3);
    const pairs = counts.map((c) => c.pair).sort();
    expect(pairs).toContain("crime-uk:transport");
    expect(pairs).toContain("crime-uk:weather");
    expect(pairs).toContain("transport:weather");
  });

  it("increments count on repeated calls for the same domains", async () => {
    await recordCoOccurrence(["crime-uk", "transport"]);
    await recordCoOccurrence(["crime-uk", "transport"]);
    await recordCoOccurrence(["crime-uk", "transport"]);
    const counts = await getCoOccurrenceCounts();
    expect(counts[0].count).toBe(3);
  });

  it("deduplicates repeated domains in a single call", async () => {
    await recordCoOccurrence(["crime-uk", "crime-uk", "transport"]);
    const counts = await getCoOccurrenceCounts();
    expect(counts).toHaveLength(1);
    expect(counts[0].count).toBe(1);
  });

  it("is a no-op for fewer than two domains", async () => {
    await recordCoOccurrence(["crime-uk"]);
    await recordCoOccurrence([]);
    const counts = await getCoOccurrenceCounts();
    expect(counts).toHaveLength(0);
  });

  it("filters out empty/falsy domain strings", async () => {
    await recordCoOccurrence(["crime-uk", "", "transport"]);
    const counts = await getCoOccurrenceCounts();
    expect(counts).toHaveLength(1);
    expect(counts[0].pair).toBe("crime-uk:transport");
  });

  it("records n*(n-1)/2 pairs for n domains", async () => {
    const domains = ["a", "b", "c", "d"];
    await recordCoOccurrence(domains);
    const counts = await getCoOccurrenceCounts();
    expect(counts).toHaveLength(6); // 4*3/2 = 6
  });
});

// ── getCoOccurrenceCounts ─────────────────────────────────────────────────────

describe("getCoOccurrenceCounts", () => {
  it("returns empty array when no data recorded", async () => {
    const counts = await getCoOccurrenceCounts();
    expect(counts).toHaveLength(0);
  });

  it("returns results sorted by count descending", async () => {
    await recordCoOccurrence(["crime-uk", "transport"]);
    await recordCoOccurrence(["crime-uk", "transport"]);
    await recordCoOccurrence(["flood-risk", "weather"]);
    const counts = await getCoOccurrenceCounts();
    expect(counts[0].count).toBeGreaterThanOrEqual(counts[1].count);
  });

  it("each entry has pair (string) and count (number)", async () => {
    await recordCoOccurrence(["crime-uk", "transport"]);
    const counts = await getCoOccurrenceCounts();
    expect(typeof counts[0].pair).toBe("string");
    expect(typeof counts[0].count).toBe("number");
  });
});

// ── clearCoOccurrences ────────────────────────────────────────────────────────

describe("clearCoOccurrences", () => {
  it("removes all stored pairs", async () => {
    await recordCoOccurrence(["crime-uk", "transport"]);
    await clearCoOccurrences();
    const counts = await getCoOccurrenceCounts();
    expect(counts).toHaveLength(0);
  });

  it("is idempotent — clearing twice does not throw", async () => {
    await clearCoOccurrences();
    await expect(clearCoOccurrences()).resolves.not.toThrow();
  });
});
