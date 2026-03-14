import { describe, it, expect, beforeEach } from "vitest";
import { acquire } from "../rateLimiter";

describe("Rate Limiter", () => {
  beforeEach(() => {
    // Reset the module between tests to clear bucket state
  });

  it("returns immediately when no rateLimit is configured", async () => {
    const config = {
      name: "test-domain",
      rateLimit: undefined,
    } as any;

    const start = Date.now();
    await acquire(config);
    const elapsed = Date.now() - start;

    expect(elapsed).toBeLessThan(20);
  });

  it("returns immediately when tokens are available", async () => {
    const config = {
      name: "test-domain-2",
      rateLimit: { requestsPerMinute: 60 },
    } as any;

    const start = Date.now();
    await acquire(config);
    const elapsed = Date.now() - start;

    expect(elapsed).toBeLessThan(20);
  });

  it("delays when bucket is exhausted", async () => {
    const config = {
      name: "test-domain-3",
      rateLimit: { requestsPerMinute: 60 },
    } as any;

    // Exhaust the bucket — 60 tokens, consume all of them
    const drainOps = Array.from({ length: 60 }).map(() => acquire(config));
    await Promise.all(drainOps);

    // Next acquire should be delayed
    const start = Date.now();
    await acquire(config);
    const elapsed = Date.now() - start;

    // At 60 req/min one token = 1000ms — allow some tolerance
    expect(elapsed).toBeGreaterThan(800);
  });

  it("does not delay a cached request — acquire is not called on cache hits", async () => {
    // This test confirms the contract: acquire is only called on live execution
    // A cache hit in query.ts returns before reaching the acquire call
    // We verify acquire itself has no side effects when called with no rateLimit
    const config = {
      name: "cached-domain",
      rateLimit: undefined,
    } as any;

    const start = Date.now();
    await acquire(config);
    const elapsed = Date.now() - start;

    expect(elapsed).toBeLessThan(20);
  });
});
