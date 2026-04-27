/**
 * domain-relationships.test.ts — Phase C.5
 *
 * Validates the shape and coverage of the seed DomainRelationship entries.
 * Entries cover the six user stories: house move, Friday night, planning
 * objection, pub landlord, school run, food entrepreneur.
 */

import { describe, it, expect } from "vitest";
import { DOMAIN_RELATIONSHIPS } from "../domain-relationships";

describe("DOMAIN_RELATIONSHIPS seed data", () => {
  it("contains at least 5 entries", () => {
    expect(DOMAIN_RELATIONSHIPS.length).toBeGreaterThanOrEqual(5);
  });

  it("every entry has valid weight (0 < weight ≤ 1)", () => {
    for (const rel of DOMAIN_RELATIONSHIPS) {
      expect(rel.weight).toBeGreaterThan(0);
      expect(rel.weight).toBeLessThanOrEqual(1);
    }
  });

  it("every entry has a non-empty fromDomain and toDomain", () => {
    for (const rel of DOMAIN_RELATIONSHIPS) {
      expect(rel.fromDomain.length).toBeGreaterThan(0);
      expect(rel.toDomain.length).toBeGreaterThan(0);
    }
  });

  it("every relationshipType is one of the allowed values", () => {
    const allowed = new Set(["complements", "extends", "supercedes", "conflicts"]);
    for (const rel of DOMAIN_RELATIONSHIPS) {
      expect(allowed.has(rel.relationshipType)).toBe(true);
    }
  });

  it("no duplicate (fromDomain, toDomain) pairs", () => {
    const seen = new Set<string>();
    for (const rel of DOMAIN_RELATIONSHIPS) {
      const key = `${rel.fromDomain}→${rel.toDomain}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });

  it("includes cinemas-gb → food-hygiene-gb relationship (Story 2)", () => {
    const rel = DOMAIN_RELATIONSHIPS.find(
      (r) => r.fromDomain === "cinemas-gb" && r.toDomain === "food-hygiene-gb",
    );
    expect(rel).toBeDefined();
    expect(rel!.weight).toBeGreaterThanOrEqual(0.7);
  });

  it("includes cinemas-gb → weather relationship (Story 2)", () => {
    const rel = DOMAIN_RELATIONSHIPS.find(
      (r) => r.fromDomain === "cinemas-gb" && r.toDomain === "weather",
    );
    expect(rel).toBeDefined();
  });

  it("includes flood-risk-gb → weather relationship (Stories 1, 3, 4)", () => {
    const rel = DOMAIN_RELATIONSHIPS.find(
      (r) => r.fromDomain === "flood-risk-gb" && r.toDomain === "weather",
    );
    expect(rel).toBeDefined();
    expect(rel!.weight).toBeGreaterThanOrEqual(0.7);
  });
});
