/**
 * Block E — Ephemeral pipeline enforcement
 *
 * Branch: feat/ephemeral-pipeline-bypass
 *
 * When the matched adapter has storeResults: false, the execute pipeline must:
 *   - Return live results directly from fetchData
 *   - NOT write to query_results (adapter.storeResults is a no-op, but the
 *    pipeline must not call adapter.storeResults)
 *   - NOT create a QueryCache entry
 *   - NOT create a QueryRun or DatasetSnapshot
 *
 * A second identical ephemeral query must re-fetch live (no cache hit possible).
 *
 * Regression suite confirms the persistent path still writes everything.
 *
 * Run:
 *   pnpm vitest run src/__tests__/ephemeral-pipeline.test.ts --reporter=verbose
 */

import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";
import express from "express";
import request from "supertest";
import type { Router } from "express";
import { makeConfig } from "@mocks/mockConfig";

// ── Hoist all mock factories ──────────────────────────────────────────────────
beforeAll(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  ({ queryRouter } = await import("../query"));
});

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

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    query: { create: vi.fn(), findUnique: vi.fn() },
    queryResult: { findMany: vi.fn(), createMany: vi.fn() },
    crimeResult: { findMany: vi.fn() },
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

// ── Shared fixtures ───────────────────────────────────────────────────────────

const basePlan = {
  category: "burglary",
  date_from: "2025-01",
  date_to: "2025-01",
  location: "Bristol, UK",
};

const validExecuteBody = {
  plan: basePlan,
  poly: "51.4,2.5:51.4,2.6:51.5,2.6:51.5,2.5",
  viz_hint: "table" as const,
  resolved_location: "Bristol, England",
  country_code: "GB",
  intent: "cinema",
  months: ["2025-01"],
};

let mockEphemeralFetchData: ReturnType<typeof vi.fn>;
let mockEphemeralStoreResults: ReturnType<typeof vi.fn>;
let mockPersistentFetchData: ReturnType<typeof vi.fn>;
let mockPersistentStoreResults: ReturnType<typeof vi.fn>;

// Ephemeral adapter — storeResults: false
function ephemeralAdapter() {
  return {
    config: makeConfig({
      name: "cinema-listings-gb",
      storeResults: false,
      countries: ["GB"],
      intents: ["cinema"],
      endpoint: "https://www.odeon.co.uk/api/showtimes",
    }),
    fetchData: mockEphemeralFetchData,
    flattenRow: (r: unknown) => r,
    storeResults: mockEphemeralStoreResults,
  };
}

// Persistent adapter — storeResults: true (default)
function persistentAdapter() {
  return {
    config: makeConfig({
      name: "crime-uk",
      storeResults: true,
      countries: ["GB"],
      intents: ["crime"],
      endpoint: "https://data.police.uk/api",
      cacheTtlHours: 24,
      defaultOrderBy: { date: "asc" },
    }),
    fetchData: mockPersistentFetchData,
    flattenRow: (r: unknown) => r,
    storeResults: mockPersistentStoreResults,
  };
}

let queryRouter: Router;

beforeAll(async () => {
  vi.resetModules();
  ({ queryRouter } = await import("../query"));
});
function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/query", queryRouter);
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();

  mockEphemeralFetchData = vi.fn().mockResolvedValue([]);
  mockEphemeralStoreResults = vi.fn().mockResolvedValue(undefined);
  mockPersistentFetchData = vi.fn().mockResolvedValue([]);
  mockPersistentStoreResults = vi.fn().mockResolvedValue(undefined);

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

  mockPrisma.query.create.mockResolvedValue({ id: "q-1", ...basePlan });
  mockPrisma.query.findUnique.mockResolvedValue(null);
  mockPrisma.queryResult.findMany.mockResolvedValue([]);
  mockPrisma.queryResult.createMany.mockResolvedValue({ count: 0 });
  mockPrisma.crimeResult.findMany.mockResolvedValue([]);
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

// ── Suite 1: ephemeral adapter — pipeline bypass ──────────────────────────────

describe("execute pipeline — ephemeral adapter (storeResults: false)", () => {
  it("returns 200 and live results when adapter has storeResults: false", async () => {
    mockGetDomainForQuery.mockReturnValue(ephemeralAdapter());
    mockEphemeralFetchData.mockResolvedValue([
      { title: "Dune Part Two", date: "2025-06-01" },
    ]);

    const app = buildApp();
    const res = await request(app)
      .post("/query/execute")
      .send(validExecuteBody);

    expect(res.status).toBe(200);
    expect(res.body.results).toBeDefined();
  });

  it("does NOT write a QueryCache entry when storeResults: false", async () => {
    mockGetDomainForQuery.mockReturnValue(ephemeralAdapter());
    mockEphemeralFetchData.mockResolvedValue([
      { title: "Dune Part Two", date: "2025-06-01" },
    ]);

    const app = buildApp();
    await request(app).post("/query/execute").send(validExecuteBody);

    expect(mockPrisma.queryCache.create).not.toHaveBeenCalled();
  });

  it("does NOT call createSnapshot when storeResults: false", async () => {
    mockGetDomainForQuery.mockReturnValue(ephemeralAdapter());
    mockEphemeralFetchData.mockResolvedValue([
      { title: "Dune Part Two", date: "2025-06-01" },
    ]);

    const app = buildApp();
    await request(app).post("/query/execute").send(validExecuteBody);

    expect(mockCreateSnapshot).not.toHaveBeenCalled();
  });

  it("does NOT call prisma.queryResult.findMany when storeResults: false", async () => {
    mockGetDomainForQuery.mockReturnValue(ephemeralAdapter());
    mockEphemeralFetchData.mockResolvedValue([
      { title: "Dune Part Two", date: "2025-06-01" },
    ]);

    const app = buildApp();
    await request(app).post("/query/execute").send(validExecuteBody);

    expect(mockPrisma.queryResult.findMany).not.toHaveBeenCalled();
  });

  it("results in response come directly from fetchData rows, not from DB", async () => {
    mockGetDomainForQuery.mockReturnValue(ephemeralAdapter());
    const liveRows = [
      { title: "Dune Part Two", date: "2025-06-01T19:30:00Z" },
      { title: "Gladiator II", date: "2025-06-01T21:00:00Z" },
    ];
    mockEphemeralFetchData.mockResolvedValue(liveRows);

    const app = buildApp();
    const res = await request(app)
      .post("/query/execute")
      .send(validExecuteBody);

    expect(res.body.count).toBe(2);
    expect(res.body.results).toHaveLength(2);
    // DB was never queried for results
    expect(mockPrisma.queryResult.findMany).not.toHaveBeenCalled();
  });

  it("a second identical ephemeral query re-fetches live — no cache hit possible", async () => {
    mockGetDomainForQuery.mockReturnValue(ephemeralAdapter());
    mockEphemeralFetchData.mockResolvedValue([
      { title: "Dune Part Two", date: "2025-06-01" },
    ]);
    // Cache always returns null for ephemeral adapters
    mockPrisma.queryCache.findUnique.mockResolvedValue(null);

    const app = buildApp();
    await request(app).post("/query/execute").send(validExecuteBody);
    await request(app).post("/query/execute").send(validExecuteBody);

    // fetchData called twice — no cache short-circuit
    expect(mockEphemeralFetchData).toHaveBeenCalledTimes(2);
    // Cache never written so can never be hit
    expect(mockPrisma.queryCache.create).not.toHaveBeenCalled();
  });

  it("response includes cache_hit: false for ephemeral results", async () => {
    mockGetDomainForQuery.mockReturnValue(ephemeralAdapter());
    mockEphemeralFetchData.mockResolvedValue([]);

    const app = buildApp();
    const res = await request(app)
      .post("/query/execute")
      .send(validExecuteBody);

    expect(res.body.cache_hit).toBe(false);
  });

  it("pipeline does not error when all storage steps are skipped", async () => {
    mockGetDomainForQuery.mockReturnValue(ephemeralAdapter());
    mockEphemeralFetchData.mockResolvedValue([]);

    const app = buildApp();
    const res = await request(app)
      .post("/query/execute")
      .send(validExecuteBody);

    expect(res.status).toBe(200);
  });
});

// ── Suite 2: persistent adapter — regression ──────────────────────────────────

describe("execute pipeline — persistent adapter (storeResults: true) regression", () => {
  it("result IS returned when adapter has storeResults: true", async () => {
    mockGetDomainForQuery.mockReturnValue(persistentAdapter());
    mockPersistentFetchData.mockResolvedValue([{ description: "Burglary" }]);
    mockPrisma.queryResult.findMany.mockResolvedValue([
      { id: "r1", description: "Burglary" },
    ]);

    const app = buildApp();
    const res = await request(app)
      .post("/query/execute")
      .send({ ...validExecuteBody, intent: "crime" });

    expect(res.status).toBe(200);
    expect(res.body.count).toBeGreaterThanOrEqual(0);
  });

  it("QueryCache entry IS created when storeResults: true", async () => {
    mockGetDomainForQuery.mockReturnValue(persistentAdapter());
    mockPersistentFetchData.mockResolvedValue([{ description: "Burglary" }]);
    mockPrisma.queryResult.findMany.mockResolvedValue([
      { id: "r1", description: "Burglary" },
    ]);

    const app = buildApp();
    await request(app)
      .post("/query/execute")
      .send({ ...validExecuteBody, intent: "crime" });

    expect(mockPrisma.queryCache.create).toHaveBeenCalledOnce();
  });

  it("createSnapshot IS called when storeResults: true", async () => {
    mockGetDomainForQuery.mockReturnValue(persistentAdapter());
    mockPersistentFetchData.mockResolvedValue([{ description: "Burglary" }]);

    const app = buildApp();
    await request(app)
      .post("/query/execute")
      .send({ ...validExecuteBody, intent: "crime" });

    expect(mockCreateSnapshot).toHaveBeenCalledOnce();
  });

  it("storeResults IS called when storeResults: true and rows returned", async () => {
    mockGetDomainForQuery.mockReturnValue(persistentAdapter());
    mockPersistentFetchData.mockResolvedValue([{ description: "Burglary" }]);

    const app = buildApp();
    await request(app)
      .post("/query/execute")
      .send({ ...validExecuteBody, intent: "crime" });

    expect(mockPersistentStoreResults).toHaveBeenCalledOnce();
  });

  it("a second identical persistent query hits cache — fetchData called only once", async () => {
    mockGetDomainForQuery.mockReturnValue(persistentAdapter());
    mockPersistentFetchData.mockResolvedValue([{ description: "Burglary" }]);
    mockPrisma.queryResult.findMany.mockResolvedValue([
      { id: "r1", description: "Burglary" },
    ]);

    // Second call returns a cache hit
    mockPrisma.queryCache.findUnique
      .mockResolvedValueOnce(null) // first call — cache miss
      .mockResolvedValueOnce({
        // second call — cache hit
        result_count: 1,
        results: [{ id: "r1" }],
        createdAt: new Date(),
      });

    const app = buildApp();
    await request(app)
      .post("/query/execute")
      .send({ ...validExecuteBody, intent: "crime" });
    await request(app)
      .post("/query/execute")
      .send({ ...validExecuteBody, intent: "crime" });

    // fetchData only called once — second request served from cache
    expect(mockPersistentFetchData).toHaveBeenCalledTimes(1);
  });
});
