/**
 * clarification.test.ts — Phase D.1
 *
 * Tests for buildClarificationRequest() and requiresClarification().
 * Also tests the /execute endpoint returning type: "clarification".
 */

import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";
import express from "express";
import request from "supertest";
import type { Router } from "express";

// ── Unit tests (no HTTP) ──────────────────────────────────────────────────────

import { buildClarificationRequest, requiresClarification } from "../clarification";

describe("buildClarificationRequest", () => {
  it("returns null for a plain data query", () => {
    expect(buildClarificationRequest("crime statistics")).toBeNull();
    expect(buildClarificationRequest("flood risk")).toBeNull();
    expect(buildClarificationRequest("cinema listings")).toBeNull();
    expect(buildClarificationRequest("weather forecast")).toBeNull();
  });

  it("matches hunting licence (UK spelling)", () => {
    const req = buildClarificationRequest("hunting licence");
    expect(req).not.toBeNull();
    expect(req!.intent).toMatch(/hunting/i);
    expect(req!.questions.length).toBeGreaterThan(0);
  });

  it("matches hunting license (US spelling)", () => {
    expect(buildClarificationRequest("hunting license")).not.toBeNull();
  });

  it("matches natural language phrasings", () => {
    expect(buildClarificationRequest("how do I get a hunting licence for deer")).not.toBeNull();
    expect(buildClarificationRequest("deer stalking licence application")).not.toBeNull();
  });

  it("hunting questions include age, residency, and game species", () => {
    const req = buildClarificationRequest("hunting licence")!;
    const fields = req.questions.map((q) => q.field);
    expect(fields).toContain("age");
    expect(fields).toContain("residency");
    expect(fields).toContain("game_species");
  });

  it("matches food business registration", () => {
    const req = buildClarificationRequest("food business registration");
    expect(req).not.toBeNull();
    expect(req!.questions.some((q) => q.field === "business_type")).toBe(true);
  });

  it("matches planning permission", () => {
    const req = buildClarificationRequest("planning permission for extension");
    expect(req).not.toBeNull();
    expect(req!.questions.some((q) => q.field === "development_type")).toBe(true);
  });

  it("all question fields have prompt, input_type, and target", () => {
    const req = buildClarificationRequest("hunting licence")!;
    for (const q of req.questions) {
      expect(typeof q.prompt).toBe("string");
      expect(["text", "number", "select", "boolean"]).toContain(q.input_type);
      expect(["active_filters", "user_attributes"]).toContain(q.target);
    }
  });

  it("select questions have non-empty options array", () => {
    const req = buildClarificationRequest("hunting licence")!;
    for (const q of req.questions.filter((q) => q.input_type === "select")) {
      expect(Array.isArray(q.options)).toBe(true);
      expect(q.options!.length).toBeGreaterThan(0);
    }
  });
});

describe("requiresClarification", () => {
  it("returns true for regulatory intents", () => {
    expect(requiresClarification("hunting licence")).toBe(true);
    expect(requiresClarification("food business registration")).toBe(true);
    expect(requiresClarification("planning permission")).toBe(true);
  });

  it("returns false for data query intents", () => {
    expect(requiresClarification("crime statistics")).toBe(false);
    expect(requiresClarification("flood risk")).toBe(false);
    expect(requiresClarification("cinemas")).toBe(false);
    expect(requiresClarification("unknown")).toBe(false);
  });
});

// ── /execute endpoint — clarification response ────────────────────────────────

const { mockParseIntent, mockDeriveVizHint, mockExpandDateRange } = vi.hoisted(() => ({
  mockParseIntent:     vi.fn(),
  mockDeriveVizHint:   vi.fn(),
  mockExpandDateRange: vi.fn(),
}));
const { mockGetDomainForQuery } = vi.hoisted(() => ({ mockGetDomainForQuery: vi.fn() }));
const { mockGeocodeToPolygon }  = vi.hoisted(() => ({ mockGeocodeToPolygon: vi.fn() }));
const { mockEvolveSchema }      = vi.hoisted(() => ({ mockEvolveSchema: vi.fn() }));
const { mockAcquire }           = vi.hoisted(() => ({ mockAcquire: vi.fn() }));
const { mockCreateSnapshot }    = vi.hoisted(() => ({ mockCreateSnapshot: vi.fn() }));
const { mockShadowAdapter }     = vi.hoisted(() => ({ mockShadowAdapter: { isEnabled: vi.fn(), recover: vi.fn() } }));
const { mockDomainDiscovery }   = vi.hoisted(() => ({ mockDomainDiscovery: { isEnabled: vi.fn(), run: vi.fn() } }));
const { mockClassifyIntent }    = vi.hoisted(() => ({ mockClassifyIntent: vi.fn() }));
const { mockFindCuratedSource } = vi.hoisted(() => ({ mockFindCuratedSource: vi.fn() }));
const { mockPrisma }            = vi.hoisted(() => ({
  mockPrisma: {
    query:           { create: vi.fn(), findUnique: vi.fn() },
    queryResult:     { findMany: vi.fn(), createMany: vi.fn() },
    queryCache:      { findUnique: vi.fn(), create: vi.fn(), delete: vi.fn() },
    queryJob:        { create: vi.fn(), update: vi.fn() },
    queryRun:        { create: vi.fn(), update: vi.fn() },
    datasetSnapshot: { create: vi.fn() },
    apiAvailability: { upsert: vi.fn() },
    dataSource:      { findMany: vi.fn(), update: vi.fn() },
    $queryRaw:       vi.fn(),
  },
}));

vi.mock("../intent",                  () => ({ parseIntent: mockParseIntent, deriveVizHint: mockDeriveVizHint, expandDateRange: mockExpandDateRange }));
vi.mock("../geocoder",                () => ({ geocodeToPolygon: mockGeocodeToPolygon }));
vi.mock("../schema",                  () => ({ evolveSchema: mockEvolveSchema }));
vi.mock("../db",                      () => ({ prisma: mockPrisma }));
vi.mock("../domains/registry",        () => ({ getDomainForQuery: mockGetDomainForQuery }));
vi.mock("../rateLimiter",             () => ({ acquire: mockAcquire }));
vi.mock("../execution-model",         () => ({ createSnapshot: mockCreateSnapshot }));
vi.mock("../agent/shadow-adapter",    () => ({ shadowAdapter: mockShadowAdapter }));
vi.mock("../agent/domain-discovery",  () => ({ domainDiscovery: mockDomainDiscovery }));
vi.mock("../semantic/classifier",     () => ({ classifyIntent: mockClassifyIntent }));
vi.mock("../curated-registry",        () => ({ findCuratedSource: mockFindCuratedSource, resolveLocationSlug: vi.fn(), CURATED_SOURCES: [] }));
vi.mock("../providers/rest-provider", () => ({ createRestProvider: vi.fn(), restGet: vi.fn() }));
vi.mock("../enrichment/source-tag",   () => ({ tagRows: vi.fn((rows: unknown[]) => rows) }));
vi.mock("../enrichment/source-scoring", () => ({ scoreSource: vi.fn().mockReturnValue(0.9) }));
vi.mock("../agent/search/serp",       () => ({ searchWithSerp: vi.fn().mockResolvedValue([]), resolveUrlForQuery: vi.fn().mockResolvedValue(null) }));
vi.mock("../agent/search/scrape-url-cache", () => ({ getCachedScrapeUrl: vi.fn().mockResolvedValue(null), setCachedScrapeUrl: vi.fn() }));

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

const basePlan = { category: "hunting licence", date_from: "2026-04", date_to: "2026-04", location: "UK" };
const executeBody = {
  plan:              basePlan,
  poly:              "",
  viz_hint:          "table" as const,
  resolved_location: "United Kingdom",
  country_code:      "GB",
  intent:            "hunting licence",
  months:            ["2026-04"],
  rawText:           "how do I get a hunting licence",
};

describe("POST /execute — clarification response", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockParseIntent.mockResolvedValue(basePlan);
    mockDeriveVizHint.mockReturnValue("table");
    mockExpandDateRange.mockReturnValue(["2026-04"]);
    mockGeocodeToPolygon.mockResolvedValue({ poly: "", display_name: "UK", country_code: "GB" });
    mockAcquire.mockResolvedValue(undefined);
    mockShadowAdapter.isEnabled.mockReturnValue(false);
    mockDomainDiscovery.isEnabled.mockReturnValue(false);
    mockClassifyIntent.mockResolvedValue({ confidence: 0, domain: null, intent: null });
    mockGetDomainForQuery.mockReturnValue(undefined);
    mockFindCuratedSource.mockReturnValue(null);
    mockPrisma.query.create.mockResolvedValue({ id: "q-1", ...basePlan });
    mockPrisma.query.findUnique.mockResolvedValue(null);
    mockPrisma.queryCache.findUnique.mockResolvedValue(null);
    mockPrisma.queryJob.create.mockResolvedValue({ id: "job-1" });
    mockPrisma.queryRun.create.mockResolvedValue({ id: "run-1" });
    mockPrisma.dataSource.findMany.mockResolvedValue([]);
    mockPrisma.$queryRaw.mockResolvedValue([]);
  });

  it("returns type: clarification for hunting licence intent", async () => {
    const app = buildApp();
    const res = await request(app).post("/query/execute").send(executeBody);
    expect(res.status).toBe(200);
    expect(res.body.type).toBe("clarification");
  });

  it("includes the ClarificationRequest in the response", async () => {
    const app = buildApp();
    const res = await request(app).post("/query/execute").send(executeBody);
    expect(res.body.request).toBeDefined();
    expect(res.body.request.intent).toMatch(/hunting/i);
    expect(Array.isArray(res.body.request.questions)).toBe(true);
    expect(res.body.request.questions.length).toBeGreaterThan(0);
  });

  it("does NOT call getDomainForQuery for clarification intents", async () => {
    const app = buildApp();
    await request(app).post("/query/execute").send(executeBody);
    expect(mockGetDomainForQuery).not.toHaveBeenCalled();
  });

  it("data queries bypass clarification and proceed normally", async () => {
    const crimeBody = { ...executeBody, intent: "crime statistics", rawText: "crime in Cambridge", plan: { ...basePlan, category: "crime statistics" } };
    const app = buildApp();
    const res = await request(app).post("/query/execute").send(crimeBody);
    // Will reach the normal flow (not_supported since no adapter) — NOT clarification
    expect(res.body.type).not.toBe("clarification");
  });
});
