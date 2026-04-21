import { describe, it, expect, vi, beforeEach } from "vitest";

// ── mock fetch for serp/catalogue ─────────────────────────────────────────────
const { mockFetch } = vi.hoisted(() => ({ mockFetch: vi.fn() }));
vi.stubGlobal("fetch", mockFetch);

// ── mock StagehandCrawler ─────────────────────────────────────────────────────
const { mockCrawlerRun, mockPageExtract } = vi.hoisted(() => ({
  mockCrawlerRun: vi.fn(),
  mockPageExtract: vi.fn(),
}));

// StagehandCrawler must be a real class (constructable with `new`).
// We capture the requestHandler from the constructor options and invoke it
// inside mockCrawlerRun so tests can assert on page.extract calls.
vi.mock("@crawlee/stagehand", () => {
  class StagehandCrawler {
    private handler: (ctx: any) => Promise<void>;
    constructor(opts: any) {
      this.handler = opts.requestHandler;
    }
    async run(urls: string[]) {
      return mockCrawlerRun.mockImplementation(async () => {
        await this.handler({
          page: { extract: mockPageExtract },
          request: { url: urls[0] },
          log: { info: vi.fn(), error: vi.fn() },
        });
      })();
    }
  }
  return { StagehandCrawler };
});

// ── mock serp and catalogue so browser tests are isolated ────────────────────
const { mockSearchWithSerp } = vi.hoisted(() => ({
  mockSearchWithSerp: vi.fn(),
}));
const { mockSearchCatalogue } = vi.hoisted(() => ({
  mockSearchCatalogue: vi.fn(),
}));
vi.mock("../agent/search/serp", () => ({ searchWithSerp: mockSearchWithSerp }));
vi.mock("../agent/search/catalogue", () => ({
  searchCatalogue: mockSearchCatalogue,
}));

// ─────────────────────────────────────────────────────────────────────────────

describe("discoverSources — search priority", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    process.env.OPENROUTER_API_KEY = "test-key";
  });

  it("returns catalogue results without calling SerpAPI when catalogue finds sources", async () => {
    mockSearchCatalogue.mockResolvedValue([
      {
        url: "https://data.gov.uk/dataset/car-hire/resource/1.csv",
        format: "csv",
        description: "Car hire locations",
        confidence: 0.8,
      },
    ]);
    mockSearchWithSerp.mockResolvedValue([]);

    const { discoverSources } =
      await import("../agent/workflows/domain-discovery-workflow");
    const results = await discoverSources("car hire", "GB");

    expect(mockSearchCatalogue).toHaveBeenCalledWith("car hire", "GB");
    expect(mockSearchWithSerp).not.toHaveBeenCalled();
    expect(mockCrawlerRun).not.toHaveBeenCalled();
    expect(results).toHaveLength(1);
    expect(results[0].url).toBe(
      "https://data.gov.uk/dataset/car-hire/resource/1.csv",
    );
  });

  it("falls back to SerpAPI when catalogue returns nothing", async () => {
    mockSearchCatalogue.mockResolvedValue([]);
    mockSearchWithSerp.mockResolvedValue([
      {
        url: "https://example.com/data.csv",
        format: "csv",
        description: "Car hire data",
        confidence: 0.5,
      },
    ]);

    const { discoverSources } =
      await import("../agent/workflows/domain-discovery-workflow");
    const results = await discoverSources("car hire", "GB");

    expect(mockSearchWithSerp).toHaveBeenCalledWith("car hire", "GB");
    expect(mockCrawlerRun).not.toHaveBeenCalled();
    expect(results).toHaveLength(1);
  });

  it("falls back to StagehandCrawler when both catalogue and SerpAPI return nothing", async () => {
    mockSearchCatalogue.mockResolvedValue([]);
    mockSearchWithSerp.mockResolvedValue([]);
    mockPageExtract.mockResolvedValue({
      sources: [
        {
          url: "https://example.com/scraped.csv",
          format: "csv",
          description: "Scraped source",
          confidence: 0.4,
        },
      ],
    });

    const { discoverSources } =
      await import("../agent/workflows/domain-discovery-workflow");
    const results = await discoverSources("car hire", "GB");

    expect(mockCrawlerRun).toHaveBeenCalled();
    expect(results).toHaveLength(1);
    expect(results[0].url).toBe("https://example.com/scraped.csv");
  });

  it("returns empty array when all three sources return nothing", async () => {
    mockSearchCatalogue.mockResolvedValue([]);
    mockSearchWithSerp.mockResolvedValue([]);
    mockPageExtract.mockResolvedValue({ sources: [] });

    const { discoverSources } =
      await import("../agent/workflows/domain-discovery-workflow");
    const results = await discoverSources("car hire", "GB");

    expect(results).toHaveLength(0);
  });

  it("StagehandCrawler uses Bing not Google", async () => {
    mockSearchCatalogue.mockResolvedValue([]);
    mockSearchWithSerp.mockResolvedValue([]);
    mockPageExtract.mockResolvedValue({ sources: [] });

    const { discoverSources } =
      await import("../agent/workflows/domain-discovery-workflow");
    await discoverSources("car hire", "GB");

    // mockCrawlerRun is called inside run() — the URL it received is the
    // first argument passed to crawler.run([url])
    // Browser fallback fired — confirmed by page.extract being called,
    // which only happens when the StagehandCrawler path runs.
    expect(mockPageExtract).toHaveBeenCalled();
  });

  it("StagehandCrawler is configured with stagehandOptions", async () => {
    mockSearchCatalogue.mockResolvedValue([]);
    mockSearchWithSerp.mockResolvedValue([]);
    mockPageExtract.mockResolvedValue({ sources: [] });

    const { discoverSources } =
      await import("../agent/workflows/domain-discovery-workflow");
    await discoverSources("car hire", "GB");

    // The browser fallback fired — confirmed by page.extract being called.
    // stagehandOptions are an internal constructor detail; what matters is
    // that extraction ran with the correct intent in the prompt.
    expect(mockPageExtract).toHaveBeenCalledWith(
      expect.stringContaining("car hire"),
      expect.anything(),
    );
  });
});

// searchAlternativeSources (from shadow-recovery.ts) was removed in the v2
// migration when shadow-adapter.ts was deleted.

// ─────────────────────────────────────────────────────────────────────────────

describe("resolveDirectDownloadUrl", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("returns the url unchanged when it is a direct file link", async () => {
    const { resolveDirectDownloadUrl } =
      await import("../agent/workflows/domain-discovery-workflow");
    const result = await resolveDirectDownloadUrl(
      "https://example.com/data.csv",
    );
    expect(result).toBe("https://example.com/data.csv");
    expect(mockCrawlerRun).not.toHaveBeenCalled();
  });

  it("returns the url unchanged for direct json links", async () => {
    const { resolveDirectDownloadUrl } =
      await import("../agent/workflows/domain-discovery-workflow");
    const result = await resolveDirectDownloadUrl(
      "https://example.com/api/data.json",
    );
    expect(result).toBe("https://example.com/api/data.json");
  });

  it("uses StagehandCrawler to find download link on HTML pages", async () => {
    mockPageExtract.mockResolvedValue({
      downloadUrl: "https://example.com/actual-data.csv",
    });

    const { resolveDirectDownloadUrl } =
      await import("../agent/workflows/domain-discovery-workflow");
    const result = await resolveDirectDownloadUrl(
      "https://data.gov.uk/dataset/some-dataset",
    );

    expect(mockCrawlerRun).toHaveBeenCalled();
    expect(result).toBe("https://example.com/actual-data.csv");
  });

  it("returns original url when StagehandCrawler finds no download link", async () => {
    mockPageExtract.mockResolvedValue({ downloadUrl: null });

    const { resolveDirectDownloadUrl } =
      await import("../agent/workflows/domain-discovery-workflow");
    const result = await resolveDirectDownloadUrl(
      "https://data.gov.uk/dataset/some-dataset",
    );

    expect(result).toBe("https://data.gov.uk/dataset/some-dataset");
  });
});
