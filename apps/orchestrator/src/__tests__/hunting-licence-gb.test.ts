/**
 * hunting-licence-gb.test.ts — Phase D.11
 *
 * Tests for huntingLicenceGbAdapter:
 *   - returns ineligible for age < 14
 *   - returns conditional for age 14–17
 *   - returns eligible for age 18+ with suggested_chips
 *   - returns next_questions when attributes are missing
 *   - includes non-resident condition when residency is false
 *   - species-specific conditions (Deer, Grouse, Duck)
 *   - getRegulatoryAdapter resolves adapter for hunting intent
 */

import { describe, it, expect, beforeEach } from "vitest";
import { huntingLicenceGbAdapter } from "../domains/hunting-licence-gb/index";
import {
  getRegulatoryAdapter,
  clearRegulatoryRegistry,
  registerRegulatoryAdapter,
} from "../regulatory-adapter";

// ── adapter metadata ──────────────────────────────────────────────────────────

describe("huntingLicenceGbAdapter metadata", () => {
  it("has name hunting-licence-gb", () => {
    expect(huntingLicenceGbAdapter.name).toBe("hunting-licence-gb");
  });

  it("is scoped to GB", () => {
    expect(huntingLicenceGbAdapter.countries).toContain("GB");
  });

  it("handles hunting licence eligibility intent", () => {
    expect(huntingLicenceGbAdapter.intents).toContain(
      "hunting licence eligibility",
    );
  });

  it("requires age, residency, game_species", () => {
    expect(huntingLicenceGbAdapter.requiredAttributes).toEqual(
      expect.arrayContaining(["age", "residency", "game_species"]),
    );
  });
});

// ── evaluate: missing attributes ──────────────────────────────────────────────

describe("huntingLicenceGbAdapter.evaluate — missing attributes", () => {
  it("returns next_questions when all attributes missing", async () => {
    const result = await huntingLicenceGbAdapter.evaluate({});
    expect(result.next_questions.length).toBeGreaterThan(0);
    expect(result.eligibility).toBe("conditional");
  });

  it("returns next_questions for missing game_species only", async () => {
    const result = await huntingLicenceGbAdapter.evaluate({
      age: 25,
      residency: true,
    });
    const fields = result.next_questions.map((q) => q.field);
    expect(fields).toContain("game_species");
    expect(fields).not.toContain("age");
  });

  it("returns empty next_questions when all attributes present", async () => {
    const result = await huntingLicenceGbAdapter.evaluate({
      age: 30,
      residency: true,
      game_species: "Deer",
    });
    expect(result.next_questions).toHaveLength(0);
  });
});

// ── evaluate: age gating ──────────────────────────────────────────────────────

describe("huntingLicenceGbAdapter.evaluate — age gating", () => {
  it("returns ineligible for age 10", async () => {
    const result = await huntingLicenceGbAdapter.evaluate({
      age: 10,
      residency: true,
      game_species: "Pheasant",
    });
    expect(result.eligibility).toBe("ineligible");
  });

  it("returns ineligible for age 13", async () => {
    const result = await huntingLicenceGbAdapter.evaluate({
      age: 13,
      residency: true,
      game_species: "Deer",
    });
    expect(result.eligibility).toBe("ineligible");
  });

  it("returns conditional for age 14", async () => {
    const result = await huntingLicenceGbAdapter.evaluate({
      age: 14,
      residency: true,
      game_species: "Pheasant",
    });
    expect(result.eligibility).toBe("conditional");
  });

  it("returns conditional for age 17", async () => {
    const result = await huntingLicenceGbAdapter.evaluate({
      age: 17,
      residency: true,
      game_species: "Duck",
    });
    expect(result.eligibility).toBe("conditional");
  });

  it("returns eligible for age 18", async () => {
    const result = await huntingLicenceGbAdapter.evaluate({
      age: 18,
      residency: true,
      game_species: "Grouse",
    });
    expect(result.eligibility).toBe("eligible");
  });

  it("returns eligible for age 40", async () => {
    const result = await huntingLicenceGbAdapter.evaluate({
      age: 40,
      residency: true,
      game_species: "Deer",
    });
    expect(result.eligibility).toBe("eligible");
  });
});

// ── evaluate: suggested_chips ─────────────────────────────────────────────────

describe("huntingLicenceGbAdapter.evaluate — suggested_chips", () => {
  it("eligible result includes Find hunting zones chip", async () => {
    const result = await huntingLicenceGbAdapter.evaluate({
      age: 25,
      residency: true,
      game_species: "Deer",
    });
    expect(result.suggested_chips).toBeDefined();
    expect(result.suggested_chips!.length).toBeGreaterThan(0);
    expect(result.suggested_chips![0].label).toBe("Find hunting zones near me");
  });

  it("chip action is fetch_domain", async () => {
    const result = await huntingLicenceGbAdapter.evaluate({
      age: 25,
      residency: true,
      game_species: "Deer",
    });
    expect(result.suggested_chips![0].action).toBe("fetch_domain");
    expect(
      (result.suggested_chips![0].args as Record<string, unknown>).domain,
    ).toBe("hunting-zones-gb");
  });

  it("ineligible result has no suggested_chips", async () => {
    const result = await huntingLicenceGbAdapter.evaluate({
      age: 10,
      residency: true,
      game_species: "Deer",
    });
    expect(result.suggested_chips ?? []).toHaveLength(0);
  });
});

// ── evaluate: species-specific conditions ─────────────────────────────────────

describe("huntingLicenceGbAdapter.evaluate — species conditions", () => {
  it("Deer result mentions DSC Level 1", async () => {
    const result = await huntingLicenceGbAdapter.evaluate({
      age: 30,
      residency: true,
      game_species: "Deer",
    });
    const all = result.conditions.join(" ");
    expect(all).toContain("DSC Level 1");
  });

  it("Grouse result mentions season dates", async () => {
    const result = await huntingLicenceGbAdapter.evaluate({
      age: 30,
      residency: true,
      game_species: "Grouse",
    });
    const all = result.conditions.join(" ");
    expect(all).toContain("12 Aug");
  });

  it("Duck result mentions non-toxic shot", async () => {
    const result = await huntingLicenceGbAdapter.evaluate({
      age: 30,
      residency: true,
      game_species: "Duck",
    });
    const all = result.conditions.join(" ");
    expect(all).toContain("non-toxic");
  });
});

// ── evaluate: residency condition ─────────────────────────────────────────────

describe("huntingLicenceGbAdapter.evaluate — residency", () => {
  it("non-resident eligible result mentions visitor permit", async () => {
    const result = await huntingLicenceGbAdapter.evaluate({
      age: 30,
      residency: false,
      game_species: "Pheasant",
    });
    expect(result.eligibility).toBe("eligible");
    const all = result.conditions.join(" ");
    expect(all).toContain("Non-residents");
  });
});

// ── registry resolution ───────────────────────────────────────────────────────

describe("getRegulatoryAdapter — hunting licence", () => {
  beforeEach(() => {
    clearRegulatoryRegistry();
    registerRegulatoryAdapter(huntingLicenceGbAdapter);
  });

  it("resolves for 'hunting licence eligibility' intent", () => {
    const adapter = getRegulatoryAdapter("hunting licence eligibility", "GB");
    expect(adapter).toBeDefined();
    expect(adapter!.name).toBe("hunting-licence-gb");
  });

  it("resolves for 'deer stalking' intent", () => {
    const adapter = getRegulatoryAdapter("deer stalking permit", "GB");
    expect(adapter).toBeDefined();
  });

  it("does not resolve for non-GB country", () => {
    const adapter = getRegulatoryAdapter("hunting licence eligibility", "US");
    expect(adapter).toBeUndefined();
  });
});
