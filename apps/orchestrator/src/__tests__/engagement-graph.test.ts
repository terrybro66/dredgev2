/**
 * engagement-graph.test.ts
 *
 * Tests for the directed template-level transition graph (Layer 3 of chip affinity).
 *
 * Redis is mocked via vi.mock("../redis") — tests never touch a real Redis instance.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Redis mock ────────────────────────────────────────────────────────────────

const mockStore = new Map<string, number>();  // sorted set: member → score
let decayedAt: string | null = null;

const mockPipeline = {
  zadd: vi.fn().mockReturnThis(),
  zrem: vi.fn().mockReturnThis(),
  zincrby: vi.fn().mockReturnThis(),
  set: vi.fn().mockReturnThis(),
  exec: vi.fn().mockResolvedValue([]),
};

const mockRedis = {
  zincrby: vi.fn(async (_key: string, increment: number, member: string) => {
    const current = mockStore.get(member) ?? 0;
    mockStore.set(member, current + increment);
    return String(current + increment);
  }),
  zrangebyscore: vi.fn(
    async (_key: string, min: string | number, max: string | number, ...rest: string[]) => {
      const withScores = rest.includes("WITHSCORES");
      const minVal = min === "-inf" ? -Infinity : Number(min);
      const maxVal = max === "+inf" ? Infinity : Number(max);

      const entries = Array.from(mockStore.entries()).filter(
        ([, score]) => score >= minVal && score <= maxVal,
      );

      if (!withScores) return entries.map(([member]) => member);

      const result: string[] = [];
      for (const [member, score] of entries) {
        result.push(member, String(score));
      }
      return result;
    },
  ),
  get: vi.fn(async (_key: string) => decayedAt),
  set: vi.fn(async (_key: string, value: string) => {
    decayedAt = value;
    return "OK";
  }),
  del: vi.fn(async (..._keys: string[]) => {
    mockStore.clear();
    decayedAt = null;
    return 1;
  }),
  pipeline: vi.fn(() => ({
    ...mockPipeline,
    zadd: vi.fn((_key: string, score: number, member: string) => {
      mockStore.set(member, score);
      return mockPipeline;
    }),
    zrem: vi.fn((_key: string, member: string) => {
      mockStore.delete(member);
      return mockPipeline;
    }),
    set: vi.fn((_key: string, value: string) => {
      decayedAt = value;
      return mockPipeline;
    }),
    exec: vi.fn().mockResolvedValue([]),
  })),
};

vi.mock("../redis", () => ({
  getRedisClient: () => mockRedis,
}));

import {
  recordTemplateTransition,
  getTemplateTransitionWeights,
  decayAllTransitions,
  getAllTransitions,
  clearTransitions,
  ENGAGEMENT_SCALE,
  ENGAGEMENT_MIN_OBSERVATIONS,
  ENGAGEMENT_DECAY_FACTOR,
} from "../engagement-graph";

// ── Helpers ───────────────────────────────────────────────────────────────────

beforeEach(() => {
  mockStore.clear();
  // Set decayedAt to now so getTemplateTransitionWeights doesn't trigger lazy decay
  // during tests that aren't specifically testing decay behaviour.
  // Tests that want to exercise the decay path can set decayedAt = null explicitly.
  decayedAt = new Date().toISOString();
  vi.clearAllMocks();
});

// ── recordTemplateTransition ──────────────────────────────────────────────────

describe("recordTemplateTransition", () => {
  it("increments the Redis sorted set for a valid pair", async () => {
    await recordTemplateTransition("incidents", "boundaries");
    expect(mockStore.get("incidents:boundaries")).toBe(1);
  });

  it("accumulates multiple calls for the same pair", async () => {
    await recordTemplateTransition("incidents", "boundaries");
    await recordTemplateTransition("incidents", "boundaries");
    await recordTemplateTransition("incidents", "boundaries");
    expect(mockStore.get("incidents:boundaries")).toBe(3);
  });

  it("records different directed pairs independently", async () => {
    await recordTemplateTransition("incidents", "boundaries");
    await recordTemplateTransition("boundaries", "incidents");
    expect(mockStore.get("incidents:boundaries")).toBe(1);
    expect(mockStore.get("boundaries:incidents")).toBe(1);
  });

  it("ignores self-loops (from === to)", async () => {
    await recordTemplateTransition("incidents", "incidents");
    expect(mockStore.size).toBe(0);
  });

  it("ignores empty strings", async () => {
    await recordTemplateTransition("", "boundaries");
    await recordTemplateTransition("incidents", "");
    expect(mockStore.size).toBe(0);
  });

  it("does not throw when Redis errors", async () => {
    mockRedis.zincrby.mockRejectedValueOnce(new Error("Redis down"));
    await expect(
      recordTemplateTransition("incidents", "boundaries"),
    ).resolves.not.toThrow();
  });
});

// ── getTemplateTransitionWeights ─────────────────────────────────────────────

describe("getTemplateTransitionWeights", () => {
  it("returns empty Map when no transitions recorded", async () => {
    const weights = await getTemplateTransitionWeights();
    expect(weights.size).toBe(0);
  });

  it("excludes pairs below ENGAGEMENT_MIN_OBSERVATIONS", async () => {
    // 9 clicks — below the 10-click threshold
    for (let i = 0; i < ENGAGEMENT_MIN_OBSERVATIONS - 1; i++) {
      mockStore.set("incidents:boundaries", i + 1);
    }
    mockStore.set("incidents:boundaries", ENGAGEMENT_MIN_OBSERVATIONS - 1);
    const weights = await getTemplateTransitionWeights();
    expect(weights.has("incidents:boundaries")).toBe(false);
  });

  it("includes pairs at or above ENGAGEMENT_MIN_OBSERVATIONS", async () => {
    mockStore.set("incidents:boundaries", ENGAGEMENT_MIN_OBSERVATIONS);
    const weights = await getTemplateTransitionWeights();
    expect(weights.has("incidents:boundaries")).toBe(true);
  });

  it("normalises weight to [0, 1] — threshold count maps above 0", async () => {
    mockStore.set("incidents:boundaries", ENGAGEMENT_MIN_OBSERVATIONS);
    const weights = await getTemplateTransitionWeights();
    const w = weights.get("incidents:boundaries")!;
    expect(w).toBeGreaterThan(0);
    expect(w).toBeLessThanOrEqual(1);
  });

  it("caps weight at 1.0 when count exceeds ENGAGEMENT_SCALE", async () => {
    mockStore.set("incidents:boundaries", ENGAGEMENT_SCALE * 2);
    const weights = await getTemplateTransitionWeights();
    expect(weights.get("incidents:boundaries")).toBe(1.0);
  });

  it("weight at exactly ENGAGEMENT_SCALE is 1.0", async () => {
    mockStore.set("incidents:boundaries", ENGAGEMENT_SCALE);
    const weights = await getTemplateTransitionWeights();
    expect(weights.get("incidents:boundaries")).toBe(1.0);
  });

  it("returns empty Map on Redis error", async () => {
    mockRedis.get.mockRejectedValueOnce(new Error("Redis down"));
    const weights = await getTemplateTransitionWeights();
    expect(weights.size).toBe(0);
  });

  it("returns weights for multiple independent pairs", async () => {
    mockStore.set("incidents:boundaries", 50);
    mockStore.set("places:forecasts", 20);
    const weights = await getTemplateTransitionWeights();
    expect(weights.has("incidents:boundaries")).toBe(true);
    expect(weights.has("places:forecasts")).toBe(true);
  });
});

// ── decayAllTransitions ───────────────────────────────────────────────────────

describe("decayAllTransitions", () => {
  it("halves all scores by default", async () => {
    mockStore.set("incidents:boundaries", 100);
    mockStore.set("places:forecasts", 60);
    await decayAllTransitions();
    expect(mockStore.get("incidents:boundaries")).toBe(50);
    expect(mockStore.get("places:forecasts")).toBe(30);
  });

  it("removes entries that decay below 0.5", async () => {
    mockStore.set("incidents:boundaries", 1); // 1 × 0.5 = 0.5 → border; should be removed
    await decayAllTransitions();
    // 0.5 is below the 0.5 threshold after multiply — check it's gone
    // (0.5 < 0.5 is false, so the entry IS kept — test the actual threshold)
    // Actually 1 × 0.5 = 0.5, and 0.5 < 0.5 is false, so it stays
    // Let's test with a value that decays below the threshold
    mockStore.clear();
    mockStore.set("incidents:boundaries", 0); // already 0
    mockStore.set("places:forecasts", 0);
    // Manual: set a sub-threshold value
    // Use value 0.9 → 0.9 × 0.5 = 0.45 < 0.5 → removed
    // We can't set fractional directly since mockStore uses numbers, let's use a realistic test
    mockStore.clear();
    mockStore.set("incidents:boundaries", 100);
    await decayAllTransitions(0.004); // 100 × 0.004 = 0.4 < 0.5 → removed
    expect(mockStore.has("incidents:boundaries")).toBe(false);
  });

  it("records the decay timestamp", async () => {
    decayedAt = null; // reset so we can verify it gets populated
    await decayAllTransitions();
    expect(decayedAt).not.toBeNull();
    expect(new Date(decayedAt!).getTime()).toBeCloseTo(Date.now(), -3); // within 1 second
  });

  it("applies custom decay factor", async () => {
    mockStore.set("incidents:boundaries", 100);
    await decayAllTransitions(0.1);
    expect(mockStore.get("incidents:boundaries")).toBe(10);
  });

  it("does not throw when Redis errors", async () => {
    mockRedis.zrangebyscore.mockRejectedValueOnce(new Error("Redis down"));
    await expect(decayAllTransitions()).resolves.not.toThrow();
  });

  it("handles empty store gracefully", async () => {
    await expect(decayAllTransitions()).resolves.not.toThrow();
    expect(decayedAt).not.toBeNull();
  });
});

// ── getAllTransitions ─────────────────────────────────────────────────────────

describe("getAllTransitions", () => {
  it("returns empty array when no transitions", async () => {
    const results = await getAllTransitions();
    expect(results).toEqual([]);
  });

  it("returns all pairs including sub-threshold ones", async () => {
    mockStore.set("incidents:boundaries", 3);
    mockStore.set("places:forecasts", 50);
    const results = await getAllTransitions();
    expect(results).toHaveLength(2);
    const pairs = results.map((r) => r.pair);
    expect(pairs).toContain("incidents:boundaries");
    expect(pairs).toContain("places:forecasts");
  });

  it("sorts by count descending", async () => {
    mockStore.set("incidents:boundaries", 10);
    mockStore.set("places:forecasts", 50);
    mockStore.set("listings:incidents", 30);
    const results = await getAllTransitions();
    expect(results[0].count).toBeGreaterThanOrEqual(results[1].count);
    expect(results[1].count).toBeGreaterThanOrEqual(results[2].count);
  });

  it("returns [] on Redis error", async () => {
    mockRedis.zrangebyscore.mockRejectedValueOnce(new Error("Redis down"));
    const results = await getAllTransitions();
    expect(results).toEqual([]);
  });
});

// ── clearTransitions ──────────────────────────────────────────────────────────

describe("clearTransitions", () => {
  it("clears all transition data", async () => {
    mockStore.set("incidents:boundaries", 100);
    // decayedAt is already set from beforeEach; clearTransitions should null it
    await clearTransitions();
    expect(mockStore.size).toBe(0);
    expect(decayedAt).toBeNull();
  });

  it("does not throw when Redis errors", async () => {
    mockRedis.del.mockRejectedValueOnce(new Error("Redis down"));
    await expect(clearTransitions()).resolves.not.toThrow();
  });
});

// ── Integration: record → weights ─────────────────────────────────────────────

describe("record then read weights", () => {
  it("recorded transitions appear in weights once past threshold", async () => {
    // Record ENGAGEMENT_MIN_OBSERVATIONS clicks
    for (let i = 0; i < ENGAGEMENT_MIN_OBSERVATIONS; i++) {
      await recordTemplateTransition("incidents", "boundaries");
    }
    const weights = await getTemplateTransitionWeights();
    expect(weights.has("incidents:boundaries")).toBe(true);
    expect(weights.get("incidents:boundaries")).toBeCloseTo(
      ENGAGEMENT_MIN_OBSERVATIONS / ENGAGEMENT_SCALE,
      5,
    );
  });

  it("undirected mirror pair is NOT automatically created", async () => {
    for (let i = 0; i < ENGAGEMENT_MIN_OBSERVATIONS; i++) {
      await recordTemplateTransition("incidents", "boundaries");
    }
    const weights = await getTemplateTransitionWeights();
    expect(weights.has("boundaries:incidents")).toBe(false);
  });

  it("two different directed pairs accumulate independently", async () => {
    for (let i = 0; i < ENGAGEMENT_MIN_OBSERVATIONS; i++) {
      await recordTemplateTransition("incidents", "boundaries");
    }
    for (let i = 0; i < ENGAGEMENT_MIN_OBSERVATIONS * 2; i++) {
      await recordTemplateTransition("places", "forecasts");
    }
    const weights = await getTemplateTransitionWeights();
    const incBound = weights.get("incidents:boundaries")!;
    const placFore = weights.get("places:forecasts")!;
    expect(placFore).toBeGreaterThan(incBound);
  });
});
