/**
 * relationship-discovery.test.ts — Phase D.9
 *
 * Tests for getLearnedRelationships(), getMergedRelationships(),
 * and getRelationshipWeight().
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  COOCCURRENCE_SCALE,
  COOCCURRENCE_MIN_WEIGHT,
} from "../relationship-discovery";

// ── Mock co-occurrence-log ────────────────────────────────────────────────────

let mockCounts: Array<{ pair: string; count: number }> = [];

vi.mock("../co-occurrence-log", () => ({
  getCoOccurrenceCounts: async () => mockCounts,
}));

// ── Import under test (after mock) ───────────────────────────────────────────

import {
  getLearnedRelationships,
  getMergedRelationships,
  getRelationshipWeight,
} from "../relationship-discovery";

beforeEach(() => {
  mockCounts = [];
});

// ── getLearnedRelationships ───────────────────────────────────────────────────

describe("getLearnedRelationships", () => {
  it("returns empty array when no co-occurrences recorded", async () => {
    const learned = await getLearnedRelationships();
    expect(learned).toHaveLength(0);
  });

  it("converts count to normalised weight (count / COOCCURRENCE_SCALE)", async () => {
    mockCounts = [{ pair: "crime-uk:transport", count: 25 }];
    const learned = await getLearnedRelationships();
    const rel = learned.find(
      (r) => r.fromDomain === "crime-uk" && r.toDomain === "transport",
    );
    expect(rel).toBeDefined();
    expect(rel!.weight).toBeCloseTo(25 / COOCCURRENCE_SCALE);
  });

  it("caps weight at 1.0 for counts exceeding COOCCURRENCE_SCALE", async () => {
    mockCounts = [{ pair: "crime-uk:transport", count: 200 }];
    const learned = await getLearnedRelationships();
    for (const rel of learned) {
      expect(rel.weight).toBeLessThanOrEqual(1.0);
    }
  });

  it("produces bidirectional entries for each pair", async () => {
    mockCounts = [{ pair: "crime-uk:transport", count: 10 }];
    const learned = await getLearnedRelationships();
    const aToB = learned.find(
      (r) => r.fromDomain === "crime-uk" && r.toDomain === "transport",
    );
    const bToA = learned.find(
      (r) => r.fromDomain === "transport" && r.toDomain === "crime-uk",
    );
    expect(aToB).toBeDefined();
    expect(bToA).toBeDefined();
    expect(aToB!.weight).toBe(bToA!.weight);
  });

  it("filters out pairs below COOCCURRENCE_MIN_WEIGHT", async () => {
    const lowCount = Math.floor(COOCCURRENCE_MIN_WEIGHT * COOCCURRENCE_SCALE) - 1;
    mockCounts = [{ pair: "crime-uk:transport", count: lowCount }];
    const learned = await getLearnedRelationships();
    expect(learned).toHaveLength(0);
  });

  it("includes pairs at exactly COOCCURRENCE_MIN_WEIGHT threshold", async () => {
    const thresholdCount = Math.ceil(COOCCURRENCE_MIN_WEIGHT * COOCCURRENCE_SCALE);
    mockCounts = [{ pair: "crime-uk:transport", count: thresholdCount }];
    const learned = await getLearnedRelationships();
    expect(learned.length).toBeGreaterThan(0);
  });

  it("sets relationshipType: complements for all learned entries", async () => {
    mockCounts = [{ pair: "crime-uk:weather", count: 20 }];
    const learned = await getLearnedRelationships();
    for (const rel of learned) {
      expect(rel.relationshipType).toBe("complements");
    }
  });

  it("skips malformed pairs with missing separator", async () => {
    mockCounts = [{ pair: "nodomain", count: 10 }];
    const learned = await getLearnedRelationships();
    expect(learned).toHaveLength(0);
  });
});

// ── getMergedRelationships ────────────────────────────────────────────────────

describe("getMergedRelationships", () => {
  it("returns at least the seeded relationships when no co-occurrences", async () => {
    const merged = await getMergedRelationships();
    // There are 5 seeded entries in domain-relationships.ts
    expect(merged.length).toBeGreaterThanOrEqual(5);
  });

  it("preserves seeded relationshipType when merging", async () => {
    // flood-risk → transport is seeded as "complements"
    const merged = await getMergedRelationships();
    const seeded = merged.find(
      (r) => r.fromDomain === "flood-risk" && r.toDomain === "transport",
    );
    expect(seeded?.relationshipType).toBe("complements");
  });

  it("boosts seeded weight when learned weight is higher", async () => {
    // crime-uk → transport is seeded at 0.5
    // a learned weight of 0.9 should override
    mockCounts = [{ pair: "crime-uk:transport", count: 45 }]; // 0.9
    const merged = await getMergedRelationships();
    const rel = merged.find(
      (r) => r.fromDomain === "crime-uk" && r.toDomain === "transport",
    );
    expect(rel!.weight).toBeGreaterThan(0.5);
  });

  it("keeps seeded weight when it is higher than learned", async () => {
    // flood-risk → transport is seeded at 0.9 (very high)
    mockCounts = [{ pair: "flood-risk:transport", count: 5 }]; // 0.1
    const merged = await getMergedRelationships();
    const rel = merged.find(
      (r) => r.fromDomain === "flood-risk" && r.toDomain === "transport",
    );
    expect(rel!.weight).toBeCloseTo(0.9);
  });

  it("adds a new pair not present in seeded entries", async () => {
    mockCounts = [{ pair: "cinemas-gb:crime-uk", count: 30 }]; // novel pair
    const merged = await getMergedRelationships();
    const novel = merged.find(
      (r) => r.fromDomain === "cinemas-gb" && r.toDomain === "crime-uk",
    );
    expect(novel).toBeDefined();
    expect(novel!.weight).toBeCloseTo(30 / COOCCURRENCE_SCALE);
  });

  it("returns results sorted by weight descending", async () => {
    mockCounts = [{ pair: "cinemas-gb:weather", count: 50 }]; // weight 1.0
    const merged = await getMergedRelationships();
    for (let i = 0; i < merged.length - 1; i++) {
      expect(merged[i].weight).toBeGreaterThanOrEqual(merged[i + 1].weight);
    }
  });

  it("does not produce duplicates for the same (from, to) pair", async () => {
    mockCounts = [{ pair: "crime-uk:transport", count: 20 }];
    const merged = await getMergedRelationships();
    const crimeToTransport = merged.filter(
      (r) => r.fromDomain === "crime-uk" && r.toDomain === "transport",
    );
    expect(crimeToTransport).toHaveLength(1);
  });
});

// ── getRelationshipWeight ─────────────────────────────────────────────────────

describe("getRelationshipWeight", () => {
  it("returns the seeded weight for a known pair", async () => {
    // flood-risk → transport seeded at 0.9
    const weight = await getRelationshipWeight("flood-risk", "transport");
    expect(weight).toBeCloseTo(0.9);
  });

  it("returns 0 for an unknown pair", async () => {
    const weight = await getRelationshipWeight("cinemas-gb", "flood-risk");
    expect(weight).toBe(0);
  });

  it("returns boosted weight when learned exceeds seeded", async () => {
    mockCounts = [{ pair: "crime-uk:transport", count: 50 }]; // weight 1.0
    const weight = await getRelationshipWeight("crime-uk", "transport");
    expect(weight).toBe(1.0);
  });

  it("is directional — (A→B) and (B→A) may differ", async () => {
    const atob = await getRelationshipWeight("flood-risk", "transport");
    const btoa = await getRelationshipWeight("transport", "flood-risk");
    // seeded entries only have flood-risk→transport at 0.9, not the reverse
    expect(atob).not.toBe(btoa);
  });
});
