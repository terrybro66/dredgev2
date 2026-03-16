import { describe, it, expect, afterAll } from "vitest";
import Redis from "ioredis";
import { createRateLimiter } from "../rateLimiter";
import { createAvailabilityCache } from "../availability";

describe("integration: Redis-backed rate limiter", () => {
  it("state is shared across two instances", async () => {
    const key = `shared-key-${Date.now()}`;
    const limiterA = createRateLimiter({
      points: 1,
      duration: 60,
      keyPrefix: "integration-rl-2",
    });
    const limiterB = createRateLimiter({
      points: 1,
      duration: 60,
      keyPrefix: "integration-rl-2",
    });
    await limiterA.consume(key);
    await expect(limiterB.consume(key)).rejects.toBeDefined();
  });
});

describe("integration: Redis-backed availability cache", () => {
  it("cache survives a simulated restart", async () => {
    const cacheA = createAvailabilityCache();
    await cacheA.set("restart-test", ["2024-01", "2024-02"]);

    // simulate restart — create a fresh instance
    const cacheB = createAvailabilityCache();
    const result = await cacheB.get("restart-test");
    expect(result).toEqual(["2024-01", "2024-02"]);
  });
});

describe("integration: graceful degradation", () => {
  it("rate limiter works when Redis is down", async () => {
    const badClient = new Redis("redis://localhost:19999", {
      maxRetriesPerRequest: 0,
      connectTimeout: 500,
      lazyConnect: true,
    });

    const limiter = createRateLimiter({ points: 10, duration: 60 }, badClient);
    await expect(limiter.consume("degraded-key")).resolves.not.toThrow();
    await badClient.quit();
  });

  it("availability cache works when Redis is down", async () => {
    const badClient = new Redis("redis://localhost:19999", {
      maxRetriesPerRequest: 0,
      connectTimeout: 500,
      lazyConnect: true,
    });

    const cache = createAvailabilityCache(badClient);
    await cache.set("degraded-source", ["2024-01"]);
    const result = await cache.get("degraded-source");
    expect(result).toEqual(["2024-01"]);
    await badClient.quit();
  });
});

afterAll(async () => {
  const { getRedisClient } = await import("../redis");
  await getRedisClient().quit();
});
