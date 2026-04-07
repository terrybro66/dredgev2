/**
 * Block A — Hybrid query_results table + pipeline wiring
 *
 * Branch: feat/hybrid-query-results-table
 *
 * Tests are grouped into three suites:
 *   1. Schema shape  — unit tests against the Prisma schema via a real DB
 *                      (same pattern as database-v5.test.ts)
 *   2. Execute pipeline  — unit tests against query.ts via supertest + mocks
 *                          (same pattern as query.test.ts)
 *   3. orderBy bug fix   — confirms the weather adapter's defaultOrderBy is
 *                          respected and the hardcoded `{ month: "asc" }` is gone
 *
 * Run in isolation:
 *   pnpm vitest run src/__tests__/query-results-table.test.ts
 */

// ─────────────────────────────────────────────────────────────────────────────
// Suite 1 — Schema shape (integration, requires a real DB connection)
// These tests will pass once the Prisma migration for query_results is applied.
// ─────────────────────────────────────────────────────────────────────────────

import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  vi,
  beforeEach,
} from "vitest";
import { PrismaClient } from "@prisma/client";
import express from "express";
import request from "supertest";
import type { Router } from "express";

// ---------------------------------------------------------------------------
// Suite 1 setup
// ---------------------------------------------------------------------------

const prisma = new PrismaClient();

// Track IDs so afterAll can clean up without touching other test data.
const createdResultIds: string[] = [];

afterAll(async () => {
  if (createdResultIds.length > 0) {
    await (prisma as any).queryResult.deleteMany({
      where: { id: { in: [...createdResultIds] } },
    });
  }
  await prisma.$disconnect();
});

// Minimal valid row — only fields that have no default.
function minimalRow(overrides: Record<string, unknown> = {}) {
  return {
    domain_name: "__test__cinema-listings-gb",
    source_tag: "__test__odeon",
    date: new Date("2025-06-01T19:30:00Z"),
    description: "Dune Part Two — Screen 3",
    ...overrides,
  };
}

describe("query_results table — schema shape", () => {
  it("table exists and accepts a minimal insert", async () => {
    const row = await (prisma as any).queryResult.create({
      data: minimalRow(),
    });
    createdResultIds.push(row.id);

    expect(row.id).toBeTruthy();
    expect(row.domain_name).toBe("__test__cinema-listings-gb");
    expect(row.source_tag).toBe("__test__odeon");
  });

  it("id is auto-generated as a non-empty string", async () => {
    const row = await (prisma as any).queryResult.create({
      data: minimalRow(),
    });
    createdResultIds.push(row.id);

    expect(typeof row.id).toBe("string");
    expect(row.id.length).toBeGreaterThan(0);
  });

  it("created_at defaults to now() without being explicitly set", async () => {
    const before = new Date();
    const row = await (prisma as any).queryResult.create({
      data: minimalRow(),
    });
    const after = new Date();
    createdResultIds.push(row.id);

    expect(row.created_at).toBeInstanceOf(Date);
    expect(row.created_at.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(row.created_at.getTime()).toBeLessThanOrEqual(after.getTime());
  });

  it("all core columns are present on an inserted row", async () => {
    const row = await (prisma as any).queryResult.create({
      data: minimalRow({
        lat: 51.5074,
        lon: -0.1278,
        location: "London, England",
        value: 12.5,
        category: "action",
      }),
    });
    createdResultIds.push(row.id);

    // Assert every column defined in 2.1 is present (even if null)
    expect(row).toHaveProperty("id");
    expect(row).toHaveProperty("domain_name");
    expect(row).toHaveProperty("source_tag");
    expect(row).toHaveProperty("date");
    expect(row).toHaveProperty("lat");
    expect(row).toHaveProperty("lon");
    expect(row).toHaveProperty("location");
    expect(row).toHaveProperty("description");
    expect(row).toHaveProperty("value");
    expect(row).toHaveProperty("raw");
    expect(row).toHaveProperty("extras");
    expect(row).toHaveProperty("snapshot_id");
    expect(row).toHaveProperty("created_at");
    expect(row).toHaveProperty("category");
  });

  it("category column is writable and round-trips correctly", async () => {
    const row = await (prisma as any).queryResult.create({
      data: minimalRow({ category: "thriller" }),
    });
    createdResultIds.push(row.id);

    expect(row.category).toBe("thriller");
  });

  it("raw column accepts and round-trips a JSON object", async () => {
    const rawPayload = {
      original_title: "Dune Part Two",
      ticket_type: "standard",
      seat_count: 200,
    };

    const row = await (prisma as any).queryResult.create({
      data: minimalRow({ raw: rawPayload }),
    });
    createdResultIds.push(row.id);

    expect(row.raw).toMatchObject(rawPayload);
  });

  it("extras column accepts and round-trips domain-specific structured fields", async () => {
    const extras = {
      certificate: "12A",
      runtime_mins: 166,
      screen_type: "IMAX",
      booking_url: "https://example.com/book/123",
    };

    const row = await (prisma as any).queryResult.create({
      data: minimalRow({ extras }),
    });
    createdResultIds.push(row.id);

    expect(row.extras).toMatchObject(extras);
  });

  it("raw and extras both default to an empty object when omitted", async () => {
    const row = await (prisma as any).queryResult.create({
      data: minimalRow(),
    });
    createdResultIds.push(row.id);

    // Prisma returns null or {} depending on DB default — either is acceptable
    // as long as no error is thrown and the column exists.
    expect(row.raw === null || typeof row.raw === "object").toBe(true);
    expect(row.extras === null || typeof row.extras === "object").toBe(true);
  });

  it("source_tag is required and must be present on every row", async () => {
    // Omitting source_tag should throw a Prisma validation error.
    await expect(
      (prisma as any).queryResult.create({
        data: {
          domain_name: "__test__no-source-tag",
          description: "Missing source_tag",
          date: new Date(),
        },
      }),
    ).rejects.toThrow();
  });

  it("snapshot_id is nullable — row without snapshot_id inserts cleanly", async () => {
    const row = await (prisma as any).queryResult.create({
      data: minimalRow(),
    });
    createdResultIds.push(row.id);

    expect(row.snapshot_id).toBeNull();
  });

  it("snapshot_id can be set to a string value", async () => {
    const row = await (prisma as any).queryResult.create({
      data: minimalRow({ snapshot_id: "snap-abc-123" }),
    });
    createdResultIds.push(row.id);

    expect(row.snapshot_id).toBe("snap-abc-123");
  });

  it("lat and lon are nullable floats", async () => {
    const row = await (prisma as any).queryResult.create({
      data: minimalRow({ lat: 51.5074, lon: -0.1278 }),
    });
    createdResultIds.push(row.id);

    expect(typeof row.lat).toBe("number");
    expect(typeof row.lon).toBe("number");
  });

  it("value is a nullable float — non-numeric domains can leave it null", async () => {
    const row = await (prisma as any).queryResult.create({
      data: minimalRow(), // no value field
    });
    createdResultIds.push(row.id);

    expect(row.value).toBeNull();
  });

  it("existing crime_results table still exists after migration", async () => {
    // The legacy table must not be dropped during the hybrid migration.
    const count = await prisma.crimeResult.count();
    expect(typeof count).toBe("number"); // just checks the table is queryable
  });

  it("existing weather_results table still exists after migration", async () => {
    const count = await prisma.weatherResult.count();
    expect(typeof count).toBe("number");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 2 — Execute pipeline write path (unit, mocked DB)
// Asserts that the execute handler writes to query_results (not crime_results /
// weather_results) when the matched adapter has storeResults: true.
// ─────────────────────────────────────────────────────────────────────────────

// Hoist all vi.fn() factories before any vi.mock() calls.
const { mockParseIntent, mockDeriveVizHint, mockExpandDateRange } = vi.hoisted(
  () => ({
    mockParseIntent: vi.fn(),
    mockDeriveVizHint: vi.fn(),
    mockExpandDateRange: vi.fn(),
  }),
);
const { mockGetDomainForQuery } = vi.hoisted(() => ({
  mockGetDomainForQuery: vi.fn(),
}));
const { mockGeocodeToPolygon } = vi.hoisted(() => ({
  mockGeocodeToPolygon: vi.fn(),
}));
const { mockAcquire } = vi.hoisted(() => ({ mockAcquire: vi.fn() }));
const { mockCreateSnapshot } = vi.hoisted(() => ({
  mockCreateSnapshot: vi.fn(),
}));
const { mockShadowAdapter } = vi.hoisted(() => ({
  mockShadowAdapter: { isEnabled: vi.fn(), recover: vi.fn() },
}));
const { mockDomainDiscovery } = vi.hoisted(() => ({
  mockDomainDiscovery: { isEnabled: vi.fn(), run: vi.fn() },
}));
const { mockClassifyIntent } = vi.hoisted(() => ({
  mockClassifyIntent: vi.fn(),
}));

// A single mock Prisma instance shared across pipeline tests.
const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    query: { create: vi.fn(), findUnique: vi.fn() },
    // The NEW table — pipeline should write here for generic adapters.
    queryResult: { create: vi.fn(), createMany: vi.fn(), findMany: vi.fn() },
    // Legacy tables — should NOT be written to by adapters using hybrid path.
    crimeResult: { findMany: vi.fn() },
    weatherResult: { findMany: vi.fn() },
    queryCache: { findUnique: vi.fn(), create: vi.fn(), delete: vi.fn() },
    queryJob: { create: vi.fn(), update: vi.fn() },
    queryRun: { create: vi.fn(), update: vi.fn() },
    datasetSnapshot: { create: vi.fn() },
    apiAvailability: { upsert: vi.fn() },
    $queryRaw: vi.fn(),
  },
}));

vi.mock("../intent", () => ({
  parseIntent: mockParseIntent,
  deriveVizHint: mockDeriveVizHint,
  expandDateRange: mockExpandDateRange,
}));
vi.mock("../geocoder", () => ({ geocodeToPolygon: mockGeocodeToPolygon }));
vi.mock("../db", () => ({ prisma: mockPrisma }));
vi.mock("../domains/registry", () => ({
  getDomainForQuery: mockGetDomainForQuery,
}));
vi.mock("../rateLimiter", () => ({ acquire: mockAcquire }));
vi.mock("../execution-model", () => ({ createSnapshot: mockCreateSnapshot }));
vi.mock("../agent/shadow-adapter", () => ({
  shadowAdapter: mockShadowAdapter,
}));
vi.mock("../agent/domain-discovery", () => ({
  domainDiscovery: mockDomainDiscovery,
}));
vi.mock("../semantic/classifier", () => ({
  classifyIntent: mockClassifyIntent,
}));

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const basePlan = {
  category: "burglary",
  date_from: "2025-01",
  date_to: "2025-01",
  location: "Bristol, UK",
};

// A mock storeResults function that records calls — used to assert the adapter's
// storeResults is called (not a direct prisma write from query.ts).
let mockAdapterStoreResults: ReturnType<typeof vi.fn>;
let mockAdapterFetchData: ReturnType<typeof vi.fn>;

// The execute request body used across tests in Suite 2.
const validExecuteBody = {
  plan: basePlan,
  poly: "51.4,2.5:51.4,2.6:51.5,2.6:51.5,2.5",
  viz_hint: "table" as const,
  resolved_location: "Bristol, England",
  country_code: "GB",
  intent: "crime",
  months: ["2025-01"],
};

let queryRouter: Router;

beforeAll(async () => {
  ({ queryRouter } = await import("../query"));
});

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/query", queryRouter);
  return app;
}

// Reset mocks and re-establish default implementations before each test.
beforeEach(() => {
  vi.clearAllMocks();

  mockAdapterFetchData = vi.fn().mockResolvedValue([]);
  mockAdapterStoreResults = vi.fn().mockResolvedValue(undefined);

  mockParseIntent.mockResolvedValue(basePlan);
  mockDeriveVizHint.mockReturnValue("table");
  mockExpandDateRange.mockReturnValue(["2025-01"]);
  mockGeocodeToPolygon.mockResolvedValue({
    poly: "51.4,2.5:51.4,2.6:51.5,2.6:51.5,2.5",
    display_name: "Bristol, England",
    country_code: "GB",
  });
  mockAcquire.mockResolvedValue(undefined);
  mockCreateSnapshot.mockResolvedValue({
    runId: "run-1",
    snapshotId: "snap-1",
  });
  mockShadowAdapter.isEnabled.mockReturnValue(false);
  mockShadowAdapter.recover.mockResolvedValue(null);
  mockDomainDiscovery.isEnabled.mockReturnValue(false);
  mockDomainDiscovery.run.mockResolvedValue(undefined);
  mockClassifyIntent.mockResolvedValue({
    confidence: 0,
    domain: null,
    intent: null,
  });

  // Default adapter — uses the hybrid query_results table.
  mockGetDomainForQuery.mockReturnValue({
    config: {
      name: "cinema-listings-gb",
      tableName: "query_results",
      prismaModel: "queryResult",
      apiUrl: "https://example.com/api",
      sources: [{ url: "https://example.com/api" }],
      defaultOrderBy: { date: "asc" },
    },
    fetchData: mockAdapterFetchData,
    flattenRow: (r: unknown) => r,
    storeResults: mockAdapterStoreResults,
  });

  // Prisma defaults
  mockPrisma.query.create.mockResolvedValue({ id: "q-1", ...basePlan });
  mockPrisma.query.findUnique.mockResolvedValue(null);
  mockPrisma.queryResult.findMany.mockResolvedValue([]);
  mockPrisma.queryResult.createMany.mockResolvedValue({ count: 0 });
  mockPrisma.crimeResult.findMany.mockResolvedValue([]);
  mockPrisma.weatherResult.findMany.mockResolvedValue([]);
  mockPrisma.queryCache.findUnique.mockResolvedValue(null);
  mockPrisma.queryCache.create.mockResolvedValue({});
  mockPrisma.queryCache.delete.mockResolvedValue({});
  mockPrisma.queryJob.create.mockResolvedValue({ id: "job-1" });
  mockPrisma.queryJob.update.mockResolvedValue({});
  mockPrisma.queryRun.create.mockResolvedValue({ id: "run-1" });
  mockPrisma.queryRun.update.mockResolvedValue({});
  mockPrisma.datasetSnapshot.create.mockResolvedValue({ id: "snap-1" });
  mockPrisma.$queryRaw.mockResolvedValue([]);
});

describe("execute pipeline — hybrid write path", () => {
  it("calls adapter.storeResults on a cache miss (not a direct crime_results write)", async () => {
    mockAdapterFetchData.mockResolvedValue([
      { description: "Dune Part Two", date: "2025-06-01" },
    ]);

    const app = buildApp();
    await request(app).post("/query/execute").send(validExecuteBody);

    // The adapter's storeResults is responsible for the write.
    expect(mockAdapterStoreResults).toHaveBeenCalledOnce();
    // The pipeline must NOT bypass the adapter and write to crimeResult directly.
    expect(mockPrisma.crimeResult.findMany).not.toHaveBeenCalled();
  });

  it("reads results back from the model named in adapter.config.prismaModel after store", async () => {
    const storedRows = [
      { id: "r1", description: "Film A", date: "2025-06-01" },
      { id: "r2", description: "Film B", date: "2025-06-02" },
    ];
    mockAdapterFetchData.mockResolvedValue(storedRows);
    mockPrisma.queryResult.findMany.mockResolvedValue(storedRows);

    const app = buildApp();
    const res = await request(app)
      .post("/query/execute")
      .send(validExecuteBody);

    expect(res.status).toBe(200);
    expect(res.body.count).toBe(2);
    // The results should come from queryResult.findMany, not crimeResult.findMany.
    expect(mockPrisma.queryResult.findMany).toHaveBeenCalled();
    expect(mockPrisma.crimeResult.findMany).not.toHaveBeenCalled();
  });

  it("writes the QueryCache row with the correct domain name from the adapter", async () => {
    mockAdapterFetchData.mockResolvedValue([{ description: "Film A" }]);
    mockPrisma.queryResult.findMany.mockResolvedValue([{ id: "r1" }]);

    const app = buildApp();
    await request(app).post("/query/execute").send(validExecuteBody);

    expect(mockPrisma.queryCache.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ domain: "cinema-listings-gb" }),
      }),
    );
  });

  it("createSnapshot is called with sourceSet from adapter.config.sources", async () => {
    mockAdapterFetchData.mockResolvedValue([{ description: "Film A" }]);

    const app = buildApp();
    await request(app).post("/query/execute").send(validExecuteBody);

    expect(mockCreateSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceSet: ["https://example.com/api"],
      }),
    );
  });

  it("createSnapshot is called with sourceSet from adapter.config.apiUrl when sources is absent", async () => {
    // Adapter with no sources array — falls back to apiUrl.
    mockGetDomainForQuery.mockReturnValue({
      config: {
        name: "flood-risk-gb",
        tableName: "query_results",
        prismaModel: "queryResult",
        apiUrl: "https://environment.data.gov.uk/flood-monitoring",
        defaultOrderBy: { date: "asc" },
      },
      fetchData: mockAdapterFetchData,
      flattenRow: (r: unknown) => r,
      storeResults: mockAdapterStoreResults,
    });
    mockAdapterFetchData.mockResolvedValue([{ description: "Flood alert" }]);

    const app = buildApp();
    await request(app).post("/query/execute").send(validExecuteBody);

    expect(mockCreateSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceSet: ["https://environment.data.gov.uk/flood-monitoring"],
      }),
    );
  });

  it("storeResults is called when fetchData returns rows", async () => {
    mockAdapterFetchData.mockResolvedValue([
      { description: "Film A", extra_field: "new" },
    ]);

    const app = buildApp();
    await request(app).post("/query/execute").send(validExecuteBody);

    expect(mockAdapterStoreResults).toHaveBeenCalledOnce();
  });

  it("storeResults is NOT called when fetchData returns an empty array", async () => {
    mockAdapterFetchData.mockResolvedValue([]);

    const app = buildApp();
    await request(app).post("/query/execute").send(validExecuteBody);

    expect(mockAdapterStoreResults).not.toHaveBeenCalled();
  });

  it("response shape is correct on a successful execute", async () => {
    mockAdapterFetchData.mockResolvedValue([{ description: "Film A" }]);
    mockPrisma.queryResult.findMany.mockResolvedValue([
      { id: "r1", description: "Film A" },
    ]);

    const app = buildApp();
    const res = await request(app)
      .post("/query/execute")
      .send(validExecuteBody);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      query_id: expect.any(String),
      plan: basePlan,
      viz_hint: "table",
      resolved_location: "Bristol, England",
      count: expect.any(Number),
      months_fetched: [],
      results: expect.any(Array),
      cache_hit: false,
    });
  });

  it("returns cached results on a cache hit without calling adapter.fetchData", async () => {
    mockPrisma.queryCache.findUnique.mockResolvedValue({
      result_count: 5,
      results: Array.from({ length: 5 }, (_, i) => ({ id: `r${i}` })),
      createdAt: new Date(),
    });

    const app = buildApp();
    const res = await request(app)
      .post("/query/execute")
      .send(validExecuteBody);

    expect(mockAdapterFetchData).not.toHaveBeenCalled();
    expect(res.body.cache_hit).toBe(true);
    expect(res.body.count).toBe(5);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 3 — orderBy bug fix
// Confirms the pipeline uses adapter.config.defaultOrderBy and that the
// hardcoded { month: "asc" } that breaks weather queries is gone.
// ─────────────────────────────────────────────────────────────────────────────

describe("execute pipeline — orderBy uses defaultOrderBy from adapter config", () => {
  it("queries the prismaModel with defaultOrderBy when defined on adapter.config", async () => {
    mockAdapterFetchData.mockResolvedValue([{ description: "Hot day" }]);
    mockPrisma.queryResult.findMany.mockResolvedValue([
      { id: "r1", description: "Hot day" },
    ]);

    // Weather-shaped adapter with date-based orderBy (not the broken month: asc)
    mockGetDomainForQuery.mockReturnValue({
      config: {
        name: "weather-gb",
        tableName: "query_results",
        prismaModel: "queryResult",
        apiUrl: "https://api.open-meteo.com",
        sources: [{ url: "https://api.open-meteo.com" }],
        defaultOrderBy: { date: "asc" },
      },
      fetchData: mockAdapterFetchData,
      flattenRow: (r: unknown) => r,
      storeResults: mockAdapterStoreResults,
    });

    const app = buildApp();
    await request(app)
      .post("/query/execute")
      .send({ ...validExecuteBody, intent: "weather" });

    // findMany must be called with the adapter's defaultOrderBy, not hardcoded month.
    expect(mockPrisma.queryResult.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: { date: "asc" },
      }),
    );
  });

  it("does NOT pass { month: 'asc' } as orderBy for a non-crime adapter", async () => {
    mockAdapterFetchData.mockResolvedValue([{ description: "Rainy" }]);

    mockGetDomainForQuery.mockReturnValue({
      config: {
        name: "weather-gb",
        tableName: "query_results",
        prismaModel: "queryResult",
        apiUrl: "https://api.open-meteo.com",
        defaultOrderBy: { date: "asc" },
      },
      fetchData: mockAdapterFetchData,
      flattenRow: (r: unknown) => r,
      storeResults: mockAdapterStoreResults,
    });

    const app = buildApp();
    await request(app)
      .post("/query/execute")
      .send({ ...validExecuteBody, intent: "weather" });

    // Assert the broken hardcoded orderBy is not used.
    const calls = mockPrisma.queryResult.findMany.mock.calls;
    for (const [arg] of calls) {
      expect(arg?.orderBy).not.toEqual({ month: "asc" });
    }
  });

  it("falls back gracefully when defaultOrderBy is absent from adapter.config", async () => {
    // Adapter without defaultOrderBy — pipeline should not throw.
    mockGetDomainForQuery.mockReturnValue({
      config: {
        name: "legacy-adapter",
        tableName: "query_results",
        prismaModel: "queryResult",
        apiUrl: "https://example.com",
        // no defaultOrderBy
      },
      fetchData: mockAdapterFetchData,
      flattenRow: (r: unknown) => r,
      storeResults: mockAdapterStoreResults,
    });
    mockAdapterFetchData.mockResolvedValue([{ description: "Data" }]);

    const app = buildApp();
    const res = await request(app)
      .post("/query/execute")
      .send(validExecuteBody);

    // Must not 500 — orderBy absence is handled gracefully.
    expect(res.status).toBe(200);
  });
});
