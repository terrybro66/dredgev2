/**
 * source-url-routing.test.ts
 *
 * Pipeline tests for {location} placeholder resolution in the execute handler.
 * Uses mocked curated-registry so we can control what findCuratedSource returns.
 *
 * Run:
 *   pnpm vitest run src/__tests__/source-url-routing.test.ts --reporter=verbose
 */

import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";
import express from "express";
import request from "supertest";
import type { Router } from "express";

// ── Hoist mock factories ──────────────────────────────────────────────────────

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
const { mockEvolveSchema } = vi.hoisted(() => ({ mockEvolveSchema: vi.fn() }));
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
const { mockFindCuratedSource, mockResolveLocationSlug } = vi.hoisted(() => ({
  mockFindCuratedSource: vi.fn(),
  mockResolveLocationSlug: vi.fn(),
}));
const { mockRestProviderCreate } = vi.hoisted(() => ({
  mockRestProviderCreate: vi.fn(),
}));

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    query: { create: vi.fn(), findUnique: vi.fn() },
    queryResult: { findMany: vi.fn(), createMany: vi.fn() },
    queryCache: { findUnique: vi.fn(), create: vi.fn(), delete: vi.fn() },
    queryJob: { create: vi.fn(), update: vi.fn() },
    queryRun: { create: vi.fn(), update: vi.fn() },
    datasetSnapshot: { create: vi.fn() },
    apiAvailability: { upsert: vi.fn() },
    dataSource: { findMany: vi.fn(), update: vi.fn() },
    $queryRaw: vi.fn(),
  },
}));

vi.mock("../intent", () => ({
  parseIntent: mockParseIntent,
  deriveVizHint: mockDeriveVizHint,
  expandDateRange: mockExpandDateRange,
}));
vi.mock("../geocoder", () => ({ geocodeToPolygon: mockGeocodeToPolygon }));
vi.mock("../schema", () => ({ evolveSchema: mockEvolveSchema }));
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
vi.mock("../curated-registry", () => ({
  findCuratedSource: mockFindCuratedSource,
  resolveLocationSlug: mockResolveLocationSlug,
  CURATED_SOURCES: [],
}));
vi.mock("../providers/rest-provider", () => ({
  createRestProvider: mockRestProviderCreate,
  restGet: vi.fn(),
}));
vi.mock("../enrichment/source-tag", () => ({
  tagRows: vi.fn((rows: unknown[]) => rows),
}));
vi.mock("../enrichment/source-scoring", () => ({
  scoreSource: vi.fn().mockReturnValue(0.9),
}));

// ── Fixtures ──────────────────────────────────────────────────────────────────

const basePlan = {
  category: "burglary",
  date_from: "2025-01",
  date_to: "2025-01",
  location: "Braehead, UK",
};

const executeBody = {
  plan: basePlan,
  poly: "55.8,-4.4:55.8,-4.3:55.9,-4.3:55.9,-4.4",
  viz_hint: "table" as const,
  resolved_location: "Braehead, Renfrewshire, Scotland, United Kingdom",
  country_code: "GB",
  intent: "cinema listings",
  months: ["2025-01"],
};

const odeonSource = {
  intent: "cinema listings",
  countryCodes: ["GB"],
  name: "Odeon UK",
  url: "https://www.odeon.co.uk/cinemas/{location}/",
  type: "rest" as const,
  storeResults: false,
  refreshPolicy: "realtime" as const,
  fieldMap: { title: "description", showtime: "date" },
  locationSlugMap: {
    braehead: "braehead",
    glasgow: "glasgow-fort",
  },
};

const plainSource = {
  intent: "cinema listings",
  countryCodes: ["GB"],
  name: "Odeon UK",
  url: "https://www.odeon.co.uk/api/showtimes",
  type: "rest" as const,
  storeResults: false,
  refreshPolicy: "realtime" as const,
  fieldMap: { title: "description", showtime: "date" },
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

  mockRestProviderCreate.mockReturnValue({
    fetchRows: vi.fn().mockResolvedValue([]),
  });
  mockParseIntent.mockResolvedValue(basePlan);
  mockDeriveVizHint.mockReturnValue("table");
  mockExpandDateRange.mockReturnValue(["2025-01"]);
  mockGeocodeToPolygon.mockResolvedValue({
    poly: "55.8,-4.4:55.8,-4.3:55.9,-4.3:55.9,-4.4",
    display_name: "Braehead, Renfrewshire, Scotland, United Kingdom",
    country_code: "GB",
  });
  mockEvolveSchema.mockResolvedValue(undefined);
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
  mockGetDomainForQuery.mockReturnValue(undefined);
  mockFindCuratedSource.mockReturnValue(null);
  mockResolveLocationSlug.mockReturnValue(null);

  mockPrisma.query.create.mockResolvedValue({ id: "q-1", ...basePlan });
  mockPrisma.query.findUnique.mockResolvedValue(null);
  mockPrisma.queryResult.findMany.mockResolvedValue([]);
  mockPrisma.queryCache.findUnique.mockResolvedValue(null);
  mockPrisma.queryCache.create.mockResolvedValue({});
  mockPrisma.queryJob.create.mockResolvedValue({ id: "job-1" });
  mockPrisma.queryJob.update.mockResolvedValue({});
  mockPrisma.queryRun.create.mockResolvedValue({ id: "run-1" });
  mockPrisma.datasetSnapshot.create.mockResolvedValue({ id: "snap-1" });
  mockPrisma.dataSource.findMany.mockResolvedValue([]);
  mockPrisma.dataSource.update.mockResolvedValue({});
  mockPrisma.$queryRaw.mockResolvedValue([]);
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("query pipeline — {location} placeholder resolution", () => {
  it("resolves {location} placeholder in URL when slug map match is found", async () => {
    mockFindCuratedSource.mockReturnValue(odeonSource);
    mockResolveLocationSlug.mockReturnValue("braehead");

    const app = buildApp();
    await request(app).post("/query/execute").send(executeBody);

    expect(mockRestProviderCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "https://www.odeon.co.uk/cinemas/braehead/",
      }),
    );
  });

  it("calls resolveLocationSlug with resolved_location and locationSlugMap", async () => {
    mockFindCuratedSource.mockReturnValue(odeonSource);
    mockResolveLocationSlug.mockReturnValue("braehead");

    const app = buildApp();
    await request(app).post("/query/execute").send(executeBody);

    expect(mockResolveLocationSlug).toHaveBeenCalledWith(
      "Braehead, Renfrewshire, Scotland, United Kingdom",
      odeonSource.locationSlugMap,
    );
  });

  it("does not call the provider with an unresolved {location} template URL when no slug found", async () => {
    mockFindCuratedSource.mockReturnValue(odeonSource);
    mockResolveLocationSlug.mockReturnValue(null);

    const app = buildApp();
    await request(app).post("/query/execute").send(executeBody);

    expect(mockRestProviderCreate).not.toHaveBeenCalledWith(
      expect.objectContaining({
        url: expect.stringContaining("{location}"),
      }),
    );
  });

  it("sources without {location} in URL use the URL as-is", async () => {
    mockFindCuratedSource.mockReturnValue(plainSource);

    const app = buildApp();
    await request(app).post("/query/execute").send(executeBody);

    expect(mockRestProviderCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "https://www.odeon.co.uk/api/showtimes",
      }),
    );
  });

  it("does not call resolveLocationSlug for sources without a locationSlugMap", async () => {
    mockFindCuratedSource.mockReturnValue(plainSource);

    const app = buildApp();
    await request(app).post("/query/execute").send(executeBody);

    expect(mockResolveLocationSlug).not.toHaveBeenCalled();
  });
});
