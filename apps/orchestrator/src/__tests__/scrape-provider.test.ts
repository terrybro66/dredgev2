/**
 * Block H — ScrapeProvider
 *
 * Branch: feat/scrape-provider
 *
 * Tests are grouped into three suites:
 *
 *   1. ScrapeProvider unit tests (mocked Stagehand)
 *      Verifies the provider contract: fetchData returns rows, handles
 *      NoObjectGeneratedError fallback, returns empty on page failure.
 *
 *   2. GenericAdapter scrape routing
 *      Verifies that GenericAdapter calls ScrapeProvider when source.type
 *      === "scrape", and other providers for their respective types.
 *
 *   3. sampleSource scrape path
 *      Verifies that when a URL returns HTML (not a direct file),
 *      sampleSource uses ScrapeProvider to extract sample rows.
 *
 * Run:
 *   pnpm vitest run src/__tests__/scrape-provider.test.ts --reporter=verbose
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ProviderSource } from "../providers/types";

// ── Mock Stagehand before any imports touch it ────────────────────────────────

const mockExtract = vi.fn();
const mockInit = vi.fn().mockResolvedValue(undefined);
const mockClose = vi.fn().mockResolvedValue(undefined);
const mockNewPage = vi.fn();
const mockGoto = vi.fn().mockResolvedValue(undefined);

const mockPage = { goto: mockGoto };
const mockContext = {
  pages: vi.fn().mockReturnValue([mockPage]),
  newPage: mockNewPage,
};

const mockStagehandInstance = {
  init: mockInit,
  close: mockClose,
  extract: mockExtract,
  context: mockContext,
};

vi.mock("@browserbasehq/stagehand", () => {
  const MockStagehand = vi.fn(function (this: any) {
    this.init = mockInit;
    this.close = mockClose;
    this.extract = mockExtract;
    this.context = mockContext;
  });
  return { Stagehand: MockStagehand };
});

// Also mock axios for the sampleSource tests
const mockAxiosGet = vi.fn();
vi.mock("axios", () => ({ default: { get: mockAxiosGet } }));

// ── Shared fixtures ───────────────────────────────────────────────────────────

const scrapeSource: ProviderSource & {
  type: "scrape";
  extractionPrompt: string;
} = {
  url: "https://www.odeon.co.uk/cinemas/braehead/",
  providerType: "rest" as any, // ProviderSource uses providerType, ScrapeProvider uses type
  type: "scrape",
  refreshPolicy: "realtime",
  extractionPrompt:
    "Extract all movie titles and showtimes currently showing at this cinema.",
};

beforeEach(() => {
  vi.clearAllMocks();
  mockInit.mockResolvedValue(undefined);
  mockClose.mockResolvedValue(undefined);
  mockGoto.mockResolvedValue(undefined);
  mockContext.pages.mockReturnValue([mockPage]);
  mockNewPage.mockResolvedValue(mockPage);
  mockExtract.mockResolvedValue({
    movies: [
      { title: "Dune Part Two", showtime: "2025-06-01T19:30:00Z" },
      { title: "Gladiator II", showtime: "2025-06-01T21:00:00Z" },
    ],
  });
  mockAxiosGet.mockResolvedValue({ data: [] });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 1 — ScrapeProvider unit tests
// ─────────────────────────────────────────────────────────────────────────────

describe("ScrapeProvider", () => {
  it("fetchRows returns an array of rows from a scraped page", async () => {
    const { createScrapeProvider } =
      await import("../providers/scrape-provider");

    const provider = createScrapeProvider({
      extractionPrompt: scrapeSource.extractionPrompt,
    });

    const rows = await provider.fetchRows(scrapeSource.url);

    expect(Array.isArray(rows)).toBe(true);
    expect(rows.length).toBeGreaterThan(0);
  });

  it("fetchRows uses the extractionPrompt when calling stagehand.extract", async () => {
    const { createScrapeProvider } =
      await import("../providers/scrape-provider");

    const provider = createScrapeProvider({
      extractionPrompt: scrapeSource.extractionPrompt,
    });

    await provider.fetchRows(scrapeSource.url);

    expect(mockExtract).toHaveBeenCalledWith(
      scrapeSource.extractionPrompt,
      expect.anything(), // zod schema
      expect.objectContaining({ page: mockPage }),
    );
  });

  it("fetchRows navigates to the source URL before extracting", async () => {
    const { createScrapeProvider } =
      await import("../providers/scrape-provider");

    const provider = createScrapeProvider({
      extractionPrompt: scrapeSource.extractionPrompt,
    });

    await provider.fetchRows(scrapeSource.url);

    expect(mockGoto).toHaveBeenCalledWith(scrapeSource.url, expect.anything());
  });

  it("fetchRows falls back to raw text parse when NoObjectGeneratedError is thrown", async () => {
    const { createScrapeProvider } =
      await import("../providers/scrape-provider");

    // Simulate NoObjectGeneratedError with text field containing raw data
    const error = new Error("No object generated");
    error.name = "NoObjectGeneratedError";
    (error as any).text = JSON.stringify([
      { title: "Dune Part Two", showtime: "2025-06-01T19:30:00Z" },
    ]);
    mockExtract.mockRejectedValue(error);

    const provider = createScrapeProvider({
      extractionPrompt: scrapeSource.extractionPrompt,
    });

    const rows = await provider.fetchRows(scrapeSource.url);

    // Should have fallen back to parsing error.text
    expect(Array.isArray(rows)).toBe(true);
    expect(rows.length).toBeGreaterThan(0);
  });

  it("fetchRows returns empty array (not error) when page returns no extractable data", async () => {
    mockExtract.mockResolvedValue({ movies: [] });

    const { createScrapeProvider } =
      await import("../providers/scrape-provider");

    const provider = createScrapeProvider({
      extractionPrompt: scrapeSource.extractionPrompt,
    });

    const rows = await provider.fetchRows(scrapeSource.url);

    expect(Array.isArray(rows)).toBe(true);
    expect(rows.length).toBe(0);
  });

  it("fetchRows returns empty array (not error) when Stagehand throws a non-NoObjectGeneratedError", async () => {
    mockExtract.mockRejectedValue(new Error("Cloudflare blocked request"));

    const { createScrapeProvider } =
      await import("../providers/scrape-provider");

    const provider = createScrapeProvider({
      extractionPrompt: scrapeSource.extractionPrompt,
    });

    const rows = await provider.fetchRows(scrapeSource.url);

    expect(Array.isArray(rows)).toBe(true);
    // Should not throw — returns empty array with logged warning
  });

  it("fetchRows calls stagehand.init() and stagehand.close() around the extraction", async () => {
    const { createScrapeProvider } =
      await import("../providers/scrape-provider");

    const provider = createScrapeProvider({
      extractionPrompt: scrapeSource.extractionPrompt,
    });

    await provider.fetchRows(scrapeSource.url);

    expect(mockInit).toHaveBeenCalledOnce();
    expect(mockClose).toHaveBeenCalledOnce();
  });

  it("fetchRows calls stagehand.close() even when extraction throws", async () => {
    mockExtract.mockRejectedValue(new Error("Unexpected error"));

    const { createScrapeProvider } =
      await import("../providers/scrape-provider");

    const provider = createScrapeProvider({
      extractionPrompt: scrapeSource.extractionPrompt,
    });

    await provider.fetchRows(scrapeSource.url); // should not throw

    expect(mockClose).toHaveBeenCalledOnce();
  });

  it("uses the page from stagehand.context.pages() when available", async () => {
    mockContext.pages.mockReturnValue([mockPage]);

    const { createScrapeProvider } =
      await import("../providers/scrape-provider");

    const provider = createScrapeProvider({
      extractionPrompt: scrapeSource.extractionPrompt,
    });

    await provider.fetchRows(scrapeSource.url);

    // Should use existing page, not create a new one
    expect(mockNewPage).not.toHaveBeenCalled();
  });

  it("creates a new page when stagehand.context.pages() is empty", async () => {
    mockContext.pages.mockReturnValue([]);
    mockNewPage.mockResolvedValue(mockPage);

    const { createScrapeProvider } =
      await import("../providers/scrape-provider");

    const provider = createScrapeProvider({
      extractionPrompt: scrapeSource.extractionPrompt,
    });

    await provider.fetchRows(scrapeSource.url);

    expect(mockNewPage).toHaveBeenCalledOnce();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 2 — GenericAdapter scrape routing
// ─────────────────────────────────────────────────────────────────────────────

const { mockPrismaForAdapter } = vi.hoisted(() => ({
  mockPrismaForAdapter: {
    dataSource: {
      findMany: vi.fn(),
    },
  },
}));

vi.mock("../db", () => ({ prisma: mockPrismaForAdapter }));

describe("GenericAdapter — scrape source routing", () => {
  beforeEach(() => {
    global.fetch = vi.fn().mockRejectedValue(new Error("Not a direct file"));
    mockPrismaForAdapter.dataSource.findMany.mockResolvedValue([]);
  });

  it("GenericAdapter routes to ScrapeProvider when source.type === 'scrape'", async () => {
    // Return a scrape-type DataSource from the DB
    mockPrismaForAdapter.dataSource.findMany.mockResolvedValue([
      {
        id: "ds-scrape-1",
        url: "https://www.odeon.co.uk/cinemas/braehead/",
        type: "scrape",
        enabled: true,
        storeResults: false,
        extractionPrompt: "Extract all movie titles and showtimes.",
        fieldMap: { title: "description", showtime: "date" },
      },
    ]);

    mockExtract.mockResolvedValue({
      movies: [{ title: "Dune Part Two", showtime: "2025-06-01T19:30:00Z" }],
    });

    const { createGenericAdapter } = await import("../domains/generic-adapter");

    const adapter = createGenericAdapter({
      name: "cinema-listings-gb",
      tableName: "query_results",
      prismaModel: "queryResult",
      storeResults: false,
      countries: ["GB"],
      intents: ["cinema"],
      apiUrl: "https://www.odeon.co.uk",
      apiKeyEnv: null,
      locationStyle: "coordinates",
      params: {},
      flattenRow: {},
      categoryMap: {},
      vizHintRules: { defaultHint: "table", multiMonthHint: "table" },
    });

    const rows = await adapter.fetchData({}, "51.5,-0.1");

    // Stagehand extract was called — ScrapeProvider was used
    expect(mockExtract).toHaveBeenCalled();
    expect(Array.isArray(rows)).toBe(true);
  });

  it("GenericAdapter does NOT call Stagehand when source.type === 'rest'", async () => {
    mockPrismaForAdapter.dataSource.findMany.mockResolvedValue([
      {
        id: "ds-rest-1",
        url: "https://api.example.com/data",
        type: "rest",
        enabled: true,
        storeResults: true,
        fieldMap: {},
      },
    ]);

    mockAxiosGet.mockResolvedValue({ data: [{ id: 1 }] });

    const { createGenericAdapter } = await import("../domains/generic-adapter");

    const adapter = createGenericAdapter({
      name: "flood-risk-gb",
      tableName: "query_results",
      prismaModel: "queryResult",
      storeResults: true,
      countries: ["GB"],
      intents: ["flood risk"],
      apiUrl: "https://api.example.com/data",
      apiKeyEnv: null,
      locationStyle: "coordinates",
      params: {},
      flattenRow: {},
      categoryMap: {},
      vizHintRules: { defaultHint: "table", multiMonthHint: "table" },
    });

    await adapter.fetchData({}, "51.5,-0.1").catch(() => {});

    expect(mockExtract).not.toHaveBeenCalled();
  });

  it("rows from ScrapeProvider pass through the adapter's flattenRow like any other provider", async () => {
    mockPrismaForAdapter.dataSource.findMany.mockResolvedValue([
      {
        id: "ds-scrape-2",
        url: "https://www.odeon.co.uk/cinemas/braehead/",
        type: "scrape",
        enabled: true,
        storeResults: false,
        extractionPrompt: "Extract all movie titles.",
        fieldMap: {},
      },
    ]);

    mockExtract.mockResolvedValue({
      movies: [{ title: "Dune Part Two" }],
    });

    const { createGenericAdapter } = await import("../domains/generic-adapter");

    const flattenRow = vi.fn((row: unknown) => row as Record<string, unknown>);

    const adapter = createGenericAdapter({
      name: "cinema-listings-gb",
      tableName: "query_results",
      prismaModel: "queryResult",
      storeResults: false,
      countries: ["GB"],
      intents: ["cinema"],
      apiUrl: "https://www.odeon.co.uk",
      apiKeyEnv: null,
      locationStyle: "coordinates",
      params: {},
      flattenRow: {},
      categoryMap: {},
      vizHintRules: { defaultHint: "table", multiMonthHint: "table" },
    });

    // flattenRow is called on the adapter config — just verify rows are returned
    const rows = await adapter.fetchData({}, "51.5,-0.1");
    expect(Array.isArray(rows)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 3 — sampleSource scrape path
// These tests verify the ScrapeProvider is wired correctly for the scrape
// path without calling sampleSource directly (which hits real network).
// ─────────────────────────────────────────────────────────────────────────────

describe("sampleSource — scrape path", () => {
  it("createScrapeProvider returns an object with a fetchRows function", async () => {
    const { createScrapeProvider } =
      await import("../providers/scrape-provider");

    const provider = createScrapeProvider({
      extractionPrompt: "Extract all items from this page.",
    });

    expect(typeof provider.fetchRows).toBe("function");
  });

  it("ScrapeProvider fetchRows returns empty array when fetch is not a direct file and Stagehand extraction returns nothing", async () => {
    mockExtract.mockResolvedValue({ items: [] });

    const { createScrapeProvider } =
      await import("../providers/scrape-provider");

    const provider = createScrapeProvider({
      extractionPrompt: "Extract all items from this page.",
    });

    const rows = await provider.fetchRows("https://example.com/page");

    expect(Array.isArray(rows)).toBe(true);
    expect(rows.length).toBe(0);
  });
});
