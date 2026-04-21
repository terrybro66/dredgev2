import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";
import express from "express";
import request from "supertest";
import type { Router } from "express";

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
const { mockFetchCrimes } = vi.hoisted(() => ({ mockFetchCrimes: vi.fn() }));
const { mockStoreResults } = vi.hoisted(() => ({ mockStoreResults: vi.fn() }));
const { mockGeocodeToPolygon } = vi.hoisted(() => ({
  mockGeocodeToPolygon: vi.fn(),
}));
const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    query: {
      create: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
    },
    crimeResult: {
      findMany: vi.fn(),
    },
    queryCache: {
      findUnique: vi.fn(),
      create: vi.fn(),
    },
    queryJob: {
      create: vi.fn(),
      update: vi.fn(),
    },
    queryRun: {
      create: vi.fn(),
      update: vi.fn(),
    },
    datasetSnapshot: {
      create: vi.fn(),
    },
    apiAvailability: {
      upsert: vi.fn(),
    },
    queryResult: {
      createMany: vi.fn(),
      findMany: vi.fn(),
    },
    findMany: vi.fn(),
    $queryRaw: vi.fn(),
  },
}));

const { mockAcquire } = vi.hoisted(() => ({ mockAcquire: vi.fn() }));
const { mockCreateSnapshot } = vi.hoisted(() => ({
  mockCreateSnapshot: vi.fn(),
}));
const { mockShadowAdapter } = vi.hoisted(() => ({
  mockShadowAdapter: {
    isEnabled: vi.fn(),
    recover: vi.fn(),
  },
}));
const { mockDomainDiscovery } = vi.hoisted(() => ({
  mockDomainDiscovery: {
    isEnabled: vi.fn(),
    run: vi.fn(),
  },
}));
const { mockClassifyIntent } = vi.hoisted(() => ({
  mockClassifyIntent: vi.fn(),
}));
const { mockDefaultResolveTemporalRange, mockResolveTemporalRangeForCrime } =
  vi.hoisted(() => ({
    mockDefaultResolveTemporalRange: vi.fn(),
    mockResolveTemporalRangeForCrime: vi.fn(),
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
  getAllAdapters: () => [],
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
vi.mock("../temporal-resolver", () => ({
  defaultResolveTemporalRange: mockDefaultResolveTemporalRange,
  resolveTemporalRangeForCrime: mockResolveTemporalRangeForCrime,
}));

// basePlan is now an UnresolvedQueryPlan — temporal instead of date_from/date_to
const basePlan = {
  category: "burglary",
  temporal: "last month",
  location: "Cambridge, UK",
};

// resolved plan — what the /parse handler constructs after temporal resolution
const resolvedPlan = {
  category: "burglary",
  date_from: "2024-01",
  date_to: "2024-01",
  location: "Cambridge, UK",
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

beforeEach(() => {
  vi.clearAllMocks();
  mockParseIntent.mockResolvedValue(basePlan);
  mockDeriveVizHint.mockReturnValue("map");
  mockExpandDateRange.mockReturnValue(["2024-01"]);
  mockGeocodeToPolygon.mockResolvedValue({
    poly: "52.3,0.0:52.3,0.3:52.1,0.3:52.1,0.0",
    display_name: "Cambridge, Cambridgeshire, England",
    country_code: "GB",
  });
  mockFetchCrimes.mockResolvedValue([]);
  mockStoreResults.mockResolvedValue(undefined);
  mockGetDomainForQuery.mockReturnValue({
    config: {
      identity: { name: "crime-uk", displayName: "Crime UK", description: "", countries: ["GB"], intents: ["crime"] },
      source: { type: "rest", endpoint: "https://data.police.uk/api" },
      template: { type: "incidents", capabilities: { has_coordinates: true } },
      fields: {},
      time: { type: "time_series", resolution: "month" },
      recovery: [],
      storage: { storeResults: true, tableName: "query_results", prismaModel: "queryResult", extrasStrategy: "retain_unmapped" },
      visualisation: { default: "map", rules: [{ condition: "multi_month", view: "bar" }] },
    },
    fetchData: mockFetchCrimes,
    flattenRow: (r: unknown) => r,
    storeResults: mockStoreResults,
  });
  mockPrisma.query.create.mockResolvedValue({ id: "test-id", ...resolvedPlan });
  mockPrisma.query.findUnique.mockResolvedValue(null);
  mockPrisma.queryCache.findUnique.mockResolvedValue(null);
  mockPrisma.queryCache.create.mockResolvedValue({});
  mockPrisma.queryJob.create.mockResolvedValue({ id: "job-id" });
  mockPrisma.queryJob.update.mockResolvedValue({});
  mockPrisma.queryRun.create.mockResolvedValue({ id: "run-id" });
  mockPrisma.queryRun.update.mockResolvedValue({});
  mockPrisma.datasetSnapshot.create.mockResolvedValue({ id: "snap-id" });
  mockPrisma.apiAvailability.upsert.mockResolvedValue({});
  mockPrisma.$queryRaw.mockResolvedValue([]);
  mockPrisma.queryResult.createMany.mockResolvedValue({});
  mockPrisma.queryResult.findMany.mockResolvedValue([]);
  mockAcquire.mockResolvedValue(undefined);
  mockCreateSnapshot.mockResolvedValue({ id: "snap-id" });
  mockShadowAdapter.isEnabled.mockReturnValue(false);
  mockShadowAdapter.recover.mockResolvedValue(null);
  mockDomainDiscovery.isEnabled.mockReturnValue(false);
  mockDomainDiscovery.run.mockResolvedValue(undefined);
  mockClassifyIntent.mockResolvedValue({
    confidence: 0,
    domain: null,
    intent: null,
  });
  mockDefaultResolveTemporalRange.mockReturnValue({
    date_from: "2024-01",
    date_to: "2024-01",
  });
  mockResolveTemporalRangeForCrime.mockResolvedValue({
    date_from: "2024-01",
    date_to: "2024-01",
  });
});

// ── POST /parse ───────────────────────────────────────────────────────────────

describe("POST /query/parse", () => {
  it("returns 400 when text field is missing", async () => {
    const app = buildApp();
    const res = await request(app).post("/query/parse").send({});
    expect(res.status).toBe(400);
  });

  it("returns 400 when text is an empty string", async () => {
    const app = buildApp();
    const res = await request(app).post("/query/parse").send({ text: "" });
    expect(res.status).toBe(400);
  });

  it("returns 400 with structured IntentError when parseIntent throws", async () => {
    mockParseIntent.mockRejectedValue({
      error: "incomplete_intent",
      understood: {},
      missing: ["location"],
      message: "Could not determine location",
    });
    const app = buildApp();
    const res = await request(app)
      .post("/query/parse")
      .send({ text: "burglaries last month" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("incomplete_intent");
  });

  it("structured error includes understood and missing fields", async () => {
    mockParseIntent.mockRejectedValue({
      error: "incomplete_intent",
      understood: { category: "burglary" },
      missing: ["location"],
      message: "Could not determine location",
    });
    const app = buildApp();
    const res = await request(app)
      .post("/query/parse")
      .send({ text: "burglaries last month" });
    expect(res.body.understood).toMatchObject({ category: "burglary" });
    expect(res.body.missing).toContain("location");
  });

  it("returns 400 with structured error when geocoder fails", async () => {
    mockGeocodeToPolygon.mockRejectedValue({
      error: "geocode_failed",
      understood: { location: "nowhere" },
      missing: ["coordinates"],
      message: "Could not find location",
    });
    const app = buildApp();
    const res = await request(app)
      .post("/query/parse")
      .send({ text: "burglaries in nowhere" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("geocode_failed");
  });

  it("response includes plan with resolved date_from and date_to", async () => {
    const app = buildApp();
    const res = await request(app)
      .post("/query/parse")
      .send({ text: "burglaries in Cambridge" });
    expect(res.status).toBe(200);
    expect(res.body.plan).toMatchObject({
      category: "burglary",
      date_from: "2024-01",
      date_to: "2024-01",
      location: "Cambridge, UK",
    });
  });

  it("response includes temporal string from the unresolved plan", async () => {
    const app = buildApp();
    const res = await request(app)
      .post("/query/parse")
      .send({ text: "burglaries in Cambridge" });
    expect(res.status).toBe(200);
    expect(res.body.temporal).toBe("last month");
  });

  it("uses adapter.resolveTemporalRange when the matched domain adapter provides it", async () => {
    // The generic temporal resolution path: if the classified adapter has
    // resolveTemporalRange, that method is called. If not, defaultResolveTemporalRange is used.
    const mockAdapterResolve = vi.fn().mockResolvedValue({ date_from: "2024-01", date_to: "2024-01" });
    mockGetDomainForQuery.mockReturnValue({
      config: {
        identity: { name: "crime-uk", displayName: "Crime UK", description: "", countries: ["GB"], intents: ["crime"] },
        source: { type: "rest", endpoint: "https://data.police.uk/api" },
        template: { type: "incidents", capabilities: {} },
        fields: {},
        time: { type: "time_series", resolution: "month" },
        recovery: [],
        storage: { storeResults: true, tableName: "query_results", prismaModel: "queryResult", extrasStrategy: "retain_unmapped" },
        visualisation: { default: "map", rules: [] },
      },
      fetchData: mockFetchCrimes,
      flattenRow: (r: unknown) => r,
      storeResults: mockStoreResults,
      resolveTemporalRange: mockAdapterResolve,
    });
    mockClassifyIntent.mockResolvedValue({ confidence: 0.9, domain: "crime-uk", intent: "crime" });
    const app = buildApp();
    await request(app)
      .post("/query/parse")
      .send({ text: "burglaries in Cambridge" });
    expect(mockAdapterResolve).toHaveBeenCalledWith("last month");
    expect(mockDefaultResolveTemporalRange).not.toHaveBeenCalled();
  });

  it("uses defaultResolveTemporalRange when intent is not crime", async () => {
    mockClassifyIntent.mockResolvedValue({
      confidence: 0.9,
      domain: "weather",
      intent: "weather",
    });
    const app = buildApp();
    await request(app)
      .post("/query/parse")
      .send({ text: "weather in Cambridge" });
    expect(mockDefaultResolveTemporalRange).toHaveBeenCalledWith("last month");
  });

  it("uses defaultResolveTemporalRange when classifier confidence is below threshold", async () => {
    mockClassifyIntent.mockResolvedValue({
      confidence: 0,
      domain: null,
      intent: null,
    });
    const app = buildApp();
    await request(app)
      .post("/query/parse")
      .send({ text: "burglaries in Cambridge" });
    expect(mockDefaultResolveTemporalRange).toHaveBeenCalledWith("last month");
  });

  it("returns confirmation payload with poly, viz_hint, resolved_location, country_code, months", async () => {
    const app = buildApp();
    const res = await request(app)
      .post("/query/parse")
      .send({ text: "burglaries in Cambridge" });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      poly: expect.any(String),
      viz_hint: "map",
      resolved_location: "Cambridge, Cambridgeshire, England",
      country_code: "GB",
      months: ["2024-01"],
    });
  });

  it("does not write to the database", async () => {
    const app = buildApp();
    await request(app)
      .post("/query/parse")
      .send({ text: "burglaries in Cambridge" });
    expect(mockPrisma.query.create).not.toHaveBeenCalled();
  });

  it("does not call fetchCrimes", async () => {
    const app = buildApp();
    await request(app)
      .post("/query/parse")
      .send({ text: "burglaries in Cambridge" });
    expect(mockFetchCrimes).not.toHaveBeenCalled();
  });

  it("viz_hint is derived, not from LLM", async () => {
    mockDeriveVizHint.mockReturnValue("bar");
    const app = buildApp();
    const res = await request(app)
      .post("/query/parse")
      .send({ text: "burglaries in Cambridge" });
    expect(res.body.viz_hint).toBe("bar");
    expect(mockDeriveVizHint).toHaveBeenCalled();
  });

  it("resolved_location reflects geocoder display_name", async () => {
    const app = buildApp();
    const res = await request(app)
      .post("/query/parse")
      .send({ text: "burglaries in Cambridge" });
    expect(res.body.resolved_location).toBe(
      "Cambridge, Cambridgeshire, England",
    );
  });

  it("months array is correctly expanded from resolved date range", async () => {
    mockExpandDateRange.mockReturnValue(["2024-01", "2024-02", "2024-03"]);
    const app = buildApp();
    const res = await request(app)
      .post("/query/parse")
      .send({ text: "burglaries in Cambridge" });
    expect(res.body.months).toEqual(["2024-01", "2024-02", "2024-03"]);
  });

  it("returns undefined intent when classifier confidence is below threshold", async () => {
    const app = buildApp();
    const res = await request(app)
      .post("/query/parse")
      .send({ text: "burglaries in Cambridge" });
    expect(res.body.intent).toBeUndefined();
  });

  it("returns classified intent when classifier confidence meets threshold", async () => {
    mockClassifyIntent.mockResolvedValue({
      confidence: 0.9,
      domain: "crime-uk",
      intent: "crime",
    });
    const app = buildApp();
    const res = await request(app)
      .post("/query/parse")
      .send({ text: "burglaries in Cambridge" });
    expect(res.body.intent).toBe("crime");
  });
});

// ── POST /execute ─────────────────────────────────────────────────────────────

const validExecuteBody = {
  plan: resolvedPlan,
  poly: "52.3,0.0:52.3,0.3:52.1,0.3:52.1,0.0",
  viz_hint: "map",
  resolved_location: "Cambridge, Cambridgeshire, England",
  country_code: "GB",
  intent: "crime",
  months: ["2024-01"],
};

describe("POST /query/execute", () => {
  it("returns 400 when body is missing required fields", async () => {
    const app = buildApp();
    const res = await request(app).post("/query/execute").send({});
    expect(res.status).toBe(400);
  });

  it("creates Query record with domain: crime-uk", async () => {
    const app = buildApp();
    await request(app).post("/query/execute").send(validExecuteBody);
    expect(mockPrisma.query.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ domain: "crime-uk" }),
      }),
    );
  });

  it("stores resolved_location on Query record", async () => {
    const app = buildApp();
    await request(app).post("/query/execute").send(validExecuteBody);
    expect(mockPrisma.query.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          resolved_location: "Cambridge, Cambridgeshire, England",
        }),
      }),
    );
  });

  it("stores country_code on Query record", async () => {
    const app = buildApp();
    await request(app).post("/query/execute").send(validExecuteBody);
    expect(mockPrisma.query.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ country_code: "GB" }),
      }),
    );
  });

  it("calls fetchCrimes with the poly from the request body", async () => {
    const app = buildApp();
    await request(app).post("/query/execute").send(validExecuteBody);
    expect(mockFetchCrimes).toHaveBeenCalledWith(
      resolvedPlan,
      validExecuteBody.poly,
    );
  });

  it("response includes query_id, plan, poly, viz_hint, resolved_location, count, months_fetched, results", async () => {
    const app = buildApp();
    const res = await request(app)
      .post("/query/execute")
      .send(validExecuteBody);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      query_id: expect.any(String),
      plan: resolvedPlan,
      poly: validExecuteBody.poly,
      viz_hint: "map",
      resolved_location: "Cambridge, Cambridgeshire, England",
      count: expect.any(Number),
      months_fetched: expect.any(Array),
      results: expect.any(Array),
    });
  });

  it("bar chart results are grouped by month not raw rows", async () => {
    const crimes = Array.from({ length: 150 }, (_, i) => ({
      id: i,
      category: "burglary",
      month: i < 75 ? "2024-01" : "2024-02",
    }));
    mockFetchCrimes.mockResolvedValue(crimes);
    mockPrisma.queryResult.findMany.mockResolvedValue(crimes);
    const app = buildApp();
    const res = await request(app)
      .post("/query/execute")
      // Provide two months so getVizHint fires the multi_month rule → bar
      .send({ ...validExecuteBody, viz_hint: "bar", months: ["2024-01", "2024-02"] });
    expect(res.body.results).toHaveLength(2);
    expect(res.body.results[0]).toMatchObject({
      month: expect.any(String),
      count: expect.any(Number),
    });
  });

  it("returns 500 when fetchCrimes throws", async () => {
    mockFetchCrimes.mockRejectedValue(new Error("API down"));
    const app = buildApp();
    const res = await request(app)
      .post("/query/execute")
      .send(validExecuteBody);
    expect(res.status).toBe(500);
  });

  it("returns 500 when storeResults throws", async () => {
    mockFetchCrimes.mockResolvedValue([{ category: "burglary" }]);
    mockStoreResults.mockRejectedValue(new Error("DB error"));
    const app = buildApp();
    const res = await request(app)
      .post("/query/execute")
      .send(validExecuteBody);
    expect(res.status).toBe(500);
  });
});

// ── GET /query/:id ────────────────────────────────────────────────────────────

describe("GET /query/:id", () => {
  it("returns 404 for unknown id", async () => {
    mockPrisma.query.findUnique.mockResolvedValue(null);
    const app = buildApp();
    const res = await request(app).get("/query/nonexistent-id");
    expect(res.status).toBe(404);
  });

  it("returns query record with results included", async () => {
    mockPrisma.query.findUnique.mockResolvedValue({
      id: "test-id",
      ...resolvedPlan,
      results: [{ id: "r1", category: "burglary" }],
    });
    const app = buildApp();
    const res = await request(app).get("/query/test-id");
    expect(res.status).toBe(200);
    expect(res.body.results).toHaveLength(1);
  });
});

// ── cache, job tracking, and routing ─────────────────────────────────────────

describe("cache, job tracking, and routing", () => {
  it("returns cached results without calling fetchCrimes on cache hit", async () => {
    mockPrisma.queryCache.findUnique.mockResolvedValue({
      result_count: 3,
      results: [{ id: "r1" }, { id: "r2" }, { id: "r3" }],
    });
    const app = buildApp();
    const res = await request(app)
      .post("/query/execute")
      .send(validExecuteBody);
    expect(mockFetchCrimes).not.toHaveBeenCalled();
    expect(res.body.cache_hit).toBe(true);
    expect(res.body.results).toHaveLength(3);
  });

  it("QueryJob has cache_hit: true and status: complete on cache hit", async () => {
    mockPrisma.queryCache.findUnique.mockResolvedValue({
      result_count: 1,
      results: [{ id: "r1" }],
    });
    const app = buildApp();
    await request(app).post("/query/execute").send(validExecuteBody);
    expect(mockPrisma.queryJob.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ cache_hit: true, status: "complete" }),
      }),
    );
  });

  it("writes QueryCache row on cache miss", async () => {
    mockFetchCrimes.mockResolvedValue([{ category: "burglary" }]);
    mockPrisma.queryResult.findMany.mockResolvedValue([{ id: "r1" }]);
    const app = buildApp();
    await request(app).post("/query/execute").send(validExecuteBody);
    expect(mockPrisma.queryCache.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ domain: "crime-uk" }),
      }),
    );
  });

  it("QueryJob updated to complete with timings on success", async () => {
    const app = buildApp();
    await request(app).post("/query/execute").send(validExecuteBody);
    expect(mockPrisma.queryJob.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "complete" }),
      }),
    );
  });

  it("QueryJob updated to error status when fetchCrimes throws", async () => {
    mockFetchCrimes.mockRejectedValue(new Error("API down"));
    const app = buildApp();
    await request(app).post("/query/execute").send(validExecuteBody);
    expect(mockPrisma.queryJob.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "error" }),
      }),
    );
  });

  it("returns 200 with not_supported when country_code has no adapter", async () => {
    mockGetDomainForQuery.mockReturnValue(undefined);
    const app = buildApp();
    const res = await request(app)
      .post("/query/execute")
      .send({ ...validExecuteBody, country_code: "US" });
    expect(res.status).toBe(200);
    expect(res.body.error).toBe("not_supported");
    expect(res.body.supported).toBeInstanceOf(Array);
  });

  it("returns country_code from geocoder in parse payload", async () => {
    const app = buildApp();
    const res = await request(app)
      .post("/query/parse")
      .send({ text: "burglaries in Cambridge" });
    expect(res.body.country_code).toBe("GB");
  });
});

// Shadow adapter (shadow-adapter.ts) was deleted in the v2 migration.
// The related tests have been removed. recoverFromEmpty() on the adapter
// is now the only recovery path — tested via adapter-level tests.

describe("GET /query/history", () => {
  const historyRecord = {
    id: "q1",
    text: "burglaries in Cambridge",
    category: "burglary",
    date_from: "2024-01",
    date_to: "2024-01",
    poly: "52.0,0.0:52.1,0.1",
    resolved_location: "Cambridge, England",
    country_code: "GB",
    domain: "crime-uk",
    intent: "crime",
    viz_hint: "map",
    createdAt: new Date("2024-01-15T10:00:00Z"),
    jobs: [{ rows_inserted: 42, status: "done", cache_hit: false }],
  };

  beforeEach(() => {
    mockPrisma.query.findMany.mockResolvedValue([historyRecord]);
  });

  it("returns 200 with an array", async () => {
    const app = buildApp();
    const res = await request(app).get("/query/history");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it("each entry has query_id, text, domain, viz_hint, result_count", async () => {
    const app = buildApp();
    const res = await request(app).get("/query/history");
    const entry = res.body[0];
    expect(entry).toHaveProperty("query_id", "q1");
    expect(entry).toHaveProperty("text", "burglaries in Cambridge");
    expect(entry).toHaveProperty("domain", "crime-uk");
    expect(entry).toHaveProperty("viz_hint", "map");
    expect(entry).toHaveProperty("result_count", 42);
  });

  it("result_count is null when no jobs exist", async () => {
    mockPrisma.query.findMany.mockResolvedValue([
      { ...historyRecord, jobs: [] },
    ]);
    const app = buildApp();
    const res = await request(app).get("/query/history");
    expect(res.body[0].result_count).toBeNull();
  });

  it("cache_hit is false when no jobs exist", async () => {
    mockPrisma.query.findMany.mockResolvedValue([
      { ...historyRecord, jobs: [] },
    ]);
    const app = buildApp();
    const res = await request(app).get("/query/history");
    expect(res.body[0].cache_hit).toBe(false);
  });

  it("returns empty array when no queries exist", async () => {
    mockPrisma.query.findMany.mockResolvedValue([]);
    const app = buildApp();
    const res = await request(app).get("/query/history");
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});
