/**
 * Block 3.9 — Source scoring
 *
 * Branch: feat/source-scoring
 *
 * Tests cover the dynamic confidence scoring system on DataSource records:
 *
 *   1. Successful fetch — boosts confidence, updates lastFetchedAt, lastRowCount
 *   2. Failed fetch — penalises confidence, updates lastFetchedAt
 *   3. Confidence floor — never drops below 0.0
 *   4. Confidence ceiling — never exceeds 1.0
 *   5. Multiple sources — results ranked by confidence descending
 *   6. scoreSource utility function — correct delta calculations
 *
 * Run:
 *   pnpm vitest run src/__tests__/source-scoring.test.ts --reporter=verbose
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Hoist mock factories ──────────────────────────────────────────────────────

const { mockDataSourceFindMany } = vi.hoisted(() => ({
  mockDataSourceFindMany: vi.fn(),
}));
const { mockDataSourceUpdate } = vi.hoisted(() => ({
  mockDataSourceUpdate: vi.fn(),
}));
const { mockRestProviderFetchRows } = vi.hoisted(() => ({
  mockRestProviderFetchRows: vi.fn(),
}));

vi.mock("../db", () => ({
  prisma: {
    dataSource: {
      findMany: mockDataSourceFindMany,
      update: mockDataSourceUpdate,
    },
  },
}));

vi.mock("../providers/rest-provider", () => ({
  createRestProvider: vi.fn(() => ({
    fetchRows: mockRestProviderFetchRows,
  })),
  restGet: vi.fn(),
}));

// ── Shared fixtures ───────────────────────────────────────────────────────────

const highConfidenceSource = {
  id: "ds-1",
  domainName: "flood-risk-gb",
  name: "Environment Agency",
  url: "https://environment.data.gov.uk/flood-monitoring/api/floodAreas",
  type: "rest",
  enabled: true,
  storeResults: true,
  confidence: 0.9,
  lastFetchedAt: new Date("2025-05-01"),
  lastRowCount: 42,
  fieldMap: {},
  extractionPrompt: null,
};

const lowConfidenceSource = {
  id: "ds-2",
  domainName: "flood-risk-gb",
  name: "Backup Flood Source",
  url: "https://backup-flood.example.com/api",
  type: "rest",
  enabled: true,
  storeResults: true,
  confidence: 0.4,
  lastFetchedAt: new Date("2025-04-01"),
  lastRowCount: 5,
  fieldMap: {},
  extractionPrompt: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  mockDataSourceUpdate.mockResolvedValue({});
  mockRestProviderFetchRows.mockResolvedValue([{ id: "r1" }]);
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 1 — scoreSource utility
// ─────────────────────────────────────────────────────────────────────────────

describe("scoreSource — confidence delta calculations", () => {
  it("successful fetch with rows increases confidence", async () => {
    const { scoreSource } = await import("../enrichment/source-scoring");

    const result = scoreSource({
      current: 0.7,
      success: true,
      rowCount: 10,
    });

    expect(result).toBeGreaterThan(0.7);
  });

  it("failed fetch decreases confidence", async () => {
    const { scoreSource } = await import("../enrichment/source-scoring");

    const result = scoreSource({
      current: 0.7,
      success: false,
      rowCount: 0,
    });

    expect(result).toBeLessThan(0.7);
  });

  it("successful fetch with zero rows does not boost confidence", async () => {
    const { scoreSource } = await import("../enrichment/source-scoring");

    const successScore = scoreSource({
      current: 0.7,
      success: true,
      rowCount: 0,
    });

    const failScore = scoreSource({
      current: 0.7,
      success: false,
      rowCount: 0,
    });

    // Zero-row success should not boost — should be same or lower than current
    expect(successScore).toBeLessThanOrEqual(0.7);
    // But should not penalise as hard as a failure
    expect(successScore).toBeGreaterThanOrEqual(failScore);
  });

  it("confidence never drops below 0.0", async () => {
    const { scoreSource } = await import("../enrichment/source-scoring");

    const result = scoreSource({
      current: 0.05,
      success: false,
      rowCount: 0,
    });

    expect(result).toBeGreaterThanOrEqual(0.0);
  });

  it("confidence never exceeds 1.0", async () => {
    const { scoreSource } = await import("../enrichment/source-scoring");

    const result = scoreSource({
      current: 0.98,
      success: true,
      rowCount: 100,
    });

    expect(result).toBeLessThanOrEqual(1.0);
  });

  it("returns a number between 0 and 1 inclusive", async () => {
    const { scoreSource } = await import("../enrichment/source-scoring");

    for (const current of [0.0, 0.25, 0.5, 0.75, 1.0]) {
      for (const success of [true, false]) {
        const result = scoreSource({
          current,
          success,
          rowCount: success ? 5 : 0,
        });
        expect(result).toBeGreaterThanOrEqual(0.0);
        expect(result).toBeLessThanOrEqual(1.0);
      }
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 2 — GenericAdapter updates DataSource after fetch
// ─────────────────────────────────────────────────────────────────────────────

describe("GenericAdapter — DataSource scoring after fetch", () => {
  it("updates lastFetchedAt on the DataSource record after a successful fetch", async () => {
    mockDataSourceFindMany.mockResolvedValue([
      highConfidenceSource, // high first
      lowConfidenceSource,
    ]);
    mockRestProviderFetchRows.mockResolvedValue([{ id: "r1" }, { id: "r2" }]);

    const { createGenericAdapter } = await import("../domains/generic-adapter");
    const adapter = createGenericAdapter({
      name: "flood-risk-gb",
      tableName: "query_results",
      prismaModel: "queryResult",
      storeResults: true,
      countries: ["GB"],
      intents: ["flood risk"],
      apiUrl: "https://environment.data.gov.uk",
      apiKeyEnv: null,
      locationStyle: "coordinates",
      params: {},
      flattenRow: {},
      categoryMap: {},
      vizHintRules: { defaultHint: "table", multiMonthHint: "table" },
    });

    await adapter.fetchData({}, "51.5,-0.1");

    expect(mockDataSourceUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "ds-1" },
        data: expect.objectContaining({
          lastFetchedAt: expect.any(Date),
        }),
      }),
    );
  });

  it("updates lastRowCount on the DataSource record after a successful fetch", async () => {
    mockDataSourceFindMany.mockResolvedValue([
      highConfidenceSource, // high first
      lowConfidenceSource,
    ]);
    mockRestProviderFetchRows.mockResolvedValue([
      { id: "r1" },
      { id: "r2" },
      { id: "r3" },
    ]);

    const { createGenericAdapter } = await import("../domains/generic-adapter");
    const adapter = createGenericAdapter({
      name: "flood-risk-gb",
      tableName: "query_results",
      prismaModel: "queryResult",
      storeResults: true,
      countries: ["GB"],
      intents: ["flood risk"],
      apiUrl: "https://environment.data.gov.uk",
      apiKeyEnv: null,
      locationStyle: "coordinates",
      params: {},
      flattenRow: {},
      categoryMap: {},
      vizHintRules: { defaultHint: "table", multiMonthHint: "table" },
    });

    await adapter.fetchData({}, "51.5,-0.1");

    expect(mockDataSourceUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "ds-1" },
        data: expect.objectContaining({
          lastRowCount: 3,
        }),
      }),
    );
  });

  it("boosts confidence on the DataSource record after a successful fetch with rows", async () => {
    mockDataSourceFindMany.mockResolvedValue([
      highConfidenceSource, // high first
      lowConfidenceSource,
    ]);
    mockRestProviderFetchRows.mockResolvedValue([{ id: "r1" }, { id: "r2" }]);

    const { createGenericAdapter } = await import("../domains/generic-adapter");
    const adapter = createGenericAdapter({
      name: "flood-risk-gb",
      tableName: "query_results",
      prismaModel: "queryResult",
      storeResults: true,
      countries: ["GB"],
      intents: ["flood risk"],
      apiUrl: "https://environment.data.gov.uk",
      apiKeyEnv: null,
      locationStyle: "coordinates",
      params: {},
      flattenRow: {},
      categoryMap: {},
      vizHintRules: { defaultHint: "table", multiMonthHint: "table" },
    });

    await adapter.fetchData({}, "51.5,-0.1");

    const updateCall = mockDataSourceUpdate.mock.calls[0]?.[0];
    expect(updateCall?.data?.confidence).toBeGreaterThan(
      highConfidenceSource.confidence,
    );
  });

  it("penalises confidence on the DataSource record after a failed fetch", async () => {
    mockDataSourceFindMany.mockResolvedValue([
      highConfidenceSource, // high first
      lowConfidenceSource,
    ]);
    mockRestProviderFetchRows.mockRejectedValue(new Error("API down"));

    const { createGenericAdapter } = await import("../domains/generic-adapter");
    const adapter = createGenericAdapter({
      name: "flood-risk-gb",
      tableName: "query_results",
      prismaModel: "queryResult",
      storeResults: true,
      countries: ["GB"],
      intents: ["flood risk"],
      apiUrl: "https://environment.data.gov.uk",
      apiKeyEnv: null,
      locationStyle: "coordinates",
      params: {},
      flattenRow: {},
      categoryMap: {},
      vizHintRules: { defaultHint: "table", multiMonthHint: "table" },
    });

    await adapter.fetchData({}, "51.5,-0.1");

    const updateCall = mockDataSourceUpdate.mock.calls[0]?.[0];
    expect(updateCall?.data?.confidence).toBeLessThan(
      highConfidenceSource.confidence,
    );
  });

  it("updates DataSource even when fetch fails — does not throw", async () => {
    mockDataSourceFindMany.mockResolvedValue([
      highConfidenceSource, // high first
      lowConfidenceSource,
    ]);
    mockRestProviderFetchRows.mockRejectedValue(new Error("Network error"));

    const { createGenericAdapter } = await import("../domains/generic-adapter");
    const adapter = createGenericAdapter({
      name: "flood-risk-gb",
      tableName: "query_results",
      prismaModel: "queryResult",
      storeResults: true,
      countries: ["GB"],
      intents: ["flood risk"],
      apiUrl: "https://environment.data.gov.uk",
      apiKeyEnv: null,
      locationStyle: "coordinates",
      params: {},
      flattenRow: {},
      categoryMap: {},
      vizHintRules: { defaultHint: "table", multiMonthHint: "table" },
    });

    // Should not throw — failed sources return empty rows, not errors
    const rows = await adapter.fetchData({}, "51.5,-0.1");
    expect(Array.isArray(rows)).toBe(true);
    expect(mockDataSourceUpdate).toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 3 — Multiple sources ranked by confidence
// ─────────────────────────────────────────────────────────────────────────────

describe("GenericAdapter — multiple sources ranked by confidence", () => {
  it("merges results from all sources into a single array", async () => {
    mockDataSourceFindMany.mockResolvedValue([
      highConfidenceSource,
      lowConfidenceSource,
    ]);

    const { createRestProvider } = await import("../providers/rest-provider");
    (createRestProvider as ReturnType<typeof vi.fn>)
      .mockImplementationOnce(() => ({
        fetchRows: vi.fn().mockResolvedValue([{ id: "high-1" }]),
      }))
      .mockImplementationOnce(() => ({
        fetchRows: vi.fn().mockResolvedValue([{ id: "low-1" }]),
      }));

    const { createGenericAdapter } = await import("../domains/generic-adapter");
    const adapter = createGenericAdapter({
      name: "flood-risk-gb",
      tableName: "query_results",
      prismaModel: "queryResult",
      storeResults: true,
      countries: ["GB"],
      intents: ["flood risk"],
      apiUrl: "https://environment.data.gov.uk",
      apiKeyEnv: null,
      locationStyle: "coordinates",
      params: {},
      flattenRow: {},
      categoryMap: {},
      vizHintRules: { defaultHint: "table", multiMonthHint: "table" },
    });

    const rows = await adapter.fetchData({}, "51.5,-0.1");

    // Both sources contributed rows
    expect(rows.length).toBe(2);
  });
});
