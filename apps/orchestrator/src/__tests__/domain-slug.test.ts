/**
 * domain-slug.test.ts — Phase C
 *
 * Tests for normalizeToDomainSlug() and the CATEGORY_TO_INTENT map.
 * These cover the domain-match guard logic that gates Tier 2 refinement.
 *
 * Roadmap scenarios (from roadmap-v2.md Phase C):
 *   1. Same-domain category shift:  crime → vehicle crime  → refinement applies
 *   2. Same-domain location shift:  crime/Manchester → crime/Leeds → refinement applies
 *   3. Cross-domain query:          crime → weather → NO refinement, active_plan cleared
 *   4. Location shift with date:    crime/Manchester → crime/Leeds last month → both updated
 *   5. Regression:                  flood risk after crime → fresh query, no date corruption
 */

import { describe, it, expect } from "vitest";
import { normalizeToDomainSlug, CATEGORY_TO_INTENT } from "../domain-slug";

// ── normalizeToDomainSlug ─────────────────────────────────────────────────────

describe("normalizeToDomainSlug", () => {
  it("returns canonical slug when intent is already canonical", () => {
    expect(normalizeToDomainSlug("crime", "crime")).toBe("crime");
    expect(normalizeToDomainSlug("weather", "weather")).toBe("weather");
    expect(normalizeToDomainSlug("flood risk", "flood risk")).toBe("flood risk");
  });

  it("normalises crime subcategory intent via CATEGORY_TO_INTENT", () => {
    // intent already maps cleanly
    expect(normalizeToDomainSlug("crime", "burglary")).toBe("crime");
  });

  it("normalises crime category when intent is undefined", () => {
    expect(normalizeToDomainSlug(undefined, "burglary")).toBe("crime");
    expect(normalizeToDomainSlug(undefined, "vehicle-crime")).toBe("crime");
    expect(normalizeToDomainSlug(undefined, "crime statistics")).toBe("crime");
    expect(normalizeToDomainSlug(undefined, "all-crime")).toBe("crime");
  });

  it("normalises weather variants", () => {
    expect(normalizeToDomainSlug(undefined, "weather forecast")).toBe("weather");
    expect(normalizeToDomainSlug(undefined, "temperature")).toBe("weather");
    expect(normalizeToDomainSlug(undefined, "precipitation")).toBe("weather");
  });

  it("normalises flood risk variants", () => {
    expect(normalizeToDomainSlug(undefined, "flooding")).toBe("flood risk");
    expect(normalizeToDomainSlug(undefined, "flood warnings")).toBe("flood risk");
  });

  it("normalises food hygiene variants", () => {
    expect(normalizeToDomainSlug(undefined, "restaurants")).toBe("food hygiene");
    expect(normalizeToDomainSlug(undefined, "food hygiene ratings")).toBe("food hygiene");
  });

  it("returns the intent as-is when unknown and not in map", () => {
    expect(normalizeToDomainSlug("transport", "transport")).toBe("transport");
  });

  it("returns the category as-is when both intent is undefined and category is unknown", () => {
    expect(normalizeToDomainSlug(undefined, "something-new")).toBe("something-new");
  });

  it("prefers intent over category when both are present and intent is in map", () => {
    // intent = "crime" (canonical), category = "burglary" (raw LLM)
    // Both resolve to "crime" — consistent result either way
    expect(normalizeToDomainSlug("crime", "burglary")).toBe("crime");
  });

  it("skips unknown intent and falls through to category", () => {
    expect(normalizeToDomainSlug("unknown", "burglary")).toBe("crime");
  });
});

// ── Domain-match guard scenarios ──────────────────────────────────────────────
//
// These tests verify the guard conditions directly:
//   incomingSlug === activeSlug  → refinement allowed
//   incomingSlug !== activeSlug  → refinement blocked

describe("domain-match guard — same domain (refinement allowed)", () => {
  it("scenario 1: same-domain category shift — crime → vehicle crime", () => {
    // "show me just vehicle crime" after active plan with category "crime"
    const incomingSlug = normalizeToDomainSlug("crime", "vehicle-crime");
    const activeSlug = normalizeToDomainSlug(undefined, "crime");
    expect(incomingSlug).toBe(activeSlug); // both "crime" → refinement fires
  });

  it("scenario 2: same-domain location shift — crime Manchester → crime Leeds", () => {
    const incomingSlug = normalizeToDomainSlug("crime", "crime");
    const activeSlug = normalizeToDomainSlug(undefined, "crime");
    expect(incomingSlug).toBe(activeSlug);
  });

  it("scenario 4: same-domain with date — crime Manchester → crime Leeds last month", () => {
    // Intent and category both resolve to "crime" regardless of new date text
    const incomingSlug = normalizeToDomainSlug("crime", "crime statistics");
    const activeSlug = normalizeToDomainSlug(undefined, "all-crime");
    expect(incomingSlug).toBe(activeSlug); // both "crime"
  });
});

describe("domain-match guard — cross domain (refinement blocked)", () => {
  it("scenario 3: crime → weather — refinement must NOT apply", () => {
    const incomingSlug = normalizeToDomainSlug("weather", "weather forecast");
    const activeSlug = normalizeToDomainSlug(undefined, "crime");
    expect(incomingSlug).not.toBe(activeSlug); // "weather" ≠ "crime"
  });

  it("scenario 5: regression — flood risk after crime — no date corruption", () => {
    // "flood risk in York" after "crime in Manchester"
    const incomingSlug = normalizeToDomainSlug("flood risk", "flood risk");
    const activeSlug = normalizeToDomainSlug(undefined, "crime");
    expect(incomingSlug).not.toBe(activeSlug); // "flood risk" ≠ "crime"
  });

  it("crime → food hygiene is cross-domain", () => {
    const incomingSlug = normalizeToDomainSlug("food hygiene", "restaurants");
    const activeSlug = normalizeToDomainSlug(undefined, "burglary");
    expect(incomingSlug).not.toBe(activeSlug);
  });

  it("weather → flood risk is cross-domain", () => {
    const incomingSlug = normalizeToDomainSlug("flood risk", "flooding");
    const activeSlug = normalizeToDomainSlug(undefined, "weather forecast");
    expect(incomingSlug).not.toBe(activeSlug);
  });
});

// ── CATEGORY_TO_INTENT completeness ──────────────────────────────────────────

describe("CATEGORY_TO_INTENT", () => {
  it("maps all crime subcategories to 'crime'", () => {
    const crimeSubcats = [
      "burglary", "all-crime", "drugs", "robbery", "violent-crime",
      "bicycle-theft", "anti-social-behaviour", "vehicle-crime",
      "shoplifting", "criminal-damage-arson", "other-theft",
      "possession-of-weapons", "public-order", "theft-from-the-person",
      "other-crime", "crime statistics",
    ];
    for (const cat of crimeSubcats) {
      expect(CATEGORY_TO_INTENT[cat]).toBe("crime");
    }
  });

  it("maps flood variants to 'flood risk'", () => {
    expect(CATEGORY_TO_INTENT["flooding"]).toBe("flood risk");
    expect(CATEGORY_TO_INTENT["flood warnings"]).toBe("flood risk");
    expect(CATEGORY_TO_INTENT["flood alerts"]).toBe("flood risk");
  });
});
