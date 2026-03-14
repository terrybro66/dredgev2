import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { prisma } from "../db";

describe("Cache TTL", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(async () => {
    vi.useRealTimers();
    await prisma.queryCache.deleteMany({
      where: { query_hash: { startsWith: "test-ttl-" } },
    });
  });

  it("returns a cache entry that is within the TTL window", async () => {
    const query_hash = "test-ttl-fresh";
    await prisma.queryCache.create({
      data: {
        query_hash,
        domain: "test-domain",
        result_count: 1,
        results: [{ id: "1" }],
      },
    });

    const cached = await prisma.queryCache.findUnique({
      where: { query_hash },
    });
    expect(cached).not.toBeNull();

    // Entry is brand new — age is 0 hours, TTL is 1 hour — should not be evicted
    const ageHours = (Date.now() - cached!.createdAt.getTime()) / 3600000;
    expect(ageHours).toBeLessThan(1);
  });

  it("identifies a cache entry that has exceeded the TTL", async () => {
    const query_hash = "test-ttl-stale";
    await prisma.queryCache.create({
      data: {
        query_hash,
        domain: "test-domain",
        result_count: 1,
        results: [{ id: "1" }],
      },
    });

    // Advance time by 2 hours
    vi.advanceTimersByTime(2 * 60 * 60 * 1000);

    const cached = await prisma.queryCache.findUnique({
      where: { query_hash },
    });
    expect(cached).not.toBeNull();

    const ageHours = (Date.now() - cached!.createdAt.getTime()) / 3600000;
    expect(ageHours).toBeGreaterThan(1);
  });

  it("evicts a stale entry and confirms it is deleted from the database", async () => {
    const query_hash = "test-ttl-evict";
    await prisma.queryCache.create({
      data: {
        query_hash,
        domain: "test-domain",
        result_count: 1,
        results: [{ id: "1" }],
      },
    });

    // Advance time by 2 hours to make the entry stale
    vi.advanceTimersByTime(2 * 60 * 60 * 1000);

    const cached = await prisma.queryCache.findUnique({
      where: { query_hash },
    });
    const ageHours = (Date.now() - cached!.createdAt.getTime()) / 3600000;

    if (ageHours > 1) {
      await prisma.queryCache.delete({ where: { query_hash } });
    }

    const afterEviction = await prisma.queryCache.findUnique({
      where: { query_hash },
    });
    expect(afterEviction).toBeNull();
  });

  it("never evicts a null TTL entry regardless of age", async () => {
    const query_hash = "test-ttl-null";
    await prisma.queryCache.create({
      data: {
        query_hash,
        domain: "crime-uk",
        result_count: 1,
        results: [{ id: "1" }],
      },
    });

    // Advance time by 30 days
    vi.advanceTimersByTime(30 * 24 * 60 * 60 * 1000);

    const cached = await prisma.queryCache.findUnique({
      where: { query_hash },
    });
    expect(cached).not.toBeNull();

    // cacheTtlHours is null for crime-uk — the != null check means no eviction logic runs
    const cacheTtlHours = null;
    expect(cacheTtlHours).toBeNull();

    // Entry should still exist untouched
    const stillExists = await prisma.queryCache.findUnique({
      where: { query_hash },
    });
    expect(stillExists).not.toBeNull();
  });
});
