import { describe, it, expect, afterAll } from "vitest";
import { getRedisClient, checkRedisHealth } from "../redis";

describe("getRedisClient", () => {
  it("returns a connected client when REDIS_URL is valid", async () => {
    const client = getRedisClient();
    // give it a moment to connect
    await new Promise((r) => setTimeout(r, 100));
    expect(client.status).toBe("ready");
  });

  it("returns the same instance on repeated calls (singleton)", () => {
    const a = getRedisClient();
    const b = getRedisClient();
    expect(a).toBe(b);
  });
});

describe("checkRedisHealth", () => {
  it("returns true when Redis is reachable", async () => {
    const result = await checkRedisHealth();
    expect(result).toBe(true);
  });

  it("returns false when Redis is unreachable — does not throw", async () => {
    const Redis = (await import("ioredis")).default;
    const badClient = new Redis("redis://localhost:19999", {
      maxRetriesPerRequest: 0,
      connectTimeout: 500,
      lazyConnect: true,
    });
    const result = await checkRedisHealth(badClient);
    expect(result).toBe(false);
    await badClient.quit();
  });
});

afterAll(async () => {
  const client = getRedisClient();
  await client.quit();
});
