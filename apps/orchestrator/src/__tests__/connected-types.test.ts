import { describe, it, expect } from "vitest";
import {
  computeChipScore,
  REFINEMENT_PATTERNS,
  COMPOSING_FILTER_KEYS,
  MAX_EPHEMERAL_ROWS,
  RESULT_STACK_MAX,
  EPHEMERAL_TTL_SECONDS,
  CHIP_DISPLAY_MAX,
  type Capability,
  type OrchestratorResponse,
  type ConversationMemory,
  type ResultHandle,
  type Chip,
  type ClarificationRequest,
} from "../types/connected";

// ── computeChipScore ──────────────────────────────────────────────────────────

describe("computeChipScore", () => {
  it("returns a value between 0 and 1 for a typical chip", () => {
    const score = computeChipScore({
      frequency: 0.8,
      spatialRelevance: 0.9,
      recency: 0.5,
      relationshipWeight: 0.7,
    });
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThanOrEqual(1);
  });

  it("applies the correct weights: 0.4 / 0.3 / 0.2 / 0.1", () => {
    // All components = 1.0 → total must equal 1.0
    expect(
      computeChipScore({
        frequency: 1,
        spatialRelevance: 1,
        recency: 1,
        relationshipWeight: 1,
      }),
    ).toBeCloseTo(1.0);

    // Only frequency set
    expect(
      computeChipScore({
        frequency: 1,
        spatialRelevance: 0,
        recency: 0,
        relationshipWeight: 0,
      }),
    ).toBeCloseTo(0.4);

    // Only spatialRelevance set
    expect(
      computeChipScore({
        frequency: 0,
        spatialRelevance: 1,
        recency: 0,
        relationshipWeight: 0,
      }),
    ).toBeCloseTo(0.3);

    // Only recency set
    expect(
      computeChipScore({
        frequency: 0,
        spatialRelevance: 0,
        recency: 1,
        relationshipWeight: 0,
      }),
    ).toBeCloseTo(0.2);

    // Only relationshipWeight set
    expect(
      computeChipScore({
        frequency: 0,
        spatialRelevance: 0,
        recency: 0,
        relationshipWeight: 1,
      }),
    ).toBeCloseTo(0.1);
  });

  it("returns 0 when all components are 0", () => {
    expect(
      computeChipScore({
        frequency: 0,
        spatialRelevance: 0,
        recency: 0,
        relationshipWeight: 0,
      }),
    ).toBe(0);
  });
});

// ── REFINEMENT_PATTERNS ───────────────────────────────────────────────────────

describe("REFINEMENT_PATTERNS", () => {
  it("matches date_shift patterns", () => {
    const p = REFINEMENT_PATTERNS.find((r) => r.type === "date_shift")!;
    expect(p.re.test("last 6 months")).toBe(true);
    expect(p.re.test("past year")).toBe(true);
    expect(p.re.test("previous 3 weeks")).toBe(true);
  });

  it("matches location_shift patterns", () => {
    const p = REFINEMENT_PATTERNS.find((r) => r.type === "location_shift")!;
    expect(p.re.test("in Hackney")).toBe(true);
    expect(p.re.test("near Bristol")).toBe(true);
  });

  it("matches category_filter patterns", () => {
    const p = REFINEMENT_PATTERNS.find((r) => r.type === "category_filter")!;
    expect(p.re.test("just burglaries")).toBe(true);
    expect(p.re.test("just comedy")).toBe(true);
  });

  it("matches aggregation_change patterns", () => {
    const p = REFINEMENT_PATTERNS.find((r) => r.type === "aggregation_change")!;
    expect(p.re.test("group by month")).toBe(true);
    expect(p.re.test("by week")).toBe(true);
  });

  it("does not match unrelated text", () => {
    for (const { re } of REFINEMENT_PATTERNS) {
      expect(re.test("hello world")).toBe(false);
    }
  });
});

// ── COMPOSING_FILTER_KEYS ─────────────────────────────────────────────────────

describe("COMPOSING_FILTER_KEYS", () => {
  it("contains the composing keys", () => {
    expect(COMPOSING_FILTER_KEYS.has("exclude")).toBe(true);
    expect(COMPOSING_FILTER_KEYS.has("not")).toBe(true);
    expect(COMPOSING_FILTER_KEYS.has("exclude_category")).toBe(true);
  });

  it("does not contain replacement keys", () => {
    expect(COMPOSING_FILTER_KEYS.has("category")).toBe(false);
    expect(COMPOSING_FILTER_KEYS.has("date")).toBe(false);
    expect(COMPOSING_FILTER_KEYS.has("location")).toBe(false);
  });
});

// ── Constants ─────────────────────────────────────────────────────────────────

describe("lifecycle constants", () => {
  it("MAX_EPHEMERAL_ROWS is 100", () => {
    expect(MAX_EPHEMERAL_ROWS).toBe(100);
  });

  it("RESULT_STACK_MAX is 5", () => {
    expect(RESULT_STACK_MAX).toBe(5);
  });

  it("EPHEMERAL_TTL_SECONDS is 3600", () => {
    expect(EPHEMERAL_TTL_SECONDS).toBe(3600);
  });

  it("CHIP_DISPLAY_MAX is 3", () => {
    expect(CHIP_DISPLAY_MAX).toBe(3);
  });
});

// ── Type shape assertions (compile-time) ─────────────────────────────────────
// These never run as assertions — they exist so TypeScript errors on any type
// regression the moment this file is compiled.

describe("type shapes", () => {
  it("OrchestratorResponse discriminated union compiles correctly", () => {
    const result: OrchestratorResponse = {
      type: "result",
      handle: {
        id: "qr_1",
        type: "crime_incident",
        domain: "crime-uk",
        capabilities: ["has_coordinates" as Capability],
        ephemeral: false,
        rowCount: 42,
        data: null,
      },
      chips: [],
      viz: "map",
    };
    expect(result.type).toBe("result");
  });

  it("result type accepts optional pending_clarification", () => {
    const result: OrchestratorResponse = {
      type: "result",
      handle: {
        id: "reg_1",
        type: "decision_result",
        domain: "food-business-uk",
        capabilities: ["has_regulatory_reference" as Capability],
        ephemeral: false,
        rowCount: 1,
        data: null,
      },
      chips: [],
      viz: "table",
      pending_clarification: {
        intent: "food_business_uk",
        questions: [
          {
            field: "premises_type",
            prompt: "Is this a new premises or change of use?",
            input_type: "select",
            options: ["new", "change_of_use"],
            target: "user_attributes",
          },
        ],
      },
    };
    expect(result.type).toBe("result");
    if (result.type === "result") {
      expect(result.pending_clarification?.questions).toHaveLength(1);
    }
  });

  it("clarification type compiles correctly", () => {
    const clarification: OrchestratorResponse = {
      type: "clarification",
      request: {
        intent: "hunting_license_ak",
        questions: [
          {
            field: "age",
            prompt: "How old are you?",
            input_type: "number",
            target: "user_attributes",
          },
        ],
      },
    };
    expect(clarification.type).toBe("clarification");
  });

  it("stale_reference error compiles correctly", () => {
    const err: OrchestratorResponse = {
      type: "error",
      error: "stale_reference",
      message:
        "This option is no longer available — the result it referred to has expired.",
    };
    expect(err.type).toBe("error");
  });

  it("ConversationMemory shape compiles correctly", () => {
    const mem: ConversationMemory = {
      location: null,
      active_plan: null,
      result_stack: [],
      user_attributes: {},
      active_filters: {},
    };
    expect(mem.result_stack).toHaveLength(0);
  });

  it("Chip with clarify action compiles correctly", () => {
    const chip: Chip = {
      label: "What game are you hunting?",
      action: "clarify",
      args: { field: "game_species" },
    };
    expect(chip.action).toBe("clarify");
  });
});
