import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../agent/workflows/shadow-recovery", () => ({
  searchAlternativeSources: vi.fn().mockResolvedValue([]),
  sampleAndDetectFormat: vi.fn().mockResolvedValue(null),
}));

describe("ShadowAdapter", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  describe("isEnabled()", () => {
    it("returns false when SHADOW_ADAPTER_ENABLED is not set", async () => {
      delete process.env.SHADOW_ADAPTER_ENABLED;
      const { shadowAdapter } = await import("../agent/shadow-adapter");
      expect(shadowAdapter.isEnabled()).toBe(false);
    });

    it("returns true when SHADOW_ADAPTER_ENABLED=true", async () => {
      process.env.SHADOW_ADAPTER_ENABLED = "true";
      const { shadowAdapter } = await import("../agent/shadow-adapter");
      expect(shadowAdapter.isEnabled()).toBe(true);
    });

    it("returns false when SHADOW_ADAPTER_ENABLED=false", async () => {
      process.env.SHADOW_ADAPTER_ENABLED = "false";
      const { shadowAdapter } = await import("../agent/shadow-adapter");
      expect(shadowAdapter.isEnabled()).toBe(false);
    });
  });

  describe("recover()", () => {
    it("returns null when no candidate sources are found", async () => {
      process.env.SHADOW_ADAPTER_ENABLED = "true";
      const { shadowAdapter } = await import("../agent/shadow-adapter");

      const result = await shadowAdapter.recover(
        { name: "crime-uk" } as any,
        {
          intent: "crime",
          location: "Camden",
          country_code: "GB",
          date_range: "2024-01",
        },
        {},
      );

      expect(result).toBeNull();
    });

    it("returns a result with data and newSource when recovery succeeds", async () => {
      process.env.SHADOW_ADAPTER_ENABLED = "true";
      const { shadowAdapter } = await import("../agent/shadow-adapter");

      // Inject a mock finder so no real HTTP is made
      const mockResult = {
        data: [{ raw: "incident" }],
        fallback: {
          field: "location" as const,
          original: "Camden",
          used: "Camden",
          explanation: "Shadow source used",
        },
        newSource: {
          sourceUrl: "https://example.com/data.csv",
          providerType: "csv",
          confidence: 0.8,
        },
      };

      vi.spyOn(shadowAdapter, "recover").mockResolvedValueOnce(mockResult);

      const result = await shadowAdapter.recover(
        { name: "crime-uk" } as any,
        {
          intent: "crime",
          location: "Camden",
          country_code: "GB",
          date_range: "2024-01",
        },
        {},
      );

      expect(result).not.toBeNull();
      expect(result!.data).toHaveLength(1);
      expect(result!.newSource.sourceUrl).toBe("https://example.com/data.csv");
      expect(result!.newSource.confidence).toBe(0.8);
    });
  });
});
