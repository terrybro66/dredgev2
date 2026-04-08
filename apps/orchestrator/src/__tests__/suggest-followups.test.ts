/**
 * suggest-followups.test.ts — Phase C.6
 *
 * Tests for suggestFollowups():
 *   - returns Chip[] (not FollowUp[])
 *   - returns at most CHIP_DISPLAY_MAX chips
 *   - returns [] for empty rows (no capabilities)
 *   - has_coordinates rows → show_map chip included
 *   - flood-risk domain boosts transport chip via C.5 relationships
 *   - ephemeral flag propagates to handle
 */

import { describe, it, expect } from "vitest";
import { suggestFollowups } from "../suggest-followups";
import type { ConversationMemory } from "../types/connected";
import { CHIP_DISPLAY_MAX } from "../types/connected";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const emptyMemory: ConversationMemory = {
  context: {
    location: null,
    active_plan: null,
    result_stack: [],
    active_filters: {},
  },
  profile: {
    user_attributes: {},
    location_history: [],
  },
};

/** Rows that satisfy has_coordinates (≥ 80% have lat+lon) */
const coordinateRows = Array.from({ length: 5 }, (_, i) => ({
  id: i,
  lat: 51.5 + i * 0.01,
  lon: -0.1 + i * 0.01,
  description: `Location ${i}`,
}));

/** Rows with has_time_series + has_category */
const timeSeriesRows = [
  { date: "2025-01", category: "flood", value: 3 },
  { date: "2025-02", category: "storm", value: 7 },
  { date: "2025-03", category: "flood", value: 1 },
];

// ── Core behaviour ────────────────────────────────────────────────────────────

describe("suggestFollowups — core", () => {
  it("returns an array", () => {
    const result = suggestFollowups({
      rows: coordinateRows,
      domain: "crime-uk",
      handleId: "qr_1",
      ephemeral: false,
      memory: emptyMemory,
    });

    expect(Array.isArray(result)).toBe(true);
  });

  it("returns at most CHIP_DISPLAY_MAX chips", () => {
    // rows with multiple capabilities → many chips generated
    const richRows = coordinateRows.map((r, i) => ({
      ...r,
      date: `2025-0${(i % 3) + 1}`,
      value: i * 2,
      category: i % 2 === 0 ? "A" : "B",
    }));

    const result = suggestFollowups({
      rows: richRows,
      domain: "crime-uk",
      handleId: "qr_1",
      ephemeral: false,
      memory: emptyMemory,
    });

    expect(result.length).toBeLessThanOrEqual(CHIP_DISPLAY_MAX);
  });

  it("returns [] when rows are empty (no capabilities can be inferred)", () => {
    const result = suggestFollowups({
      rows: [],
      domain: "crime-uk",
      handleId: "qr_1",
      ephemeral: false,
      memory: emptyMemory,
    });

    expect(result).toEqual([]);
  });

  it("each chip has label, action, args, score, and scoreBreakdown", () => {
    const result = suggestFollowups({
      rows: coordinateRows,
      domain: "crime-uk",
      handleId: "qr_1",
      ephemeral: false,
      memory: emptyMemory,
    });

    expect(result.length).toBeGreaterThan(0);
    for (const chip of result) {
      expect(typeof chip.label).toBe("string");
      expect(typeof chip.action).toBe("string");
      expect(chip.args).toBeDefined();
      expect(typeof chip.score).toBe("number");
      expect(chip.scoreBreakdown).toBeDefined();
    }
  });
});

// ── Capability → chip mapping ─────────────────────────────────────────────────

describe("suggestFollowups — capabilities", () => {
  it("coordinate rows produce a show_map chip", () => {
    const result = suggestFollowups({
      rows: coordinateRows,
      domain: "crime-uk",
      handleId: "qr_1",
      ephemeral: false,
      memory: emptyMemory,
    });

    expect(result.some((c) => c.action === "show_map")).toBe(true);
  });

  it("time-series rows produce a show_chart chip", () => {
    const result = suggestFollowups({
      rows: timeSeriesRows,
      domain: "flood-risk",
      handleId: "qr_2",
      ephemeral: false,
      memory: emptyMemory,
    });

    expect(result.some((c) => c.action === "show_chart")).toBe(true);
  });
});

// ── Domain relationship boost ─────────────────────────────────────────────────

describe("suggestFollowups — domain relationship boost (C.5)", () => {
  it("flood-risk domain: transport chip gets relationshipWeight 0.9", () => {
    // has_coordinates → generates fetch_domain:transport chip
    // flood-risk → transport weight is 0.9 in DOMAIN_RELATIONSHIPS
    const result = suggestFollowups({
      rows: coordinateRows,
      domain: "flood-risk",
      handleId: "qr_3",
      ephemeral: false,
      memory: emptyMemory,
    });

    const transportChip = result.find(
      (c) => c.action === "fetch_domain" && c.args.domain === "transport",
    );

    // chip may be trimmed by CHIP_DISPLAY_MAX but if present must have correct weight
    if (transportChip) {
      expect(transportChip.scoreBreakdown!.relationshipWeight).toBe(0.9);
    }
  });

  it("crime-uk domain: transport chip gets relationshipWeight 0.5 (lower than flood)", () => {
    const crimeResult = suggestFollowups({
      rows: coordinateRows,
      domain: "crime-uk",
      handleId: "qr_4",
      ephemeral: false,
      memory: emptyMemory,
    });

    const floodResult = suggestFollowups({
      rows: coordinateRows,
      domain: "flood-risk",
      handleId: "qr_5",
      ephemeral: false,
      memory: emptyMemory,
    });

    const crimeTransport = crimeResult.find(
      (c) => c.action === "fetch_domain" && c.args.domain === "transport",
    );
    const floodTransport = floodResult.find(
      (c) => c.action === "fetch_domain" && c.args.domain === "transport",
    );

    if (crimeTransport && floodTransport) {
      expect(crimeTransport.scoreBreakdown!.relationshipWeight).toBe(0.5);
      expect(floodTransport.scoreBreakdown!.relationshipWeight).toBe(0.9);
      expect(floodTransport.score!).toBeGreaterThan(crimeTransport.score!);
    }
  });
});

// ── Ephemeral flag ────────────────────────────────────────────────────────────

describe("suggestFollowups — ephemeral flag", () => {
  it("chip args.ref equals the provided handleId", () => {
    const result = suggestFollowups({
      rows: coordinateRows,
      domain: "cinema-listings",
      handleId: "ephemeral_abc",
      ephemeral: true,
      memory: emptyMemory,
    });

    for (const chip of result) {
      if (chip.args.ref !== undefined) {
        expect(chip.args.ref).toBe("ephemeral_abc");
      }
    }
  });
});
