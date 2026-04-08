// apps/orchestrator/src/__tests__/scrape-url-cache.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockGet = vi.fn();
const mockSetex = vi.fn();

vi.mock("../redis", () => ({
  getRedisClient: () => ({ get: mockGet, setex: mockSetex }),
}));

describe("scrapeUrlCache", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns null on cache miss", async () => {
    mockGet.mockResolvedValue(null);
    const { getCachedScrapeUrl } =
      await import("../agent/search/scrape-url-cache");
    const result = await getCachedScrapeUrl("cinema listings", "Glasgow");
    expect(result).toBeNull();
  });

  it("returns parsed value on cache hit", async () => {
    mockGet.mockResolvedValue(
      JSON.stringify({
        url: "https://www.odeon.co.uk/cinemas/glasgow-quay/",
        extractionPrompt: "Find all movies...",
      }),
    );
    const { getCachedScrapeUrl } =
      await import("../agent/search/scrape-url-cache");
    const result = await getCachedScrapeUrl("cinema listings", "Glasgow");
    expect(result).toEqual({
      url: "https://www.odeon.co.uk/cinemas/glasgow-quay/",
      extractionPrompt: "Find all movies...",
    });
  });

  it("uses correct key format — lowercased, spaces as hyphens", async () => {
    mockGet.mockResolvedValue(null);
    const { getCachedScrapeUrl } =
      await import("../agent/search/scrape-url-cache");
    await getCachedScrapeUrl("Cinema Listings", "Glasgow City");
    expect(mockGet).toHaveBeenCalledWith(
      "scrape:url:cinema-listings:glasgow-city",
    );
  });

  it("sets value with 7-day TTL", async () => {
    mockSetex.mockResolvedValue("OK");
    const { setCachedScrapeUrl } =
      await import("../agent/search/scrape-url-cache");
    await setCachedScrapeUrl("cinema listings", "Glasgow", {
      url: "https://www.odeon.co.uk/cinemas/glasgow-quay/",
      extractionPrompt: "Find all movies...",
    });
    expect(mockSetex).toHaveBeenCalledWith(
      "scrape:url:cinema-listings:glasgow",
      604800, // 7 days in seconds
      expect.any(String),
    );
  });

  it("returns null without throwing when Redis errors", async () => {
    mockGet.mockRejectedValue(new Error("Redis connection refused"));
    const { getCachedScrapeUrl } =
      await import("../agent/search/scrape-url-cache");
    await expect(
      getCachedScrapeUrl("cinema listings", "Glasgow"),
    ).resolves.toBeNull();
  });

  it("does not throw when set fails", async () => {
    mockSetex.mockRejectedValue(new Error("Redis write failed"));
    const { setCachedScrapeUrl } =
      await import("../agent/search/scrape-url-cache");
    await expect(
      setCachedScrapeUrl("cinema listings", "Glasgow", {
        url: "https://www.odeon.co.uk/cinemas/glasgow-quay/",
        extractionPrompt: "Find all movies...",
      }),
    ).resolves.not.toThrow();
  });
});
