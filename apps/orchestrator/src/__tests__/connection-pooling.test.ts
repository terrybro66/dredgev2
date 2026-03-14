import { describe, it, expect, afterAll } from "vitest";
import { prisma } from "../db";

async function getConnectionCount() {
  const result = await prisma.$queryRaw<{ count: number }[]>`
    SELECT count(*)::int as count
    FROM pg_stat_activity
    WHERE datname = current_database()
      AND application_name LIKE '%prisma%'
  `;
  return result[0].count;
}

describe("Prisma Connection Pooling", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("handles concurrent queries without failures", async () => {
    const concurrentQueries = 20;

    const operations = [...Array(concurrentQueries)].map(
      () => prisma.$queryRaw`SELECT 1`,
    );

    const results = await Promise.allSettled(operations);

    const failures = results.filter((r) => r.status === "rejected");

    expect(failures.length).toBe(0);
  });

  it("keeps connection count bounded during load", async () => {
    const concurrentQueries = 15;

    const operations = [...Array(concurrentQueries)].map(
      () => prisma.$queryRaw`SELECT 1`,
    );

    let peakConnections = 0;

    const monitor = (async () => {
      for (let i = 0; i < 10; i++) {
        const count = await getConnectionCount();
        peakConnections = Math.max(peakConnections, count);
        await new Promise((r) => setTimeout(r, 50));
      }
    })();

    await Promise.all([Promise.all(operations), monitor]);

    // Default Prisma pool is ~10; allow a small buffer
    expect(peakConnections).toBeLessThanOrEqual(15);
  });
});
