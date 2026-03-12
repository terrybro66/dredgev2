import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

const { mockParseIntent, mockDeriveVizHint, mockExpandDateRange } = vi.hoisted(
  () => ({
    mockParseIntent: vi.fn(),
    mockDeriveVizHint: vi.fn(),
    mockExpandDateRange: vi.fn(),
  }),
);

const { mockFetchCrimes } = vi.hoisted(() => ({ mockFetchCrimes: vi.fn() }));
const { mockStoreResults } = vi.hoisted(() => ({ mockStoreResults: vi.fn() }));
const { mockGeocodeToPolygon } = vi.hoisted(() => ({
  mockGeocodeToPolygon: vi.fn(),
}));
const { mockEvolveSchema } = vi.hoisted(() => ({ mockEvolveSchema: vi.fn() }));
const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    query: {
      create: vi.fn(),
      findUnique: vi.fn(),
    },
  },
}));

vi.mock("../crime/intent", () => ({
  parseIntent: mockParseIntent,
  deriveVizHint: mockDeriveVizHint,
  expandDateRange: mockExpandDateRange,
}));
vi.mock("../crime/fetcher", () => ({ fetchCrimes: mockFetchCrimes }));
vi.mock("../crime/store", () => ({ storeResults: mockStoreResults }));
vi.mock("../geocoder", () => ({ geocodeToPolygon: mockGeocodeToPolygon }));
vi.mock("../schema", () => ({ evolveSchema: mockEvolveSchema }));
vi.mock("../db", () => ({ prisma: mockPrisma }));

const basePlan = {
  category: "burglary",
  date_from: "2024-01",
  date_to: "2024-01",
  location: "Cambridge, UK",
};

async function buildApp() {
  vi.resetModules();
  const { queryRouter } = await import("../query");
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
  });
  mockFetchCrimes.mockResolvedValue([]);
  mockStoreResults.mockResolvedValue(undefined);
  mockEvolveSchema.mockResolvedValue(undefined);
  mockPrisma.query.create.mockResolvedValue({ id: "test-id", ...basePlan });
  mockPrisma.query.findUnique.mockResolvedValue(null);
});

// ── POST /parse ───────────────────────────────────────────────────────────────

describe("POST /query/parse", () => {
  it("returns 400 when text field is missing", async () => {
    const app = await buildApp();
    const res = await request(app).post("/query/parse").send({});
    expect(res.status).toBe(400);
  });

  it("returns 400 when text is an empty string", async () => {
    const app = await buildApp();
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
    const app = await buildApp();
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
    const app = await buildApp();
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
    const app = await buildApp();
    const res = await request(app)
      .post("/query/parse")
      .send({ text: "burglaries in nowhere" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("geocode_failed");
  });

  it("returns confirmation payload with plan, poly, viz_hint, resolved_location, months", async () => {
    const app = await buildApp();
    const res = await request(app)
      .post("/query/parse")
      .send({ text: "burglaries in Cambridge" });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      plan: basePlan,
      poly: expect.any(String),
      viz_hint: "map",
      resolved_location: "Cambridge, Cambridgeshire, England",
      months: ["2024-01"],
    });
  });

  it("does not write to the database", async () => {
    const app = await buildApp();
    await request(app)
      .post("/query/parse")
      .send({ text: "burglaries in Cambridge" });
    expect(mockPrisma.query.create).not.toHaveBeenCalled();
  });

  it("does not call fetchCrimes", async () => {
    const app = await buildApp();
    await request(app)
      .post("/query/parse")
      .send({ text: "burglaries in Cambridge" });
    expect(mockFetchCrimes).not.toHaveBeenCalled();
  });

  it("viz_hint is derived, not from LLM", async () => {
    mockDeriveVizHint.mockReturnValue("bar");
    const app = await buildApp();
    const res = await request(app)
      .post("/query/parse")
      .send({ text: "burglaries in Cambridge" });
    expect(res.body.viz_hint).toBe("bar");
    expect(mockDeriveVizHint).toHaveBeenCalled();
  });

  it("resolved_location reflects geocoder display_name", async () => {
    const app = await buildApp();
    const res = await request(app)
      .post("/query/parse")
      .send({ text: "burglaries in Cambridge" });
    expect(res.body.resolved_location).toBe(
      "Cambridge, Cambridgeshire, England",
    );
  });

  it("months array is correctly expanded from date range", async () => {
    mockExpandDateRange.mockReturnValue(["2024-01", "2024-02", "2024-03"]);
    const app = await buildApp();
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
};

describe("POST /query/execute", () => {
  it("returns 400 when body is missing required fields", async () => {
    const app = await buildApp();
    const res = await request(app).post("/query/execute").send({});
    expect(res.status).toBe(400);
  });

  it("creates Query record with domain: crime", async () => {
    const app = await buildApp();
    await request(app).post("/query/execute").send(validExecuteBody);
    expect(mockPrisma.query.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ domain: "crime" }),
      }),
    );
  });

  it("stores resolved_location on Query record", async () => {
    const app = await buildApp();
    await request(app).post("/query/execute").send(validExecuteBody);
    expect(mockPrisma.query.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          resolved_location: "Cambridge, Cambridgeshire, England",
        }),
      }),
    );
  });

  it("calls fetchCrimes with the poly from the request body", async () => {
    const app = await buildApp();
    await request(app).post("/query/execute").send(validExecuteBody);
    expect(mockFetchCrimes).toHaveBeenCalledWith(
      basePlan,
      validExecuteBody.poly,
    );
  });

  it("calls evolveSchema with crime_results and crime when crimes returned", async () => {
    mockFetchCrimes.mockResolvedValue([
      { category: "burglary", month: "2024-01" },
    ]);
    const app = await buildApp();
    await request(app).post("/query/execute").send(validExecuteBody);
    expect(mockEvolveSchema).toHaveBeenCalledWith(
      expect.anything(),
      "crime_results",
      expect.anything(),
      expect.any(String),
      "crime",
    );
  });

  it("does not call evolveSchema when crimes array is empty", async () => {
    mockFetchCrimes.mockResolvedValue([]);
    const app = await buildApp();
    await request(app).post("/query/execute").send(validExecuteBody);
    expect(mockEvolveSchema).not.toHaveBeenCalled();
  });

  it("response includes query_id, plan, poly, viz_hint, resolved_location, count, months_fetched, results", async () => {
    const app = await buildApp();
    const res = await request(app)
      .post("/query/execute")
      .send(validExecuteBody);
    expect(res.status).toBe(200);
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

  it("caps results at 100 items", async () => {
    const crimes = Array.from({ length: 150 }, (_, i) => ({
      id: i,
      category: "burglary",
    }));
    mockFetchCrimes.mockResolvedValue(crimes);
    const app = await buildApp();
    const res = await request(app)
      .post("/query/execute")
      .send(validExecuteBody);
    expect(res.body.results).toHaveLength(100);
  });

  it("returns 500 when fetchCrimes throws", async () => {
    mockFetchCrimes.mockRejectedValue(new Error("API down"));
    const app = await buildApp();
    const res = await request(app)
      .post("/query/execute")
      .send(validExecuteBody);
    expect(res.status).toBe(500);
  });

  it("returns 500 when storeResults throws", async () => {
    mockFetchCrimes.mockResolvedValue([{ category: "burglary" }]);
    mockStoreResults.mockRejectedValue(new Error("DB error"));
    const app = await buildApp();
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
    const app = await buildApp();
    const res = await request(app).get("/query/nonexistent-id");
    expect(res.status).toBe(404);
  });

  it("returns query record with results included", async () => {
    mockPrisma.query.findUnique.mockResolvedValue({
      id: "test-id",
      ...basePlan,
      results: [{ id: "r1", category: "burglary" }],
    });
    const app = await buildApp();
    const res = await request(app).get("/query/test-id");
    expect(res.status).toBe(200);
    expect(res.body.results).toHaveLength(1);
  });
});
