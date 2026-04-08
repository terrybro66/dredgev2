/**
 * chip-ranker.test.ts — Phase C.4
 *
 * Tests for rankChips():
 *   - trims to CHIP_DISPLAY_MAX (3)
 *   - ordering by score (highest first)
 *   - spatial relevance penalty when no session location
 *   - recency decay across result_stack positions
 *   - domain relationship weight boost
 *   - cold-start: all zeros → stable ordering by generation order
 */

import { describe, it, expect } from "vitest";
import { rankChips, type RankChipsInput } from "../chip-ranker";
import type {
  Chip,
  ConversationMemory,
  DomainRelationship,
  ResultHandle,
} from "../types/connected";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const makeHandle = (id: string, domain = "crime-uk"): ResultHandle => ({
  id,
  type: "crime_incident",
  domain,
  capabilities: [],
  ephemeral: false,
  rowCount: 20,
  data: null,
});

const makeMemory = (
  overrides: Partial<ConversationMemory["context"]> = {},
): ConversationMemory => ({
  context: {
    location: null,
    active_plan: null,
    result_stack: [],
    active_filters: {},
    ...overrides,
  },
  profile: {
    user_attributes: {},
    location_history: [],
  },
});

const chip = (label: string, action: Chip["action"], extras: Partial<Chip["args"]> = {}): Chip => ({
  label,
  action,
  args: { ref: "h1", ...extras },
});

// ── Core ranking tests ────────────────────────────────────────────────────────

describe("rankChips — core", () => {
  it("returns at most CHIP_DISPLAY_MAX (3) chips", () => {
    const chips: Chip[] = [
      chip("A", "show_map"),
      chip("B", "show_chart"),
      chip("C", "filter_by"),
      chip("D", "compare_location"),
      chip("E", "overlay_spatial"),
    ];

    const result = rankChips({
      chips,
      handle: makeHandle("h1"),
      memory: makeMemory(),
    });

    expect(result).toHaveLength(3);
  });

  it("returns all chips when fewer than CHIP_DISPLAY_MAX", () => {
    const chips: Chip[] = [chip("A", "show_map"), chip("B", "filter_by")];

    const result = rankChips({
      chips,
      handle: makeHandle("h1"),
      memory: makeMemory(),
    });

    expect(result).toHaveLength(2);
  });

  it("annotates each chip with a numeric score", () => {
    const chips: Chip[] = [chip("A", "show_map")];

    const result = rankChips({
      chips,
      handle: makeHandle("h1"),
      memory: makeMemory(),
    });

    expect(typeof result[0].score).toBe("number");
    expect(result[0].scoreBreakdown).toBeDefined();
  });

  it("sorts chips highest score first", () => {
    // calculate_travel without a session location gets spatialRelevance 0.5,
    // so it scores lower than show_map (spatialRelevance 1.0).
    const chips: Chip[] = [
      chip("Travel", "calculate_travel"),
      chip("Map", "show_map"),
    ];

    const result = rankChips({
      chips,
      handle: makeHandle("h1"),
      memory: makeMemory({ location: null }),
    });

    expect(result[0].label).toBe("Map");
    expect(result[1].label).toBe("Travel");
  });
});

// ── Spatial relevance ─────────────────────────────────────────────────────────

describe("rankChips — spatial relevance", () => {
  it("calculate_travel scores higher when session has a location", () => {
    const withLocation = makeMemory({
      location: { lat: 51.5, lon: -0.1, display_name: "London, UK", country_code: "GB" },
    });
    const withoutLocation = makeMemory({ location: null });

    const travelChip = chip("Travel", "calculate_travel");

    const [scoredWith] = rankChips({
      chips: [travelChip],
      handle: makeHandle("h1"),
      memory: withLocation,
    });

    const [scoredWithout] = rankChips({
      chips: [travelChip],
      handle: makeHandle("h1"),
      memory: withoutLocation,
    });

    expect(scoredWith.score!).toBeGreaterThan(scoredWithout.score!);
  });

  it("show_map scores the same regardless of session location", () => {
    const mapChip = chip("Map", "show_map");
    const handle = makeHandle("h1");

    const [withLoc] = rankChips({ chips: [mapChip], handle, memory: makeMemory({ location: { lat: 51, lon: 0, display_name: "UK", country_code: "GB" } }) });
    const [withoutLoc] = rankChips({ chips: [mapChip], handle, memory: makeMemory({ location: null }) });

    expect(withLoc.score).toBe(withoutLoc.score);
  });
});

// ── Recency ───────────────────────────────────────────────────────────────────

describe("rankChips — recency", () => {
  it("chip referencing the most recent handle (idx 0) scores higher than one at idx 1", () => {
    const handle = makeHandle("h1");

    const recentChip = chip("Recent", "filter_by", { ref: "h1" });
    const olderChip  = chip("Older",  "filter_by", { ref: "h2" });

    const memory = makeMemory({
      result_stack: [
        makeHandle("h1"),
        makeHandle("h2"),
      ],
    });

    const result = rankChips({
      chips: [olderChip, recentChip],
      handle,
      memory,
    });

    expect(result[0].label).toBe("Recent");
    expect(result[1].label).toBe("Older");
  });

  it("chip with no ref gets recency 1.0 (treated as fully current)", () => {
    const noRefChip: Chip = { label: "NoRef", action: "show_map", args: {} };
    const [scored] = rankChips({
      chips: [noRefChip],
      handle: makeHandle("h1"),
      memory: makeMemory(),
    });
    // recency 1.0, spatial 1.0, frequency 0, relationship 0 → score = 0 + 0.3 + 0.2 + 0 = 0.5
    expect(scored.score).toBeCloseTo(0.5);
    expect(scored.scoreBreakdown?.recency).toBe(1.0);
  });
});

// ── Domain relationship weight ────────────────────────────────────────────────

describe("rankChips — domain relationship weight", () => {
  it("chip with matching relationship entry scores higher than one without", () => {
    const relationships: DomainRelationship[] = [
      {
        fromDomain: "flood-risk",
        toDomain:   "transport",
        relationshipType: "complements",
        weight: 1.0,
      },
    ];

    const floodHandle = makeHandle("h1", "flood-risk");

    const transportChip = chip("Transport", "fetch_domain", { domain: "transport" });
    const crimeChip     = chip("Crime",     "fetch_domain", { domain: "crime-uk" });

    const result = rankChips({
      chips: [crimeChip, transportChip],
      handle: floodHandle,
      memory: makeMemory(),
      domainRelationships: relationships,
    });

    expect(result[0].label).toBe("Transport");
    expect(result[0].scoreBreakdown?.relationshipWeight).toBe(1.0);
    expect(result[1].scoreBreakdown?.relationshipWeight).toBe(0);
  });

  it("no domainRelationships arg → relationship weight 0 for all chips", () => {
    const chips: Chip[] = [chip("A", "fetch_domain", { domain: "any" })];

    const [scored] = rankChips({
      chips,
      handle: makeHandle("h1"),
      memory: makeMemory(),
    });

    expect(scored.scoreBreakdown?.relationshipWeight).toBe(0);
  });
});

// ── Cold-start ────────────────────────────────────────────────────────────────

describe("rankChips — cold start (no history, no relationships, no location)", () => {
  it("all show_map/filter_by chips score 0.50", () => {
    // The current handle is at result_stack[0] → recency 1.0
    // frequency=0, spatialRelevance=1.0, recency=1.0, relationship=0
    // score = 0 + 0.3 + 0.2 + 0 = 0.50
    const handle = makeHandle("h1");
    const chips: Chip[] = [
      chip("Map",    "show_map"),
      chip("Filter", "filter_by"),
    ];

    const result = rankChips({
      chips,
      handle,
      memory: makeMemory({ result_stack: [handle] }),
    });

    for (const c of result) {
      expect(c.score).toBeCloseTo(0.5);
    }
  });

  it("calculate_travel without location scores 0.35 at cold start", () => {
    // frequency=0, spatialRelevance=0.5, recency=1.0 (handle at idx 0), relationship=0
    // score = 0 + 0.15 + 0.2 + 0 = 0.35
    const handle = makeHandle("h1");
    const [scored] = rankChips({
      chips: [chip("Travel", "calculate_travel")],
      handle,
      memory: makeMemory({ location: null, result_stack: [handle] }),
    });

    expect(scored.score).toBeCloseTo(0.35);
  });
});
