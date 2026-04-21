/**
 * Source scoring — scoreSource utility
 *
 * Tests cover the confidence delta calculations in scoreSource().
 * The GenericAdapter integration suites that tested DB-backed source
 * scoring have been removed along with createGenericAdapter itself.
 *
 * Run:
 *   pnpm vitest run src/__tests__/source-scoring.test.ts --reporter=verbose
 */

import { describe, it, expect } from "vitest";

// ── scoreSource utility ───────────────────────────────────────────────────────

describe("scoreSource — confidence delta calculations", () => {
  it("successful fetch with rows increases confidence", async () => {
    const { scoreSource } = await import("../enrichment/source-scoring");

    const result = scoreSource({
      current: 0.7,
      success: true,
      rowCount: 10,
    });

    expect(result).toBeGreaterThan(0.7);
  });

  it("failed fetch decreases confidence", async () => {
    const { scoreSource } = await import("../enrichment/source-scoring");

    const result = scoreSource({
      current: 0.7,
      success: false,
      rowCount: 0,
    });

    expect(result).toBeLessThan(0.7);
  });

  it("successful fetch with zero rows does not boost confidence", async () => {
    const { scoreSource } = await import("../enrichment/source-scoring");

    const successScore = scoreSource({
      current: 0.7,
      success: true,
      rowCount: 0,
    });

    const failScore = scoreSource({
      current: 0.7,
      success: false,
      rowCount: 0,
    });

    // Zero-row success should not boost — should be same or lower than current
    expect(successScore).toBeLessThanOrEqual(0.7);
    // But should not penalise as hard as a failure
    expect(successScore).toBeGreaterThanOrEqual(failScore);
  });

  it("confidence never drops below 0.0", async () => {
    const { scoreSource } = await import("../enrichment/source-scoring");

    const result = scoreSource({
      current: 0.05,
      success: false,
      rowCount: 0,
    });

    expect(result).toBeGreaterThanOrEqual(0.0);
  });

  it("confidence never exceeds 1.0", async () => {
    const { scoreSource } = await import("../enrichment/source-scoring");

    const result = scoreSource({
      current: 0.98,
      success: true,
      rowCount: 100,
    });

    expect(result).toBeLessThanOrEqual(1.0);
  });

  it("returns a number between 0 and 1 inclusive", async () => {
    const { scoreSource } = await import("../enrichment/source-scoring");

    for (const current of [0.0, 0.25, 0.5, 0.75, 1.0]) {
      for (const success of [true, false]) {
        const result = scoreSource({
          current,
          success,
          rowCount: success ? 5 : 0,
        });
        expect(result).toBeGreaterThanOrEqual(0.0);
        expect(result).toBeLessThanOrEqual(1.0);
      }
    }
  });
});
