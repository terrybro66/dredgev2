/**
 * domain-relationships.test.ts — Phase C.5
 *
 * Validates the shape and coverage of the five seed DomainRelationship entries.
 */

import { describe, it, expect } from "vitest";
import { DOMAIN_RELATIONSHIPS } from "../domain-relationships";

describe("DOMAIN_RELATIONSHIPS seed data", () => {
  it("contains exactly 7 entries", () => {
    expect(DOMAIN_RELATIONSHIPS).toHaveLength(7);
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

  it("includes the flood-risk → transport relationship", () => {
    const rel = DOMAIN_RELATIONSHIPS.find(
      (r) => r.fromDomain === "flood-risk" && r.toDomain === "transport",
    );
    expect(rel).toBeDefined();
    expect(rel!.weight).toBeGreaterThanOrEqual(0.8);
  });

  it("includes the cinema-listings → transport relationship", () => {
    const rel = DOMAIN_RELATIONSHIPS.find(
      (r) => r.fromDomain === "cinema-listings" && r.toDomain === "transport",
    );
    expect(rel).toBeDefined();
  });
});
