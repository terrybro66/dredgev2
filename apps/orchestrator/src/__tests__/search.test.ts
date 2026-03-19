import { describe, it, expect, vi, beforeEach } from "vitest";

// ── mock fetch globally ───────────────────────────────────────────────────────
const { mockFetch } = vi.hoisted(() => ({ mockFetch: vi.fn() }));
vi.stubGlobal("fetch", mockFetch);

// ─────────────────────────────────────────────────────────────────────────────

describe("searchWithSerp", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.SERAPI_KEY = "test-serp-key";
  });

  it("returns empty array when SERAPI_KEY is not set", async () => {
    delete process.env.SERAPI_KEY;
    const { searchWithSerp } = await import("../agent/search/serp");
    const results = await searchWithSerp("car hire", "GB");
    expect(results).toEqual([]);
  });

  it("calls SerpAPI with the correct query and api_key", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ organic_results: [] }),
    });
    const { searchWithSerp } = await import("../agent/search/serp");
    await searchWithSerp("car hire", "GB");

    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain("serpapi.com");
    expect(calledUrl).toContain("car+hire");
    expect(calledUrl).toContain("test-serp-key");
  });

  it("returns mapped results from organic_results", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        organic_results: [
          {
            link: "https://data.gov.uk/dataset/car-hire",
            title: "Car Hire Dataset",
            snippet: "A CSV dataset of car hire locations",
          },
          {
            link: "https://example.com/api/car-hire.json",
            title: "Car Hire API",
            snippet: "REST API for car hire data",
          },
        ],
      }),
    });
    const { searchWithSerp } = await import("../agent/search/serp");
    const results = await searchWithSerp("car hire", "GB");

    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({
      url: "https://data.gov.uk/dataset/car-hire",
      description: expect.any(String),
      confidence: expect.any(Number),
    });
  });

  it("infers csv format from url ending in .csv", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        organic_results: [
          {
            link: "https://example.com/data.csv",
            title: "CSV Data",
            snippet: "A CSV file",
          },
        ],
      }),
    });
    const { searchWithSerp } = await import("../agent/search/serp");
    const results = await searchWithSerp("car hire", "GB");
    expect(results[0].format).toBe("csv");
  });

  it("infers xlsx format from url ending in .xlsx", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        organic_results: [
          {
            link: "https://example.com/data.xlsx",
            title: "Excel Data",
            snippet: "An Excel file",
          },
        ],
      }),
    });
    const { searchWithSerp } = await import("../agent/search/serp");
    const results = await searchWithSerp("car hire", "GB");
    expect(results[0].format).toBe("xlsx");
  });

  it("infers rest format from url ending in .json", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        organic_results: [
          {
            link: "https://example.com/api/data.json",
            title: "JSON API",
            snippet: "A JSON endpoint",
          },
        ],
      }),
    });
    const { searchWithSerp } = await import("../agent/search/serp");
    const results = await searchWithSerp("car hire", "GB");
    expect(results[0].format).toBe("rest");
  });

  it("defaults to scrape format for unrecognised urls", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        organic_results: [
          {
            link: "https://example.com/some-page",
            title: "Some Page",
            snippet: "A webpage",
          },
        ],
      }),
    });
    const { searchWithSerp } = await import("../agent/search/serp");
    const results = await searchWithSerp("car hire", "GB");
    expect(results[0].format).toBe("scrape");
  });

  it("returns empty array when fetch throws", async () => {
    mockFetch.mockRejectedValueOnce(new Error("network error"));
    const { searchWithSerp } = await import("../agent/search/serp");
    const results = await searchWithSerp("car hire", "GB");
    expect(results).toEqual([]);
  });

  it("returns empty array when response is not ok", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 429 });
    const { searchWithSerp } = await import("../agent/search/serp");
    const results = await searchWithSerp("car hire", "GB");
    expect(results).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("searchCatalogue", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns empty array for non-GB country codes", async () => {
    const { searchCatalogue } = await import("../agent/search/catalogue");
    const results = await searchCatalogue("car hire", "US");
    expect(results).toEqual([]);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("calls data.gov.uk API for GB queries", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ result: { results: [] } }),
    });
    const { searchCatalogue } = await import("../agent/search/catalogue");
    await searchCatalogue("car hire", "GB");

    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain("data.gov.uk");
    expect(calledUrl).toContain("car");
  });

  it("returns mapped results from data.gov.uk response", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        result: {
          results: [
            {
              name: "car-hire-locations",
              title: "Car Hire Locations",
              notes: "Dataset of car hire locations in the UK",
              resources: [
                {
                  url: "https://data.gov.uk/dataset/car-hire/resource/1.csv",
                  format: "CSV",
                },
              ],
            },
          ],
        },
      }),
    });
    const { searchCatalogue } = await import("../agent/search/catalogue");
    const results = await searchCatalogue("car hire", "GB");

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      url: "https://data.gov.uk/dataset/car-hire/resource/1.csv",
      format: "csv",
      description: expect.any(String),
      confidence: expect.any(Number),
    });
  });

  it("maps CSV resource format correctly", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        result: {
          results: [
            {
              name: "test",
              title: "Test",
              notes: "Test dataset",
              resources: [{ url: "https://example.com/data.csv", format: "CSV" }],
            },
          ],
        },
      }),
    });
    const { searchCatalogue } = await import("../agent/search/catalogue");
    const results = await searchCatalogue("test", "GB");
    expect(results[0].format).toBe("csv");
  });

  it("maps JSON resource format to rest", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        result: {
          results: [
            {
              name: "test",
              title: "Test",
              notes: "Test dataset",
              resources: [{ url: "https://example.com/api", format: "JSON" }],
            },
          ],
        },
      }),
    });
    const { searchCatalogue } = await import("../agent/search/catalogue");
    const results = await searchCatalogue("test", "GB");
    expect(results[0].format).toBe("rest");
  });

  it("skips datasets with no resources", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        result: {
          results: [
            {
              name: "empty",
              title: "Empty",
              notes: "No resources",
              resources: [],
            },
          ],
        },
      }),
    });
    const { searchCatalogue } = await import("../agent/search/catalogue");
    const results = await searchCatalogue("test", "GB");
    expect(results).toHaveLength(0);
  });

  it("returns empty array when fetch throws", async () => {
    mockFetch.mockRejectedValueOnce(new Error("network error"));
    const { searchCatalogue } = await import("../agent/search/catalogue");
    const results = await searchCatalogue("car hire", "GB");
    expect(results).toEqual([]);
  });

  it("returns empty array when response is not ok", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });
    const { searchCatalogue } = await import("../agent/search/catalogue");
    const results = await searchCatalogue("car hire", "GB");
    expect(results).toEqual([]);
  });
});
