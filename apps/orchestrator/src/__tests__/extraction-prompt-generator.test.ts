import { describe, it, expect, vi, beforeEach } from "vitest";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

describe("generateExtractionPrompt", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.OPENROUTER_API_KEY = "test-key";
  });

  it("returns a non-empty string for a valid intent", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content:
                "Find all bus departures. Return route, destination, departure as items[].",
            },
          },
        ],
      }),
    });
    const { generateExtractionPrompt } =
      await import("../agent/search/extraction-prompt-generator");
    const prompt = await generateExtractionPrompt("bus times Leeds");
    expect(typeof prompt).toBe("string");
    expect(prompt.length).toBeGreaterThan(0);
  });

  it("includes 'items' in the generated prompt to match the extraction schema", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: "Return all results as an array under the key 'items'.",
            },
          },
        ],
      }),
    });
    const { generateExtractionPrompt } =
      await import("../agent/search/extraction-prompt-generator");
    const prompt = await generateExtractionPrompt(
      "train times Glasgow to Edinburgh",
    );
    expect(prompt.toLowerCase()).toContain("items");
  });

  it("returns a safe fallback prompt when the API call fails", async () => {
    mockFetch.mockRejectedValue(new Error("network error"));
    const { generateExtractionPrompt } =
      await import("../agent/search/extraction-prompt-generator");
    const prompt = await generateExtractionPrompt("pharmacy near me");
    expect(typeof prompt).toBe("string");
    expect(prompt.length).toBeGreaterThan(0);
  });

  it("returns a safe fallback prompt when the API returns a non-ok response", async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 429 });
    const { generateExtractionPrompt } =
      await import("../agent/search/extraction-prompt-generator");
    const prompt = await generateExtractionPrompt("restaurant menu Edinburgh");
    expect(typeof prompt).toBe("string");
    expect(prompt.length).toBeGreaterThan(0);
  });

  it("returns a safe fallback when OPENROUTER_API_KEY is not set", async () => {
    delete process.env.OPENROUTER_API_KEY;
    const { generateExtractionPrompt } =
      await import("../agent/search/extraction-prompt-generator");
    const prompt = await generateExtractionPrompt("cinema listings Glasgow");
    expect(typeof prompt).toBe("string");
    expect(prompt.length).toBeGreaterThan(0);
  });
});
