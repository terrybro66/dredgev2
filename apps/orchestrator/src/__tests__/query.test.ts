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

// ── NEW: mocks for modules that were hitting real implementations ──────────────

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

// ─────────────────────────────────────────────────────────────────────────────

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

// ── NEW: mock the four unmocked imports that were causing timeouts ─────────────
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
// ─────────────────────────────────────────────────────────────────────────────

const basePlan = {
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
      name: "crime-uk",
      tableName: "crime_results",
      prismaModel: "crimeResult",
    },
    fetchData: mockFetchCrimes,
    flattenRow: (r: unknown) => r,
    storeResults: mockStoreResults,
  });
  mockPrisma.query.create.mockResolvedValue({ id: "test-id", ...basePlan });
  mockPrisma.query.findUnique.mockResolvedValue(null);
  mockPrisma.crimeResult.findMany.mockResolvedValue([]);
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

  // ── NEW: defaults for the four previously-unmocked modules ──────────────────
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
  // ────────────────────────────────────────────────────────────────────────────
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

  it("returns confirmation payload with plan, poly, viz_hint, resolved_location, country_code, intent, months", async () => {
    const app = buildApp();
    const res = await request(app)
      .post("/query/parse")
      .send({ text: "burglaries in Cambridge" });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      plan: basePlan,
      poly: expect.any(String),
      viz_hint: "map",
      resolved_location: "Cambridge, Cambridgeshire, England",
      country_code: "GB",
      // intent is undefined when classifier confidence is below threshold
      // and keyword matching has been removed — the execute endpoint receives
      // it as undefined and triggers domain lookup or discovery accordingly
      months: ["2024-01"],
    });
    expect(res.body.intent).toBeUndefined();
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

  it("months array is correctly expanded from date range", async () => {
    mockExpandDateRange.mockReturnValue(["2024-01", "2024-02", "2024-03"]);
    const app = buildApp();
    const res = await request(app)
      .post("/query/parse")
      .send({ text: "burglaries in Cambridge" });
    expect(res.body.months).toEqual(["2024-01", "2024-02", "2024-03"]);
  });
});

// ── POST /execute ─────────────────────────────────────────────────────────────

const validExecuteBody = {
  plan: basePlan,
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
      basePlan,
      validExecuteBody.poly,
    );
  });

  it("response includes query_id, plan, poly, viz_hint, resolved_location, count, months_fetched, results", async () => {
    const app = buildApp();
    const res = await request(app)
      .post("/query/execute")
      .send(validExecuteBody);
    expect(res.status).toBe(200);
    console.log("500 body:", res.body);

    expect(res.body).toMatchObject({
      query_id: expect.any(String),
      plan: basePlan,
      poly: validExecuteBody.poly,
      viz_hint: "map",
      resolved_location: "Cambridge, Cambridgeshire, England",
      count: expect.any(Number),
      months_fetched: expect.any(Array),
      results: expect.any(Array),
    });
  });

  it("bar chart results are grouped by month not raw rows", async () => {
    // The bar chart path groups rows by month and returns { month, count }
    // entries — not raw rows capped at 100.
    const crimes = Array.from({ length: 150 }, (_, i) => ({
      id: i,
      category: "burglary",
      month: i < 75 ? "2024-01" : "2024-02",
    }));
    mockFetchCrimes.mockResolvedValue(crimes);
    mockPrisma.crimeResult.findMany.mockResolvedValue(crimes);
    const app = buildApp();
    const res = await request(app)
      .post("/query/execute")
      .send({ ...validExecuteBody, viz_hint: "bar" });
    // Should return one entry per month, not 150 raw rows
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
      ...basePlan,
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
    mockPrisma.crimeResult.findMany.mockResolvedValue([{ id: "r1" }]);
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
  it("returns 400 with unsupported_region when country_code has no adapter", async () => {
    mockGetDomainForQuery.mockReturnValue(undefined);
    const app = buildApp();
    const res = await request(app)
      .post("/query/execute")
      .send({ ...validExecuteBody, country_code: "US" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("unsupported_region");
    expect(res.body.country_code).toBe("US");
  });

  it("returns country_code from geocoder in parse payload", async () => {
    const app = buildApp();
    const res = await request(app)
      .post("/query/parse")
      .send({ text: "burglaries in Cambridge" });
    expect(res.body.country_code).toBe("GB");
  });

  it("returns undefined intent when classifier confidence is below threshold", async () => {
    const app = buildApp();
    const res = await request(app)
      .post("/query/parse")
      .send({ text: "burglaries in Cambridge" });
    // keyword matching removed — classifier mock returns confidence: 0
    // so intent falls through to undefined rather than defaulting to "crime"
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

describe("shadow adapter recovery storage", () => {
  const shadowRows = [
    { category: "burglary", month: "2024-01", latitude: 52.2, longitude: 0.7 },
  ];
  const shadowResult = {
    data: shadowRows,
    fallback: {
      field: "location" as const,
      original: "Bury St Edmunds",
      used: "Bury St Edmunds",
      explanation: "Shadow source used",
    },
    newSource: {
      sourceUrl: "https://data.gov.uk/bury-crimes.csv",
      providerType: "csv",
      confidence: 0.7,
    },
  };

  beforeEach(() => {
    mockFetchCrimes.mockResolvedValue([]);
    mockShadowAdapter.isEnabled.mockReturnValue(true);
    mockShadowAdapter.recover.mockResolvedValue(shadowResult);
  });

  it("writes shadow rows to queryResult.createMany, not adapter.storeResults", async () => {
    const app = buildApp();
    await request(app).post("/query/execute").send(validExecuteBody);
    expect(mockPrisma.queryResult.createMany).toHaveBeenCalled();
    expect(mockStoreResults).not.toHaveBeenCalled();
  });

  it("response includes fallback status when shadow data is used", async () => {
    const app = buildApp();
    const res = await request(app)
      .post("/query/execute")
      .send(validExecuteBody);
    expect(res.status).toBe(200);
    expect(res.body.resultContext.status).toBe("fallback");
  });

  it("shadow storage rows include query_id", async () => {
    const app = buildApp();
    await request(app).post("/query/execute").send(validExecuteBody);
    expect(mockPrisma.queryResult.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([
          expect.objectContaining({ query_id: "test-id" }),
        ]),
      }),
    );
  });

  it("shadow storage parses string latitude and longitude to numbers", async () => {
    mockShadowAdapter.recover.mockResolvedValue({
      ...shadowResult,
      data: [
        {
          category: "burglary",
          month: "2024-01",
          latitude: "52.2",
          longitude: "0.7",
        },
      ],
    });
    const app = buildApp();
    await request(app).post("/query/execute").send(validExecuteBody);
    expect(mockPrisma.queryResult.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([
          expect.objectContaining({ lat: 52.2, lon: 0.7 }),
        ]),
      }),
    );
  });

  it("does not write to queryCache for shadow-recovered results", async () => {
    const app = buildApp();
    await request(app).post("/query/execute").send(validExecuteBody);
    expect(mockPrisma.queryCache.create).not.toHaveBeenCalled();
  });
});
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
