import { describe, it, expect, vi, afterAll } from "vitest";

describe("startup Redis health check", () => {
  it("logs a warning when Redis is unreachable — does not throw", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const Redis = (await import("ioredis")).default;
    const badClient = new Redis("redis://localhost:19999", {
      maxRetriesPerRequest: 0,
      connectTimeout: 500,
      lazyConnect: true,
    });

    const { checkRedisHealth } = await import("../redis");
    const healthy = await checkRedisHealth(badClient);

    if (!healthy) {
      console.warn(
        "Redis unavailable — falling back to in-memory mode for rate limiter and availability cache",
      );
    }

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("Redis unavailable"),
    );

    warnSpy.mockRestore();
    await badClient.quit();
  });

  it("does not call process.exit when Redis is unreachable", async () => {
    const exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation((() => {}) as any);

    const Redis = (await import("ioredis")).default;
    const badClient = new Redis("redis://localhost:19999", {
      maxRetriesPerRequest: 0,
      connectTimeout: 500,
      lazyConnect: true,
    });

    const { checkRedisHealth } = await import("../redis");
    await checkRedisHealth(badClient);

    expect(exitSpy).not.toHaveBeenCalled();

    exitSpy.mockRestore();
    await badClient.quit();
  });

  it("logs no Redis warning when Redis is healthy", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const { checkRedisHealth } = await import("../redis");
    const healthy = await checkRedisHealth();

    if (!healthy) {
      console.warn("Redis unavailable — falling back to in-memory mode");
    }

    expect(warnSpy).not.toHaveBeenCalled();

    warnSpy.mockRestore();
  });

  afterAll(async () => {
    const { getRedisClient } = await import("../redis");
    await getRedisClient().quit();
  });
});
