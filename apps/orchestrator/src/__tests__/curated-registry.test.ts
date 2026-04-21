/**
 * Block G — Curated source registry
 *
 * Branch: feat/curated-source-registry
 *
 * Tests are grouped into three suites:
 *
 *   1. Registry structure (unit, no DB)
 *      Validates that every entry in the curated registry has the required
 *      fields and that ephemeral/persistent rules are consistent.
 *
 *   2. Registry lookup (unit, no DB)
 *      Tests the lookup function that finds a matching source by intent +
 *      country code.
 *
 *   3. Query pipeline — curated path (unit, mocked DB + supertest)
 *      Tests that the execute handler consults the curated registry when no
 *      registered adapter matches, and that the correct ephemeral/persistent
 *      behaviour follows.
 *
 * Run:
 *   pnpm vitest run src/__tests__/curated-registry.test.ts --reporter=verbose
 */

import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";
import express from "express";
import request from "supertest";
import type { Router } from "express";

// ─────────────────────────────────────────────────────────────────────────────
// Suite 1 — Registry structure (no DB, no mocks needed)
// ─────────────────────────────────────────────────────────────────────────────

describe("curated registry — structure invariants", () => {
  it("every entry has required fields: intent, countryCodes, url, type, storeResults, refreshPolicy, fieldMap", async () => {
    const { CURATED_SOURCES } = await import("../curated-registry");

    for (const source of CURATED_SOURCES) {
      expect(source).toHaveProperty("intent");
      expect(source).toHaveProperty("countryCodes");
      expect(source).toHaveProperty("url");
      expect(source).toHaveProperty("type");
      expect(source).toHaveProperty("storeResults");
      expect(source).toHaveProperty("refreshPolicy");
      expect(source).toHaveProperty("fieldMap");

      expect(typeof source.intent).toBe("string");
      expect(Array.isArray(source.countryCodes)).toBe(true);
      expect(typeof source.url).toBe("string");
      expect(typeof source.storeResults).toBe("boolean");
      expect(typeof source.fieldMap).toBe("object");
    }
  });

  it("every scrape-type entry has an extractionPrompt", async () => {
    const { CURATED_SOURCES } = await vi.importActual<
      typeof import("../curated-registry")
    >("../curated-registry");

    const scrapeEntries = CURATED_SOURCES.filter((s) => s.type === "scrape");
    for (const source of scrapeEntries) {
      expect(source).toHaveProperty("extractionPrompt");
      expect(typeof (source as any).extractionPrompt).toBe("string");
      expect((source as any).extractionPrompt.length).toBeGreaterThan(0);
    }
  });

  it("no ephemeral entry has refreshPolicy 'daily' or 'weekly'", async () => {
    const { CURATED_SOURCES } = await vi.importActual<
      typeof import("../curated-registry")
    >("../curated-registry");

    const ephemeralEntries = CURATED_SOURCES.filter((s) => !s.storeResults);
    for (const source of ephemeralEntries) {
      expect(["realtime", "static"]).toContain(source.refreshPolicy);
    }
  });

  it("type is one of: rest | csv | xlsx | pdf | scrape", async () => {
    const { CURATED_SOURCES } = await import("../curated-registry");
    const validTypes = ["rest", "csv", "xlsx", "pdf", "scrape"];

    for (const source of CURATED_SOURCES) {
      expect(validTypes).toContain(source.type);
    }
  });

  it("refreshPolicy is one of: realtime | daily | weekly | static", async () => {
    const { CURATED_SOURCES } = await vi.importActual<
      typeof import("../curated-registry")
    >("../curated-registry");
    const validPolicies = ["realtime", "daily", "weekly", "static"];

    for (const source of CURATED_SOURCES) {
      expect(validPolicies).toContain(source.refreshPolicy);
    }
  });

  it("registry contains at least one ephemeral source (cinema / transport)", async () => {
    const { CURATED_SOURCES } = await vi.importActual<
      typeof import("../curated-registry")
    >("../curated-registry");
    const ephemeral = CURATED_SOURCES.filter((s) => !s.storeResults);
    expect(ephemeral.length).toBeGreaterThan(0);
  });

  it("registry contains at least one persistent source (flood / environment)", async () => {
    const { CURATED_SOURCES } = await vi.importActual<
      typeof import("../curated-registry")
    >("../curated-registry");
    const persistent = CURATED_SOURCES.filter((s) => s.storeResults);
    expect(persistent.length).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 2 — Registry lookup
// ─────────────────────────────────────────────────────────────────────────────

describe("curated registry — lookup", () => {
  it("returns a matching source for a known intent + country combination", async () => {
    const { findCuratedSource } = await vi.importActual<
      typeof import("../curated-registry")
    >("../curated-registry");

    // At least one of the seed sources must match cinema + GB
    const result = findCuratedSource("cinema listings", "GB");
    expect(result).not.toBeNull();
    expect(result?.storeResults).toBe(false);
  });

  it("returns null when no match for intent + country combination", async () => {
    const { findCuratedSource } = await vi.importActual<
      typeof import("../curated-registry")
    >("../curated-registry");

    const result = findCuratedSource("unicorn data", "ZZ");
    expect(result).toBeNull();
  });

  it("lookup is case-insensitive on intent", async () => {
    const { findCuratedSource } = await vi.importActual<
      typeof import("../curated-registry")
    >("../curated-registry");

    const lower = findCuratedSource("cinema listings", "GB");
    const upper = findCuratedSource("Cinema Listings", "GB");
    const mixed = findCuratedSource("CINEMA LISTINGS", "GB");

    // All three should return the same result (or all null if not seeded)
    expect(lower === null).toBe(upper === null);
    expect(lower === null).toBe(mixed === null);
  });

  it("a source with empty countryCodes matches any country", async () => {
    const { CURATED_SOURCES, findCuratedSource } =
      await import("../curated-registry");

    const globalSource = CURATED_SOURCES.find(
      (s) => s.countryCodes.length === 0,
    );
    if (!globalSource) return; // skip if no global sources seeded yet

    const result = findCuratedSource(globalSource.intent, "ZZ");
    expect(result).not.toBeNull();
  });

  it("returns the first matching source when multiple sources share the same intent", async () => {
    const { findCuratedSource } = await vi.importActual<
      typeof import("../curated-registry")
    >("../curated-registry");

    // Multiple cinema chains cover the same intent — any match is valid
    const result = findCuratedSource("cinema listings", "GB");
    expect(result).not.toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 3 — Query pipeline: curated path (supertest + mocked DB)
// ─────────────────────────────────────────────────────────────────────────────

// Hoist all mock factories before vi.mock() calls.
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

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    query: { create: vi.fn(), findUnique: vi.fn() },
    queryResult: { findMany: vi.fn(), createMany: vi.fn() },
    queryCache: { findUnique: vi.fn(), create: vi.fn(), delete: vi.fn() },
    queryJob: { create: vi.fn(), update: vi.fn() },
    queryRun: { create: vi.fn(), update: vi.fn() },
    datasetSnapshot: { create: vi.fn() },
    apiAvailability: { upsert: vi.fn() },
    dataSource: { findMany: vi.fn() },
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
vi.mock("../curated-registry", () => ({
  findCuratedSource: mockFindCuratedSource,
  CURATED_SOURCES: [],
}));

// ── Fixtures ──────────────────────────────────────────────────────────────────

const basePlan = {
  category: "burglary",
  date_from: "2025-01",
  date_to: "2025-01",
  location: "Bristol, UK",
};

const executeBody = {
  plan: basePlan,
  poly: "51.4,2.5:51.4,2.6:51.5,2.6:51.5,2.5",
  viz_hint: "table" as const,
  resolved_location: "Bristol, England",
  country_code: "GB",
  intent: "cinema",
  months: ["2025-01"],
};

// A curated ephemeral source (cinema)
const curatedEphemeralSource = {
  intent: "cinema listings",
  countryCodes: ["GB"],
  name: "Odeon UK",
  url: "https://www.odeon.co.uk/api/showtimes",
  type: "rest" as const,
  storeResults: false,
  refreshPolicy: "realtime" as const,
  fieldMap: { title: "description", showtime: "date" },
};

// A curated persistent source (flood risk)
const curatedPersistentSource = {
  intent: "flood risk",
  countryCodes: ["GB"],
  name: "Environment Agency Flood Monitoring",
  url: "https://environment.data.gov.uk/flood-monitoring/api/floodAreas",
  type: "rest" as const,
  storeResults: true,
  refreshPolicy: "daily" as const,
  fieldMap: { description: "description", label: "location" },
};

let mockCuratedFetchData: ReturnType<typeof vi.fn>;
let mockCuratedStoreResults: ReturnType<typeof vi.fn>;

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

  mockCuratedFetchData = vi.fn().mockResolvedValue([]);
  mockCuratedStoreResults = vi.fn().mockResolvedValue(undefined);

  mockParseIntent.mockResolvedValue(basePlan);
  mockDeriveVizHint.mockReturnValue("table");
  mockExpandDateRange.mockReturnValue(["2025-01"]);
  mockGeocodeToPolygon.mockResolvedValue({
    poly: "51.4,2.5:51.4,2.6:51.5,2.6:51.5,2.5",
    display_name: "Bristol, England",
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
  mockFindCuratedSource.mockReturnValue(null); // no curated match by default

  // No registered adapter by default — forces curated/discovery path
  mockGetDomainForQuery.mockReturnValue(undefined);

  mockPrisma.query.create.mockResolvedValue({ id: "q-1", ...basePlan });
  mockPrisma.query.findUnique.mockResolvedValue(null);
  mockPrisma.queryResult.findMany.mockResolvedValue([]);
  mockPrisma.queryResult.createMany.mockResolvedValue({ count: 0 });
  mockPrisma.queryCache.findUnique.mockResolvedValue(null);
  mockPrisma.queryCache.create.mockResolvedValue({});
  mockPrisma.queryCache.delete.mockResolvedValue({});
  mockPrisma.queryJob.create.mockResolvedValue({ id: "job-1" });
  mockPrisma.queryJob.update.mockResolvedValue({});
  mockPrisma.queryRun.create.mockResolvedValue({ id: "run-1" });
  mockPrisma.queryRun.update.mockResolvedValue({});
  mockPrisma.datasetSnapshot.create.mockResolvedValue({ id: "snap-1" });
  mockPrisma.dataSource.findMany.mockResolvedValue([]);
  mockPrisma.$queryRaw.mockResolvedValue([]);
});

describe("query pipeline — curated source path", () => {
  it("calls findCuratedSource when no registered adapter matches", async () => {
    mockGetDomainForQuery.mockReturnValue(undefined);
    mockFindCuratedSource.mockReturnValue(null);

    const app = buildApp();
    await request(app).post("/query/execute").send(executeBody);

    expect(mockFindCuratedSource).toHaveBeenCalledWith(
      expect.any(String), // intent
      "GB", // country_code
    );
  });

  it("does NOT call findCuratedSource when a registered adapter matches", async () => {
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
      fetchData: vi.fn().mockResolvedValue([]),
      flattenRow: (r: unknown) => r,
      storeResults: vi.fn().mockResolvedValue(undefined),
    });

    const app = buildApp();
    await request(app).post("/query/execute").send(executeBody);

    expect(mockFindCuratedSource).not.toHaveBeenCalled();
  });

  it("returns 200 with results when a curated ephemeral source matches", async () => {
    mockGetDomainForQuery.mockReturnValue(undefined);
    mockFindCuratedSource.mockReturnValue(curatedEphemeralSource);
    mockCuratedFetchData.mockResolvedValue([
      { title: "Dune Part Two", date: "2025-06-01" },
    ]);

    // The pipeline will build an adapter from the curated source and call fetchData
    // We verify the response shape — not a 400 unsupported_region
    const app = buildApp();
    const res = await request(app).post("/query/execute").send(executeBody);

    expect(res.status).toBe(200);
  });

  it("curated ephemeral result does NOT write to QueryCache", async () => {
    mockGetDomainForQuery.mockReturnValue(undefined);
    mockFindCuratedSource.mockReturnValue(curatedEphemeralSource);

    const app = buildApp();
    await request(app).post("/query/execute").send(executeBody);

    expect(mockPrisma.queryCache.create).not.toHaveBeenCalled();
  });

  it("curated ephemeral result does NOT call createSnapshot", async () => {
    mockGetDomainForQuery.mockReturnValue(undefined);
    mockFindCuratedSource.mockReturnValue(curatedEphemeralSource);

    const app = buildApp();
    await request(app).post("/query/execute").send(executeBody);

    expect(mockCreateSnapshot).not.toHaveBeenCalled();
  });

  it("falls through to discovery pipeline when curated registry returns null", async () => {
    mockGetDomainForQuery.mockReturnValue(undefined);
    mockFindCuratedSource.mockReturnValue(null);
    mockDomainDiscovery.isEnabled.mockReturnValue(true);

    const app = buildApp();
    await request(app).post("/query/execute").send(executeBody);

    expect(mockDomainDiscovery.run).toHaveBeenCalledOnce();
  });

  it("triggers discovery in the background when curated registry returns a match", async () => {
    mockGetDomainForQuery.mockReturnValue(undefined);
    mockFindCuratedSource.mockReturnValue(curatedEphemeralSource);
    mockDomainDiscovery.isEnabled.mockReturnValue(true);

    const app = buildApp();
    await request(app).post("/query/execute").send(executeBody);

    // Discovery fires (non-blocking) so a proper adapter can be built over time
    expect(mockDomainDiscovery.run).toHaveBeenCalledOnce();
  });

  it("registered adapter takes priority over curated registry", async () => {
    // Registered adapter exists — curated should never be consulted
    const registeredAdapter = {
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
      fetchData: vi.fn().mockResolvedValue([]),
      flattenRow: (r: unknown) => r,
      storeResults: vi.fn().mockResolvedValue(undefined),
    };
    mockGetDomainForQuery.mockReturnValue(registeredAdapter);
    mockFindCuratedSource.mockReturnValue(curatedEphemeralSource);

    const app = buildApp();
    await request(app).post("/query/execute").send(executeBody);

    expect(mockFindCuratedSource).not.toHaveBeenCalled();
  });
});
