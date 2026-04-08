/**
 * source-url-routing.test.ts
 *
 * Pipeline tests for curated source URL resolution in the execute handler.
 * Covers both REST sources (static URL) and scrape sources (SerpAPI-resolved URL).
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
const { mockFindCuratedSource } = vi.hoisted(() => ({
  mockFindCuratedSource: vi.fn(),
}));
const { mockRestProviderCreate } = vi.hoisted(() => ({
  mockRestProviderCreate: vi.fn(),
}));
const { mockScrapeProviderCreate } = vi.hoisted(() => ({
  mockScrapeProviderCreate: vi.fn(),
}));
const { mockResolveUrlForQuery } = vi.hoisted(() => ({
  mockResolveUrlForQuery: vi.fn(),
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
  resolveLocationSlug: vi.fn(),
  CURATED_SOURCES: [],
}));
vi.mock("../providers/rest-provider", () => ({
  createRestProvider: mockRestProviderCreate,
  restGet: vi.fn(),
}));
vi.mock("../providers/scrape-provider", () => ({
  createScrapeProvider: mockScrapeProviderCreate,
}));
vi.mock("../agent/search/serp", () => ({
  searchWithSerp: vi.fn().mockResolvedValue([]),
  resolveUrlForQuery: mockResolveUrlForQuery,
}));
vi.mock("../enrichment/source-tag", () => ({
  tagRows: vi.fn((rows: unknown[]) => rows),
}));
vi.mock("../enrichment/source-scoring", () => ({
  scoreSource: vi.fn().mockReturnValue(0.9),
}));

// ── Fixtures ──────────────────────────────────────────────────────────────────

const basePlan = {
  category: "cinema listings",
  date_from: "2026-04",
  date_to: "2026-04",
  location: "Sheffield, UK",
};

const executeBody = {
  plan: basePlan,
  poly: "53.3,-1.6:53.3,-1.4:53.5,-1.4:53.5,-1.6",
  viz_hint: "table" as const,
  resolved_location: "Sheffield, South Yorkshire, England, United Kingdom",
  country_code: "GB",
  intent: "cinema listings",
  months: ["2026-04"],
};

/** Scrape source that uses SerpAPI URL resolution */
const cinemaSource = {
  intent: "cinema listings",
  countryCodes: ["GB"],
  name: "cinema-listings-gb",
  type: "scrape" as const,
  searchStrategy: {
    queryTemplate: "{intent} {location}",
    preferredDomains: ["odeon.co.uk", "myvue.com", "cineworld.co.uk"],
  },
  extractionPrompt:
    "Find all movie titles currently showing on this cinema page.",
  storeResults: false,
  refreshPolicy: "realtime" as const,
  fieldMap: { title: "description" },
};

/** Plain REST source — static URL, no resolution needed */
const plainSource = {
  intent: "flood risk",
  countryCodes: ["GB"],
  name: "EA Flood Monitoring",
  url: "https://environment.data.gov.uk/flood-monitoring/id/floods",
  type: "rest" as const,
  storeResults: true,
  refreshPolicy: "daily" as const,
  fieldMap: { description: "description" },
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
  mockScrapeProviderCreate.mockReturnValue({
    fetchRows: vi.fn().mockResolvedValue([]),
  });
  mockResolveUrlForQuery.mockResolvedValue(null);
  mockParseIntent.mockResolvedValue(basePlan);
  mockDeriveVizHint.mockReturnValue("table");
  mockExpandDateRange.mockReturnValue(["2026-04"]);
  mockGeocodeToPolygon.mockResolvedValue({
    poly: "53.3,-1.6:53.3,-1.4:53.5,-1.4:53.5,-1.6",
    display_name: "Sheffield, South Yorkshire, England, United Kingdom",
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

describe("query pipeline — curated source URL resolution", () => {
  describe("scrape source with searchStrategy", () => {
    it("calls resolveUrlForQuery with the query built from template + resolved location", async () => {
      mockFindCuratedSource.mockReturnValue(cinemaSource);
      mockResolveUrlForQuery.mockResolvedValue("https://www.odeon.co.uk/cinemas/sheffield/");

      const app = buildApp();
      await request(app).post("/query/execute").send(executeBody);

      expect(mockResolveUrlForQuery).toHaveBeenCalledWith(
        "cinema listings Sheffield, South Yorkshire, England, United Kingdom",
        cinemaSource.searchStrategy.preferredDomains,
      );
    });

    it("calls createScrapeProvider with the URL returned by resolveUrlForQuery", async () => {
      mockFindCuratedSource.mockReturnValue(cinemaSource);
      mockResolveUrlForQuery.mockResolvedValue("https://www.odeon.co.uk/cinemas/sheffield/");

      const app = buildApp();
      await request(app).post("/query/execute").send(executeBody);

      expect(mockScrapeProviderCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          extractionPrompt: cinemaSource.extractionPrompt,
        }),
      );
    });

    it("returns empty rows and does not call scrapeProvider when resolveUrlForQuery returns null", async () => {
      mockFindCuratedSource.mockReturnValue(cinemaSource);
      mockResolveUrlForQuery.mockResolvedValue(null);

      const app = buildApp();
      const res = await request(app).post("/query/execute").send(executeBody);

      expect(mockScrapeProviderCreate).not.toHaveBeenCalled();
      expect(res.status).toBe(200);
    });

    it("falls back to country name when resolved_location is empty", async () => {
      mockFindCuratedSource.mockReturnValue(cinemaSource);
      mockResolveUrlForQuery.mockResolvedValue("https://www.odeon.co.uk/");

      const bodyNoLocation = { ...executeBody, resolved_location: "" };
      const app = buildApp();
      await request(app).post("/query/execute").send(bodyNoLocation);

      expect(mockResolveUrlForQuery).toHaveBeenCalledWith(
        expect.stringContaining("UK"),
        cinemaSource.searchStrategy.preferredDomains,
      );
    });
  });

  describe("REST source with static URL", () => {
    it("uses the URL from the source directly without calling resolveUrlForQuery", async () => {
      mockFindCuratedSource.mockReturnValue(plainSource);

      const app = buildApp();
      await request(app).post("/query/execute").send(executeBody);

      expect(mockResolveUrlForQuery).not.toHaveBeenCalled();
      expect(mockRestProviderCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          url: "https://environment.data.gov.uk/flood-monitoring/id/floods",
        }),
      );
    });
  });
});
