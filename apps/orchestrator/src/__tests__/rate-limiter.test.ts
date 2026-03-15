import { describe, it, expect, beforeEach } from "vitest";
import { acquire, createRateLimiter } from "../rateLimiter";
import { getRedisClient } from "../redis";

describe("Redis-backed rate limiter", () => {
  it("consume() succeeds when under the limit", async () => {
    const limiter = createRateLimiter({ points: 10, duration: 60 });
    await expect(limiter.consume("test-key")).resolves.not.toThrow();
  });

  it("consume() throws when limit is exceeded", async () => {
    const limiter = createRateLimiter({ points: 2, duration: 60 });
    await limiter.consume("burst-key");
    await limiter.consume("burst-key");
    await expect(limiter.consume("burst-key")).rejects.toThrow();
  });

  it("two instances share state via Redis", async () => {
    const limiterA = createRateLimiter({
      points: 1,
      duration: 60,
      keyPrefix: "shared-test",
    });
    const limiterB = createRateLimiter({
      points: 1,
      duration: 60,
      keyPrefix: "shared-test",
    });
    await limiterA.consume("shared-key");
    await expect(limiterB.consume("shared-key")).rejects.toThrow();
  });

  it("falls back to in-memory when Redis client is not connected", async () => {
    const Redis = (await import("ioredis")).default;
    const badClient = new Redis("redis://localhost:19999", {
      maxRetriesPerRequest: 0,
      connectTimeout: 500,
      lazyConnect: true,
    });
    const limiter = createRateLimiter({ points: 10, duration: 60 }, badClient);
    await expect(limiter.consume("fallback-key")).resolves.not.toThrow();
    await badClient.quit();
  });
});
