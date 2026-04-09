/**
 * regulatory-adapter.test.ts — Phase D.4
 *
 * Tests for the RegulatoryAdapter registry:
 *   - registerRegulatoryAdapter / getRegulatoryAdapter / clearRegulatoryRegistry
 *   - getMissingAttributeQuestions helper
 *   - intent matching (substring, case-insensitive)
 *   - country filtering
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  registerRegulatoryAdapter,
  getRegulatoryAdapter,
  clearRegulatoryRegistry,
  getMissingAttributeQuestions,
  type RegulatoryAdapter,
} from "../regulatory-adapter";
import type { ClarificationField, DecisionResult } from "../types/connected";

// ── Minimal stub adapter ──────────────────────────────────────────────────────

function makeAdapter(
  name: string,
  intents: string[],
  countries: string[],
): RegulatoryAdapter {
  return {
    name,
    intents,
    countries,
    requiredAttributes: ["attr_a"],
    async evaluate(): Promise<DecisionResult> {
      return {
        eligibility:    "eligible",
        conditions:     ["All clear"],
        next_questions: [],
        references:     [],
      };
    },
  };
}

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  clearRegulatoryRegistry();
});

// ── registerRegulatoryAdapter ─────────────────────────────────────────────────

describe("registerRegulatoryAdapter", () => {
  it("registers without throwing", () => {
    expect(() =>
      registerRegulatoryAdapter(makeAdapter("test-adapter", ["test intent"], ["GB"])),
    ).not.toThrow();
  });

  it("overwrites a previous adapter with the same name", () => {
    const a1 = makeAdapter("dup", ["intent-a"], ["GB"]);
    const a2 = makeAdapter("dup", ["intent-b"], ["US"]);
    registerRegulatoryAdapter(a1);
    registerRegulatoryAdapter(a2);
    // intent-a is gone; intent-b is now found for US
    expect(getRegulatoryAdapter("intent-b", "US")).toBeDefined();
    expect(getRegulatoryAdapter("intent-a", "GB")).toBeUndefined();
  });
});

// ── getRegulatoryAdapter ──────────────────────────────────────────────────────

describe("getRegulatoryAdapter — intent matching", () => {
  beforeEach(() => {
    registerRegulatoryAdapter(
      makeAdapter("food-gb", ["food business registration", "start a food business"], ["GB"]),
    );
  });

  it("returns adapter for exact intent", () => {
    expect(getRegulatoryAdapter("food business registration", "GB")).toBeDefined();
  });

  it("returns adapter when intent is a substring of the query", () => {
    expect(
      getRegulatoryAdapter("I want to start a food business in London", "GB"),
    ).toBeDefined();
  });

  it("is case-insensitive", () => {
    expect(getRegulatoryAdapter("Food Business Registration", "GB")).toBeDefined();
    expect(getRegulatoryAdapter("FOOD BUSINESS REGISTRATION", "GB")).toBeDefined();
  });

  it("returns undefined for an unrelated intent", () => {
    expect(getRegulatoryAdapter("crime statistics in Manchester", "GB")).toBeUndefined();
  });
});

describe("getRegulatoryAdapter — country filtering", () => {
  beforeEach(() => {
    registerRegulatoryAdapter(makeAdapter("gb-only", ["test licence"], ["GB"]));
    registerRegulatoryAdapter(makeAdapter("any-country", ["universal permit"], []));
  });

  it("matches GB adapter for GB country code", () => {
    expect(getRegulatoryAdapter("test licence", "GB")).toBeDefined();
  });

  it("does NOT match GB adapter for a different country", () => {
    expect(getRegulatoryAdapter("test licence", "US")).toBeUndefined();
  });

  it("matches any-country adapter for any country code", () => {
    expect(getRegulatoryAdapter("universal permit", "FR")).toBeDefined();
    expect(getRegulatoryAdapter("universal permit", "AU")).toBeDefined();
    expect(getRegulatoryAdapter("universal permit", "GB")).toBeDefined();
  });
});

describe("getRegulatoryAdapter — multiple adapters", () => {
  it("returns the first matching adapter when multiple could match", () => {
    registerRegulatoryAdapter(makeAdapter("adapter-a", ["shared intent"], ["GB"]));
    registerRegulatoryAdapter(makeAdapter("adapter-b", ["shared intent"], ["GB"]));
    const found = getRegulatoryAdapter("shared intent", "GB");
    expect(found).toBeDefined();
    // One of the two is returned (order is insertion order of Map)
    expect(["adapter-a", "adapter-b"]).toContain(found!.name);
  });
});

// ── getMissingAttributeQuestions ──────────────────────────────────────────────

describe("getMissingAttributeQuestions", () => {
  const FIELD_DEFS: ClarificationField[] = [
    {
      field:      "business_type",
      prompt:     "Is this a new business?",
      input_type: "select",
      options:    ["New", "Existing"],
      target:     "user_attributes",
    },
    {
      field:      "food_type",
      prompt:     "What type of food operation?",
      input_type: "select",
      options:    ["Restaurant", "Takeaway"],
      target:     "user_attributes",
    },
  ];

  it("returns all fields when userAttributes is empty", () => {
    const missing = getMissingAttributeQuestions(
      ["business_type", "food_type"],
      {},
      FIELD_DEFS,
    );
    expect(missing).toHaveLength(2);
    expect(missing.map((f) => f.field)).toEqual(["business_type", "food_type"]);
  });

  it("returns only the missing fields", () => {
    const missing = getMissingAttributeQuestions(
      ["business_type", "food_type"],
      { business_type: "New" },
      FIELD_DEFS,
    );
    expect(missing).toHaveLength(1);
    expect(missing[0].field).toBe("food_type");
  });

  it("returns empty array when all attributes are present", () => {
    const missing = getMissingAttributeQuestions(
      ["business_type", "food_type"],
      { business_type: "New", food_type: "Restaurant" },
      FIELD_DEFS,
    );
    expect(missing).toHaveLength(0);
  });

  it("treats null and empty string as missing", () => {
    const missing = getMissingAttributeQuestions(
      ["business_type", "food_type"],
      { business_type: null, food_type: "" },
      FIELD_DEFS,
    );
    expect(missing).toHaveLength(2);
  });

  it("only returns fields whose keys appear in the required list", () => {
    // food_type not in required — should not appear
    const missing = getMissingAttributeQuestions(
      ["business_type"],
      {},
      FIELD_DEFS,
    );
    expect(missing).toHaveLength(1);
    expect(missing[0].field).toBe("business_type");
  });
});
