import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Track query ids created per test so teardown can delete precisely.
const createdQueryIds: string[] = [];

// Creates a minimal Query row so QueryJob's relation constraint is satisfied.
// Returns the created query id.
async function createTestQuery(): Promise<string> {
  const query = await prisma.query.create({
    data: {
      text: "__test__ bicycle theft in Cambridge",
      category: "bicycle-theft",
      date_from: "2024-01",
      date_to: "2024-01",
      poly: "52.0,0.0:52.1,0.1:52.2,0.0",
      viz_hint: "map",
      domain: "crime-uk",
      country_code: "GB",
      resolved_location: "Cambridge, Cambridgeshire, England",
    },
  });
  createdQueryIds.push(query.id);
  return query.id;
}

// Builds the minimal set of fields required to create a QueryJob.
function minimalJobData(queryId: string) {
  return {
    query_id: queryId,
    status: "complete",
    domain: "crime-uk",
    cache_hit: false,
    rows_inserted: 10,
  };
}

// ---------------------------------------------------------------------------
// Teardown — remove test rows after each test to keep the db clean.
// Order matters: child tables before parent tables.
// ---------------------------------------------------------------------------

afterEach(async () => {
  if (createdQueryIds.length > 0) {
    await prisma.queryJob.deleteMany({
      where: { query_id: { in: [...createdQueryIds] } },
    });
    await prisma.query.deleteMany({
      where: { id: { in: [...createdQueryIds] } },
    });
    createdQueryIds.length = 0;
  }
  await prisma.apiAvailability.deleteMany({
    where: { source: { startsWith: "__test__" } },
  });
});
import { beforeAll } from "vitest";

// Purge any stale __test__ rows left by interrupted previous runs.
beforeAll(async () => {
  await prisma.apiAvailability.deleteMany({
    where: { source: { startsWith: "__test__" } },
  });
});

// ---------------------------------------------------------------------------
// ApiAvailability model
// ---------------------------------------------------------------------------

describe("ApiAvailability model", () => {
  it("can insert a row with a unique source and an array of month strings", async () => {
    const record = await prisma.apiAvailability.create({
      data: {
        source: "__test__police-uk",
        months: ["2025-10", "2025-09"],
      },
    });

    expect(record.id).toBeTruthy();
    expect(record.source).toBe("__test__police-uk");
    expect(record.months).toEqual(["2025-10", "2025-09"]);
  });

  it("inserting a second row with the same source throws a unique constraint error", async () => {
    await prisma.apiAvailability.create({
      data: { source: "__test__unique-source", months: [] },
    });

    await expect(
      prisma.apiAvailability.create({
        data: { source: "__test__unique-source", months: [] },
      }),
    ).rejects.toThrow();
  });

  it("fetchedAt defaults to now() without being explicitly set", async () => {
    const before = new Date();

    const record = await prisma.apiAvailability.create({
      data: { source: "__test__default-time", months: [] },
    });

    const after = new Date();

    expect(record.fetchedAt).toBeInstanceOf(Date);
    expect(record.fetchedAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(record.fetchedAt.getTime()).toBeLessThanOrEqual(after.getTime());
  });

  it("months array can be empty", async () => {
    const record = await prisma.apiAvailability.create({
      data: { source: "__test__empty-months", months: [] },
    });

    expect(record.months).toEqual([]);
  });

  it("months array with 12 entries round-trips correctly", async () => {
    const twelveMonths = [
      "2025-01",
      "2025-02",
      "2025-03",
      "2025-04",
      "2025-05",
      "2025-06",
      "2025-07",
      "2025-08",
      "2025-09",
      "2025-10",
      "2025-11",
      "2025-12",
    ];

    const record = await prisma.apiAvailability.create({
      data: { source: "__test__twelve-months", months: twelveMonths },
    });

    expect(record.months).toHaveLength(12);
    expect(record.months).toEqual(twelveMonths);
  });
});

// ---------------------------------------------------------------------------
// QueryJob — new fallback fields
// ---------------------------------------------------------------------------

describe("QueryJob — fallback_applied and fallback_success fields", () => {
  it("creating a QueryJob without fallback_applied or fallback_success succeeds (fields are nullable)", async () => {
    const queryId = await createTestQuery();

    const job = await prisma.queryJob.create({
      data: minimalJobData(queryId),
    });

    expect(job.id).toBeTruthy();
    expect(job.fallback_applied).toBeNull();
    expect(job.fallback_success).toBeNull();
  });

  it("updating a QueryJob to set fallback_applied and fallback_success persists correctly", async () => {
    const queryId = await createTestQuery();

    const job = await prisma.queryJob.create({
      data: minimalJobData(queryId),
    });

    const updated = await prisma.queryJob.update({
      where: { id: job.id },
      data: { fallback_applied: "date", fallback_success: true },
    });

    expect(updated.fallback_applied).toBe("date");
    expect(updated.fallback_success).toBe(true);
  });

  it("fallback_applied can be set back to null after being set", async () => {
    const queryId = await createTestQuery();

    const job = await prisma.queryJob.create({
      data: {
        ...minimalJobData(queryId),
        fallback_applied: "radius",
        fallback_success: false,
      },
    });

    const cleared = await prisma.queryJob.update({
      where: { id: job.id },
      data: { fallback_applied: null },
    });

    expect(cleared.fallback_applied).toBeNull();
  });

  it("querying where fallback_applied IS NOT NULL returns only rows that had a fallback", async () => {
    const queryId = await createTestQuery();

    // One job with a fallback, one without
    await prisma.queryJob.create({
      data: {
        ...minimalJobData(queryId),
        fallback_applied: "category",
        fallback_success: true,
      },
    });
    await prisma.queryJob.create({
      data: minimalJobData(queryId),
    });

    const withFallback = await prisma.queryJob.findMany({
      where: {
        query_id: queryId,
        fallback_applied: { not: null },
      },
    });

    expect(withFallback).toHaveLength(1);
    expect(withFallback[0].fallback_applied).toBe("category");
  });
});
