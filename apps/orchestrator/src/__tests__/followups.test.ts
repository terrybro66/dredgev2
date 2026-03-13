import { describe, it, expect } from "vitest";
import { generateFollowUps, type FollowUpInput } from "../followups";

// ── Base fixture ──────────────────────────────────────────────────────────────

const base: FollowUpInput = {
  domain: "crime-uk",
  plan: {
    category: "burglary",
    date_from: "2024-06",
    date_to: "2024-06",
    location: "Cambridge, UK",
  },
  poly: "52.0,0.0:52.1,0.1:52.2,0.0",
  viz_hint: "map",
  resolved_location: "Cambridge, Cambridgeshire, England",
  country_code: "GB",
  intent: "crime",
  months: ["2024-06"],
  resultCount: 15,
};

// ── Single-month logic ────────────────────────────────────────────────────────

describe("single-month logic", () => {
  it("date_from === date_to → 'See last 6 months' chip is included", () => {
    const chips = generateFollowUps(base);
    expect(chips.some((c) => c.label === "See last 6 months")).toBe(true);
  });

  it("chip's plan.date_from is 6 months before the original date", () => {
    const chips = generateFollowUps(base);
    const chip = chips.find((c) => c.label === "See last 6 months")!;
    expect(chip.query.plan.date_from).toBe("2023-12");
  });

  it("chip's plan.date_to equals the original date_from", () => {
    const chips = generateFollowUps(base);
    const chip = chips.find((c) => c.label === "See last 6 months")!;
    expect(chip.query.plan.date_to).toBe("2024-06");
  });

  it("date_from !== date_to (multi-month) → 'See last 6 months' chip is NOT included", () => {
    const chips = generateFollowUps({
      ...base,
      plan: { ...base.plan, date_from: "2024-01", date_to: "2024-06" },
    });
    expect(chips.some((c) => c.label === "See last 6 months")).toBe(false);
  });
});

// ── Category logic ────────────────────────────────────────────────────────────

describe("category logic", () => {
  it("category !== 'all-crime' → 'All crime types' chip is included", () => {
    const chips = generateFollowUps(base);
    expect(chips.some((c) => c.label === "All crime types")).toBe(true);
  });

  it("category === 'all-crime' → 'All crime types' chip is NOT included", () => {
    const chips = generateFollowUps({
      ...base,
      plan: { ...base.plan, category: "all-crime" },
    });
    expect(chips.some((c) => c.label === "All crime types")).toBe(false);
  });

  it("chip's plan.category is 'all-crime'", () => {
    const chips = generateFollowUps(base);
    const chip = chips.find((c) => c.label === "All crime types")!;
    expect(chip.query.plan.category).toBe("all-crime");
  });
});

// ── Result count logic ────────────────────────────────────────────────────────

describe("result count logic", () => {
  it("resultCount < 10 (e.g. 5) → 'Widen search area' chip is included", () => {
    const chips = generateFollowUps({ ...base, resultCount: 5 });
    expect(chips.some((c) => c.label === "Widen search area")).toBe(true);
  });

  it("resultCount === 0 → 'Widen search area' chip is still included", () => {
    const chips = generateFollowUps({ ...base, resultCount: 0 });
    expect(chips.some((c) => c.label === "Widen search area")).toBe(true);
  });

  it("resultCount === 9 → 'Widen search area' chip is included", () => {
    const chips = generateFollowUps({ ...base, resultCount: 9 });
    expect(chips.some((c) => c.label === "Widen search area")).toBe(true);
  });

  it("resultCount === 10 → 'Widen search area' chip is NOT included", () => {
    const chips = generateFollowUps({ ...base, resultCount: 10 });
    expect(chips.some((c) => c.label === "Widen search area")).toBe(false);
  });

  it("resultCount > 10 → 'Widen search area' chip is NOT included", () => {
    const chips = generateFollowUps({ ...base, resultCount: 50 });
    expect(chips.some((c) => c.label === "Widen search area")).toBe(false);
  });
});

// ── Cap ───────────────────────────────────────────────────────────────────────

describe("cap at 4 chips", () => {
  it("when all three conditions fire, result has at most 4 chips", () => {
    // single month + specific category + resultCount < 10 → 3 chips max for crime-uk
    const chips = generateFollowUps({ ...base, resultCount: 0 });
    expect(chips.length).toBeLessThanOrEqual(4);
  });

  it("slice(0, 4) does not mutate — calling twice returns the same count", () => {
    const first = generateFollowUps({ ...base, resultCount: 0 });
    const second = generateFollowUps({ ...base, resultCount: 0 });
    expect(first.length).toBe(second.length);
  });
});

// ── Domain routing ────────────────────────────────────────────────────────────

describe("domain routing", () => {
  it("domain: 'weather-uk' → returns [] without throwing", () => {
    expect(() =>
      generateFollowUps({ ...base, domain: "weather-uk" }),
    ).not.toThrow();
    expect(generateFollowUps({ ...base, domain: "weather-uk" })).toEqual([]);
  });

  it("domain: '' → returns [] without throwing", () => {
    expect(generateFollowUps({ ...base, domain: "" })).toEqual([]);
  });

  it("domain: 'crime-uk' → applies crime rules", () => {
    const chips = generateFollowUps(base);
    expect(chips.length).toBeGreaterThan(0);
  });
});

// ── Chip shape ────────────────────────────────────────────────────────────────

describe("chip shape", () => {
  it("every chip has a non-empty label", () => {
    const chips = generateFollowUps({ ...base, resultCount: 0 });
    for (const chip of chips) {
      expect(chip.label).toBeTypeOf("string");
      expect(chip.label.length).toBeGreaterThan(0);
    }
  });

  it("every chip has a query object with required ExecuteBody fields", () => {
    const chips = generateFollowUps({ ...base, resultCount: 0 });
    for (const chip of chips) {
      expect(chip.query).toHaveProperty("plan");
      expect(chip.query).toHaveProperty("poly");
      expect(chip.query).toHaveProperty("viz_hint");
      expect(chip.query).toHaveProperty("resolved_location");
      expect(chip.query).toHaveProperty("country_code");
      expect(chip.query).toHaveProperty("intent");
      expect(chip.query).toHaveProperty("months");
    }
  });

  it("chips carry through unchanged poly, resolved_location, country_code, intent from input", () => {
    const chips = generateFollowUps({ ...base, resultCount: 0 });
    for (const chip of chips) {
      expect(chip.query.poly).toBe(base.poly);
      expect(chip.query.resolved_location).toBe(base.resolved_location);
      expect(chip.query.country_code).toBe(base.country_code);
      expect(chip.query.intent).toBe(base.intent);
    }
  });
});
