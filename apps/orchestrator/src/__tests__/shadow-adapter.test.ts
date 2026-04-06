import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  shadowAdapter,
  isValidShapeForDomain,
  isGeographicallyRelevant,
  applyFieldMap,
} from "../agent/shadow-adapter";

import {
  searchAlternativeSources,
  sampleAndDetectFormat,
} from "../agent/workflows/shadow-recovery";

vi.mock("../agent/workflows/shadow-recovery", () => ({
  searchAlternativeSources: vi.fn().mockResolvedValue([]),
  sampleAndDetectFormat: vi.fn().mockResolvedValue(null),
}));

describe("ShadowAdapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("isEnabled()", () => {
    it("returns false when SHADOW_ADAPTER_ENABLED is not set", () => {
      delete process.env.SHADOW_ADAPTER_ENABLED;
      expect(shadowAdapter.isEnabled()).toBe(false);
    });

    it("returns true when SHADOW_ADAPTER_ENABLED=true", () => {
      process.env.SHADOW_ADAPTER_ENABLED = "true";
      expect(shadowAdapter.isEnabled()).toBe(true);
    });

    it("returns false when SHADOW_ADAPTER_ENABLED=false", () => {
      process.env.SHADOW_ADAPTER_ENABLED = "false";
      expect(shadowAdapter.isEnabled()).toBe(false);
    });
  });

  describe("isValidShapeForDomain()", () => {
    it("returns false for empty array", () => {
      expect(isValidShapeForDomain({ name: "crime-uk" } as any, [])).toBe(
        false,
      );
    });

    it("returns false for Plymouth-style year-column rows (no category or month)", () => {
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

    it("returns false when category field is present but no date field", () => {
      const rows = [{ category: "burglary", street: "High Street" }];
      expect(isValidShapeForDomain({ name: "crime-uk" } as any, rows)).toBe(
        false,
      );
    });

    it("returns false when date field is present but no category field", () => {
      const rows = [{ month: "2024-01", street: "High Street" }];
      expect(isValidShapeForDomain({ name: "crime-uk" } as any, rows)).toBe(
        false,
      );
    });

    it("returns true for real police.uk rows with category and month", () => {
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

    it("accepts 'type' as a valid substitute for 'category'", () => {
      const rows = [{ type: "burglary", date: "2024-01-15" }];
      expect(isValidShapeForDomain({ name: "crime-uk" } as any, rows)).toBe(
        true,
      );
    });

    it("accepts 'offence' as a valid substitute for 'category'", () => {
      const rows = [{ offence: "burglary", month: "2024-01" }];
      expect(isValidShapeForDomain({ name: "crime-uk" } as any, rows)).toBe(
        true,
      );
    });

    it("returns true for unknown domain (no validation rule — pass through)", () => {
      const rows = [{ foo: "bar" }];
      expect(
        isValidShapeForDomain({ name: "unknown-domain" } as any, rows),
      ).toBe(true);
    });
  });

  describe("isGeographicallyRelevant()", () => {
    it("returns false when source URL contains a different UK city", () => {
      expect(
        isGeographicallyRelevant("Bury St Edmunds", {
          url: "https://plymouth.thedata.place/summary.csv",
          description: "Plymouth offences 2003–2015",
        }),
      ).toBe(false);
    });

    it("returns false when description names a different location", () => {
      expect(
        isGeographicallyRelevant("Camden", {
          url: "https://data.example.com/crimes.csv",
          description: "Bristol crime statistics 2024",
        }),
      ).toBe(false);
    });

    it("returns true when URL contains part of the query location", () => {
      expect(
        isGeographicallyRelevant("Camden", {
          url: "https://data.gov.uk/camden-crime-2024.csv",
          description: "Crime data",
        }),
      ).toBe(true);
    });

    it("returns true when description contains part of the query location", () => {
      expect(
        isGeographicallyRelevant("Bury St Edmunds", {
          url: "https://data.gov.uk/crimes.csv",
          description: "Suffolk crime data 2024",
        }),
      ).toBe(true);
    });

    it("returns true when source has no location signal (national dataset — don't reject)", () => {
      expect(
        isGeographicallyRelevant("Gloucester", {
          url: "https://environment.data.gov.uk/flood-monitoring/id/floods",
          description: "UK flood monitoring API",
        }),
      ).toBe(true);
    });

    it("is case-insensitive", () => {
      expect(
        isGeographicallyRelevant("Bury St Edmunds", {
          url: "https://data.gov.uk/BURY-ST-EDMUNDS-crimes.csv",
          description: "Crime data",
        }),
      ).toBe(true);
    });
  });

  describe("applyFieldMap()", () => {
    it("handles null and undefined elements in rows without throwing", () => {
      const rows = [{ offence_type: "burglary" }, null, undefined];
      const fieldMap = { offence_type: "category" };
      expect(() => applyFieldMap(rows, fieldMap)).not.toThrow();
      const result = applyFieldMap(rows, fieldMap) as any[];
      expect(result[0]).toEqual({ category: "burglary" });
    });

    it("renames source fields to canonical names", async () => {
      const { applyFieldMap } = await import("../agent/shadow-adapter");
      const rows = [{ offence_type: "burglary", incident_date: "2024-01" }];
      const fieldMap = { offence_type: "category", incident_date: "month" };
      expect(applyFieldMap(rows, fieldMap)).toEqual([
        { category: "burglary", month: "2024-01" },
      ]);
    });

    it("passes through fields not in the fieldMap unchanged", async () => {
      const { applyFieldMap } = await import("../agent/shadow-adapter");
      const rows = [{ offence_type: "burglary", latitude: 52.2 }];
      const fieldMap = { offence_type: "category" };
      expect(applyFieldMap(rows, fieldMap)).toEqual([
        { category: "burglary", latitude: 52.2 },
      ]);
    });

    it("returns rows unchanged when fieldMap is empty", async () => {
      const { applyFieldMap } = await import("../agent/shadow-adapter");
      const rows = [{ category: "burglary", month: "2024-01" }];
      expect(applyFieldMap(rows, {})).toEqual(rows);
    });
  });

  describe("recover()", () => {
    it("returns null when disabled", async () => {
      delete process.env.SHADOW_ADAPTER_ENABLED;
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

    it("returns null when no candidate sources are found", async () => {
      process.env.SHADOW_ADAPTER_ENABLED = "true";
      vi.mocked(searchAlternativeSources).mockResolvedValueOnce([]);
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

    it("returns null when top candidate is geographically irrelevant", async () => {
      process.env.SHADOW_ADAPTER_ENABLED = "true";
      vi.mocked(searchAlternativeSources).mockResolvedValueOnce([
        {
          url: "https://plymouth.thedata.place/summary.csv",
          description: "Plymouth offences 2003–2015",
          confidence: 0.8,
        },
      ]);
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
      expect(sampleAndDetectFormat).not.toHaveBeenCalled();
    });

    it("returns null when sampled rows fail shape validation", async () => {
      process.env.SHADOW_ADAPTER_ENABLED = "true";
      vi.mocked(searchAlternativeSources).mockResolvedValueOnce([
        {
          url: "https://data.gov.uk/summary.csv",
          description: "Bury St Edmunds data",
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

    it("returns a result when geography and shape both pass", async () => {
      process.env.SHADOW_ADAPTER_ENABLED = "true";
      vi.mocked(searchAlternativeSources).mockResolvedValueOnce([
        {
          url: "https://data.gov.uk/bury-st-edmunds-crimes.csv",
          description: "Bury St Edmunds crime data 2024",
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
        "https://data.gov.uk/bury-st-edmunds-crimes.csv",
      );
    });
    it("applies fieldMap to rows before returning when config provides one", async () => {
      process.env.SHADOW_ADAPTER_ENABLED = "true";
      vi.mocked(searchAlternativeSources).mockResolvedValueOnce([
        {
          url: "https://data.gov.uk/bury-crimes.csv",
          description: "Bury St Edmunds crime data 2024",
          confidence: 0.7,
          fieldMap: { offence_type: "category", incident_date: "month" },
        },
      ]);
      vi.mocked(sampleAndDetectFormat).mockResolvedValueOnce({
        rows: [
          {
            offence_type: "burglary",
            incident_date: "2024-01",
            latitude: 52.2,
            longitude: 0.7,
          },
        ],
        format: "csv",
        sampleSize: 1,
      });

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
      expect(result!.data[0]).toMatchObject({
        category: "burglary",
        month: "2024-01",
      });
      expect(result!.data[0]).not.toHaveProperty("offence_type");
      expect(result!.data[0]).not.toHaveProperty("incident_date");
    });

    it("returns rows unchanged when no fieldMap is provided", async () => {
      process.env.SHADOW_ADAPTER_ENABLED = "true";
      vi.mocked(searchAlternativeSources).mockResolvedValueOnce([
        {
          url: "https://data.gov.uk/bury-crimes.csv",
          description: "Bury St Edmunds crime data 2024",
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
      expect(result!.data[0]).toMatchObject({
        category: "burglary",
        month: "2024-01",
      });
    });
  });
});
