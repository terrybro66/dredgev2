/**
 * spatial-coverage.test.ts
 *
 * Unit tests for bboxOverlaps() (pure) and the suggest-followups spatial
 * filter integration.
 *
 * Redis-dependent functions (cacheDomainBbox, getDomainBboxes) are not tested
 * here — they degrade gracefully when Redis is unavailable and are exercised by
 * integration tests.
 */

import { describe, it, expect } from "vitest";
import { bboxOverlaps } from "../spatial-coverage";
import { suggestFollowups } from "../suggest-followups";
import type { Bbox } from "../poly";
import type { DomainAdapter } from "../domains/registry";

// ── bboxOverlaps ──────────────────────────────────────────────────────────────

describe("bboxOverlaps", () => {
  const manchester: Bbox = { xmin: -2.35, ymin: 53.35, xmax: -2.10, ymax: 53.55 };
  const london:     Bbox = { xmin: -0.51, ymin: 51.28, xmax: 0.33,  ymax: 51.69 };
  const edinburgh:  Bbox = { xmin: -3.35, ymin: 55.85, xmax: -3.05, ymax: 56.00 };
  const gbWide:     Bbox = { xmin: -8.00, ymin: 49.80, xmax: 2.00,  ymax: 60.90 };

  it("returns true for identical bboxes", () => {
    expect(bboxOverlaps(manchester, manchester)).toBe(true);
  });

  it("returns true when one bbox contains the other", () => {
    expect(bboxOverlaps(gbWide, manchester)).toBe(true);
    expect(bboxOverlaps(manchester, gbWide)).toBe(true);
  });

  it("returns true for partially overlapping bboxes", () => {
    const northWest: Bbox = { xmin: -2.5, ymin: 53.3, xmax: -2.0, ymax: 53.8 };
    expect(bboxOverlaps(manchester, northWest)).toBe(true);
  });

  it("returns false for non-overlapping bboxes", () => {
    expect(bboxOverlaps(manchester, london)).toBe(false);
    expect(bboxOverlaps(manchester, edinburgh)).toBe(false);
    expect(bboxOverlaps(london, edinburgh)).toBe(false);
  });

  it("returns false for bboxes that only share an edge (exclusive)", () => {
    // london.xmax (0.33) < manchester.xmin (-2.1) — these don't share an edge
    // but test adjacency explicitly
    const a: Bbox = { xmin: 0, ymin: 0, xmax: 1, ymax: 1 };
    const b: Bbox = { xmin: 2, ymin: 0, xmax: 3, ymax: 1 }; // gap between
    expect(bboxOverlaps(a, b)).toBe(false);
  });

  it("returns true for touching bboxes (inclusive boundary)", () => {
    const a: Bbox = { xmin: 0, ymin: 0, xmax: 1, ymax: 1 };
    const b: Bbox = { xmin: 1, ymin: 0, xmax: 2, ymax: 1 }; // touching at x=1
    expect(bboxOverlaps(a, b)).toBe(true);
  });
});

// ── suggestFollowups — spatial filter integration ─────────────────────────────

function makeAdapter(name: string, templateType: string): DomainAdapter {
  return {
    config: {
      identity: {
        name,
        displayName: name,
        description: "",
        countries: ["GB"],
        intents: [name],
      },
      source: { type: "rest", endpoint: `https://example.com/${name}` },
      template: { type: templateType as any, capabilities: {} },
      fields: {},
      time: { type: "static" },
      recovery: [],
      storage: {
        storeResults: true,
        tableName: "query_results",
        prismaModel: "queryResult",
        extrasStrategy: "retain_unmapped",
      },
      visualisation: { default: "table", rules: [] },
    },
    fetchData: async () => [],
    flattenRow: (r) => r as Record<string, unknown>,
    storeResults: async () => {},
  };
}

const emptyMemory = {
  context: {
    location: null,
    active_plan: null,
    result_stack: [],
    active_filters: {},
  },
  profile: { user_attributes: {}, location_history: [] },
};

describe("suggestFollowups — spatial coverage filter", () => {
  it("shows affinity chip when target domain has no cached bbox (bootstrap)", () => {
    // No bbox for food-hygiene-gb → chip should appear regardless
    const domainBboxes = new Map<string, Bbox>(); // empty
    const queryBbox: Bbox = { xmin: -2.35, ymin: 53.35, xmax: -2.10, ymax: 53.55 };

    const chips = suggestFollowups({
      rows: [{ lat: 53.48, lon: -2.24 }],
      domain: "cinemas-gb",
      handleId: "qr_1",
      ephemeral: false,
      memory: emptyMemory,
      adapters: [
        makeAdapter("cinemas-gb", "places"),
        makeAdapter("food-hygiene-gb", "listings"),
      ],
      domainBboxes,
      queryBbox,
    });

    const affinityChip = chips.find(
      (c) => c.action === "fetch_domain" && c.args.domain === "food-hygiene-gb",
    );
    expect(affinityChip).toBeDefined();
  });

  it("shows affinity chip when target domain bbox overlaps query area", () => {
    const manchesterBbox: Bbox = { xmin: -2.35, ymin: 53.35, xmax: -2.10, ymax: 53.55 };
    const domainBboxes = new Map<string, Bbox>([
      ["food-hygiene-gb", manchesterBbox],
    ]);
    const queryBbox: Bbox = { xmin: -2.30, ymin: 53.40, xmax: -2.15, ymax: 53.50 };

    const chips = suggestFollowups({
      rows: [{ lat: 53.48, lon: -2.24 }],
      domain: "cinemas-gb",
      handleId: "qr_1",
      ephemeral: false,
      memory: emptyMemory,
      adapters: [
        makeAdapter("cinemas-gb", "places"),
        makeAdapter("food-hygiene-gb", "listings"),
      ],
      domainBboxes,
      queryBbox,
    });

    const affinityChip = chips.find(
      (c) => c.action === "fetch_domain" && c.args.domain === "food-hygiene-gb",
    );
    expect(affinityChip).toBeDefined();
  });

  it("suppresses affinity chip when target domain bbox does not overlap query area", () => {
    // food-hygiene data only in London, query is for Manchester
    const londonBbox: Bbox    = { xmin: -0.51, ymin: 51.28, xmax: 0.33,  ymax: 51.69 };
    const manchesterQuery: Bbox = { xmin: -2.35, ymin: 53.35, xmax: -2.10, ymax: 53.55 };

    const domainBboxes = new Map<string, Bbox>([
      ["food-hygiene-gb", londonBbox],
    ]);

    const chips = suggestFollowups({
      rows: [{ lat: 53.48, lon: -2.24 }],
      domain: "cinemas-gb",
      handleId: "qr_1",
      ephemeral: false,
      memory: emptyMemory,
      adapters: [
        makeAdapter("cinemas-gb", "places"),
        makeAdapter("food-hygiene-gb", "listings"),
      ],
      domainBboxes,
      queryBbox: manchesterQuery,
    });

    const suppressedChip = chips.find(
      (c) => c.action === "fetch_domain" && c.args.domain === "food-hygiene-gb",
    );
    expect(suppressedChip).toBeUndefined();
  });

  it("does not suppress capability chips (show_map etc.) via spatial filter", () => {
    const londonBbox: Bbox    = { xmin: -0.51, ymin: 51.28, xmax: 0.33, ymax: 51.69 };
    const manchesterQuery: Bbox = { xmin: -2.35, ymin: 53.35, xmax: -2.10, ymax: 53.55 };

    const domainBboxes = new Map<string, Bbox>([
      ["food-hygiene-gb", londonBbox],
    ]);

    const chips = suggestFollowups({
      rows: [{ lat: 53.48, lon: -2.24 }],
      domain: "cinemas-gb",
      handleId: "qr_1",
      ephemeral: false,
      memory: emptyMemory,
      adapters: [makeAdapter("cinemas-gb", "places")],
      domainBboxes,
      queryBbox: manchesterQuery,
    });

    expect(chips.some((c) => c.action === "show_map")).toBe(true);
  });
});
