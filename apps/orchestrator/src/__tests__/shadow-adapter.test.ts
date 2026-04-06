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

  describe("isValidShapeForDomain()", () => {
    it("returns false for empty array", async () => {
      const { isValidShapeForDomain } = await import("../agent/shadow-adapter");
      expect(isValidShapeForDomain({ name: "crime-uk" } as any, [])).toBe(
        false,
      );
    });

    it("returns false for Plymouth-style year-column rows (no category or month)", async () => {
      const { isValidShapeForDomain } = await import("../agent/shadow-adapter");
      const plymouthRows = [
        {
          "2003": "3874",
          "2004": "3467",
          "2005": "3902",
          Offence: "All other theft offences",
        },
      ];
      expect(
        isValidShapeForDomain({ name: "crime-uk" } as any, plymouthRows),
      ).toBe(false);
    });

    it("returns false when category field is present but no date field", async () => {
      const { isValidShapeForDomain } = await import("../agent/shadow-adapter");
      const rows = [{ category: "burglary", street: "High Street" }];
      expect(isValidShapeForDomain({ name: "crime-uk" } as any, rows)).toBe(
        false,
      );
    });

    it("returns false when date field is present but no category field", async () => {
      const { isValidShapeForDomain } = await import("../agent/shadow-adapter");
      const rows = [{ month: "2024-01", street: "High Street" }];
      expect(isValidShapeForDomain({ name: "crime-uk" } as any, rows)).toBe(
        false,
      );
    });

    it("returns true for real police.uk rows with category and month", async () => {
      const { isValidShapeForDomain } = await import("../agent/shadow-adapter");
      const rows = [
        {
          category: "burglary",
          month: "2024-01",
          street: "On or near High Street",
          latitude: 51.5,
          longitude: -0.1,
        },
      ];
      expect(isValidShapeForDomain({ name: "crime-uk" } as any, rows)).toBe(
        true,
      );
    });

    it("accepts 'type' as a valid substitute for 'category'", async () => {
      const { isValidShapeForDomain } = await import("../agent/shadow-adapter");
      const rows = [{ type: "burglary", date: "2024-01-15" }];
      expect(isValidShapeForDomain({ name: "crime-uk" } as any, rows)).toBe(
        true,
      );
    });

    it("accepts 'offence' as a valid substitute for 'category'", async () => {
      const { isValidShapeForDomain } = await import("../agent/shadow-adapter");
      const rows = [{ offence: "burglary", month: "2024-01" }];
      expect(isValidShapeForDomain({ name: "crime-uk" } as any, rows)).toBe(
        true,
      );
    });

    it("returns true for unknown domain (no validation rule — pass through)", async () => {
      const { isValidShapeForDomain } = await import("../agent/shadow-adapter");
      const rows = [{ foo: "bar" }];
      expect(
        isValidShapeForDomain({ name: "unknown-domain" } as any, rows),
      ).toBe(true);
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

    it("returns null when sampled rows fail shape validation", async () => {
      process.env.SHADOW_ADAPTER_ENABLED = "true";

      const { searchAlternativeSources, sampleAndDetectFormat } =
        await import("../agent/workflows/shadow-recovery");

      vi.mocked(searchAlternativeSources).mockResolvedValueOnce([
        {
          url: "https://plymouth.thedata.place/summary.csv",
          description: "Plymouth offences 2003–2015",
          confidence: 0.8,
        },
      ]);

      vi.mocked(sampleAndDetectFormat).mockResolvedValueOnce({
        rows: [
          {
            "2003": "3874",
            "2004": "3467",
            Offence: "All other theft offences",
          },
        ],
        format: "csv",
        sampleSize: 1,
      });

      const { shadowAdapter } = await import("../agent/shadow-adapter");

      const result = await shadowAdapter.recover(
        { name: "crime-uk" } as any,
        {
          intent: "crime",
          location: "Bury St Edmunds",
          country_code: "GB",
          date_range: "2026-02",
        },
        {},
      );

      expect(result).toBeNull();
    });

    it("returns a result when sampled rows pass shape validation", async () => {
      process.env.SHADOW_ADAPTER_ENABLED = "true";

      const { searchAlternativeSources, sampleAndDetectFormat } =
        await import("../agent/workflows/shadow-recovery");

      vi.mocked(searchAlternativeSources).mockResolvedValueOnce([
        {
          url: "https://example.com/crimes.csv",
          description: "Suffolk crime data 2024",
          confidence: 0.7,
        },
      ]);

      vi.mocked(sampleAndDetectFormat).mockResolvedValueOnce({
        rows: [
          {
            category: "burglary",
            month: "2024-01",
            latitude: 52.2,
            longitude: 0.7,
          },
        ],
        format: "csv",
        sampleSize: 1,
      });

      const { shadowAdapter } = await import("../agent/shadow-adapter");

      const result = await shadowAdapter.recover(
        { name: "crime-uk" } as any,
        {
          intent: "crime",
          location: "Bury St Edmunds",
          country_code: "GB",
          date_range: "2024-01",
        },
        {},
      );

      expect(result).not.toBeNull();
      expect(result!.data).toHaveLength(1);
      expect(result!.newSource.sourceUrl).toBe(
        "https://example.com/crimes.csv",
      );
    });
  });
});
