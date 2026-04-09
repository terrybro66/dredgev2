/**
 * food-business-gb.test.ts — Phase D.5
 *
 * Tests for the foodBusinessGbAdapter RegulatoryAdapter:
 *   - returns conditional + next_questions when attributes are missing
 *   - returns eligible + correct conditions for each food_type
 *   - base conditions are always present
 *   - references always include the FSA URL
 */

import { describe, it, expect } from "vitest";
import { foodBusinessGbAdapter } from "../domains/food-business-gb/index";

// ── Adapter metadata ──────────────────────────────────────────────────────────

describe("foodBusinessGbAdapter metadata", () => {
  it("has the correct name", () => {
    expect(foodBusinessGbAdapter.name).toBe("food-business-gb");
  });

  it("handles food business intents", () => {
    const intents = foodBusinessGbAdapter.intents;
    expect(intents.some((i) => i.toLowerCase().includes("food"))).toBe(true);
  });

  it("is scoped to GB", () => {
    expect(foodBusinessGbAdapter.countries).toContain("GB");
  });

  it("requires business_type and food_type", () => {
    expect(foodBusinessGbAdapter.requiredAttributes).toContain("business_type");
    expect(foodBusinessGbAdapter.requiredAttributes).toContain("food_type");
  });
});

// ── Missing attributes ────────────────────────────────────────────────────────

describe("evaluate — missing attributes", () => {
  it("returns conditional when both attributes are absent", async () => {
    const result = await foodBusinessGbAdapter.evaluate({});
    expect(result.eligibility).toBe("conditional");
    expect(result.next_questions.length).toBeGreaterThan(0);
  });

  it("next_questions contains business_type field when missing", async () => {
    const result = await foodBusinessGbAdapter.evaluate({ food_type: "Restaurant / café" });
    const fields = result.next_questions.map((q) => q.field);
    expect(fields).toContain("business_type");
  });

  it("next_questions contains food_type field when missing", async () => {
    const result = await foodBusinessGbAdapter.evaluate({ business_type: "New business" });
    const fields = result.next_questions.map((q) => q.field);
    expect(fields).toContain("food_type");
  });

  it("returns conditional (not eligible) when one attribute is empty string", async () => {
    const result = await foodBusinessGbAdapter.evaluate({
      business_type: "New business",
      food_type: "",
    });
    expect(result.eligibility).toBe("conditional");
  });

  it("returns empty conditions when attributes are missing", async () => {
    const result = await foodBusinessGbAdapter.evaluate({});
    expect(result.conditions).toHaveLength(0);
  });
});

// ── Base conditions (always present when eligible) ────────────────────────────

const BASE_ATTRS = { business_type: "New business", food_type: "Other" };

describe("evaluate — base conditions", () => {
  it("returns eligible when all required attributes present", async () => {
    const result = await foodBusinessGbAdapter.evaluate(BASE_ATTRS);
    expect(result.eligibility).toBe("eligible");
  });

  it("includes local authority registration condition", async () => {
    const result = await foodBusinessGbAdapter.evaluate(BASE_ATTRS);
    const joined = result.conditions.join(" ").toLowerCase();
    expect(joined).toMatch(/local authority/);
  });

  it("includes 28 days notice", async () => {
    const result = await foodBusinessGbAdapter.evaluate(BASE_ATTRS);
    const joined = result.conditions.join(" ");
    expect(joined).toMatch(/28 days/);
  });

  it("includes free registration notice", async () => {
    const result = await foodBusinessGbAdapter.evaluate(BASE_ATTRS);
    const joined = result.conditions.join(" ").toLowerCase();
    expect(joined).toMatch(/free/);
  });

  it("includes FSA reference URL", async () => {
    const result = await foodBusinessGbAdapter.evaluate(BASE_ATTRS);
    expect(result.references.some((r) => r.includes("food.gov.uk"))).toBe(true);
  });

  it("has no next_questions when fully answered", async () => {
    const result = await foodBusinessGbAdapter.evaluate(BASE_ATTRS);
    expect(result.next_questions).toHaveLength(0);
  });
});

// ── Food-type-specific conditions ─────────────────────────────────────────────

describe("evaluate — Restaurant / café", () => {
  const attrs = { business_type: "New business", food_type: "Restaurant / café" };

  it("returns eligible", async () => {
    const result = await foodBusinessGbAdapter.evaluate(attrs);
    expect(result.eligibility).toBe("eligible");
  });

  it("mentions food hygiene training", async () => {
    const result = await foodBusinessGbAdapter.evaluate(attrs);
    const joined = result.conditions.join(" ").toLowerCase();
    expect(joined).toMatch(/food hygiene/);
  });
});

describe("evaluate — Takeaway", () => {
  const attrs = { business_type: "New business", food_type: "Takeaway" };

  it("returns eligible", async () => {
    const result = await foodBusinessGbAdapter.evaluate(attrs);
    expect(result.eligibility).toBe("eligible");
  });

  it("requires display of Food Hygiene Rating", async () => {
    const result = await foodBusinessGbAdapter.evaluate(attrs);
    const joined = result.conditions.join(" ").toLowerCase();
    expect(joined).toMatch(/hygiene rating/);
  });
});

describe("evaluate — Market stall", () => {
  const attrs = { business_type: "New business", food_type: "Market stall" };

  it("returns eligible", async () => {
    const result = await foodBusinessGbAdapter.evaluate(attrs);
    expect(result.eligibility).toBe("eligible");
  });

  it("mentions street trading licence", async () => {
    const result = await foodBusinessGbAdapter.evaluate(attrs);
    const joined = result.conditions.join(" ").toLowerCase();
    expect(joined).toMatch(/street trading/);
  });
});

describe("evaluate — Home catering", () => {
  const attrs = { business_type: "New business", food_type: "Home catering" };

  it("returns eligible", async () => {
    const result = await foodBusinessGbAdapter.evaluate(attrs);
    expect(result.eligibility).toBe("eligible");
  });

  it("recommends Food Hygiene certificate", async () => {
    const result = await foodBusinessGbAdapter.evaluate(attrs);
    const joined = result.conditions.join(" ").toLowerCase();
    expect(joined).toMatch(/food hygiene/);
  });
});

describe("evaluate — Food manufacturer", () => {
  const attrs = { business_type: "New business", food_type: "Food manufacturer" };

  it("returns eligible", async () => {
    const result = await foodBusinessGbAdapter.evaluate(attrs);
    expect(result.eligibility).toBe("eligible");
  });

  it("recommends Food Hygiene certificate", async () => {
    const result = await foodBusinessGbAdapter.evaluate(attrs);
    const joined = result.conditions.join(" ").toLowerCase();
    expect(joined).toMatch(/food hygiene/);
  });

  it("mentions hygiene requirements for premises", async () => {
    const result = await foodBusinessGbAdapter.evaluate(attrs);
    const joined = result.conditions.join(" ").toLowerCase();
    expect(joined).toMatch(/hygiene/);
  });
});

describe("evaluate — change of ownership", () => {
  it("is eligible regardless of business_type variant", async () => {
    const result = await foodBusinessGbAdapter.evaluate({
      business_type: "Change of ownership",
      food_type:     "Restaurant / café",
    });
    expect(result.eligibility).toBe("eligible");
  });
});
