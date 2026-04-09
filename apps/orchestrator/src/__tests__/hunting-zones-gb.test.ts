/**
 * hunting-zones-gb.test.ts — Phase D.10
 *
 * Tests for:
 *   - fetchHuntingZones() — ArcGIS response parsing
 *   - huntingZonesGbAdapter metadata and flattenRow()
 *   - curated-registry entry for "hunting zones"
 *   - domain-relationships includes hunting-zones-gb entries
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock fetch ────────────────────────────────────────────────────────────────

function makeArcGISResponse(features: object[]) {
  return {
    ok: true,
    json: async () => ({ features }),
  };
}

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

const SAMPLE_FEATURE = {
  attributes: {
    OBJECTID:   1,
    NAME:       "Dartmoor National Park Open Access",
    COUNTY:     "Devon",
    CATEGORY:   "Open Country",
    Shape_Area: 95432000,  // m² → ~9543 ha
  },
  centroid: { x: -3.9, y: 50.6 },
};

const FEATURE_NO_NAME = {
  attributes: { OBJECTID: 2, NAME: "", COUNTY: "Cornwall", Shape_Area: 5000 },
  centroid: { x: -5.1, y: 50.2 },
};

const FEATURE_GEOMETRY_FALLBACK = {
  attributes: {
    OBJECTID:   3,
    NAME:       "Kielder Forest",
    COUNTY:     "Northumberland",
    Shape_Area: 60000000,
  },
  geometry: { rings: [[[-2.5, 55.2], [-2.4, 55.3], [-2.5, 55.2]]] },
};

// ── fetchHuntingZones ─────────────────────────────────────────────────────────

import { fetchHuntingZones } from "../domains/hunting-zones-gb/fetcher";

beforeEach(() => {
  mockFetch.mockReset();
});

describe("fetchHuntingZones", () => {
  it("returns parsed rows from a valid ArcGIS response", async () => {
    mockFetch.mockResolvedValue(makeArcGISResponse([SAMPLE_FEATURE]));
    const rows = await fetchHuntingZones(null);
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe("Dartmoor National Park Open Access");
  });

  it("extracts lat and lon from centroid", async () => {
    mockFetch.mockResolvedValue(makeArcGISResponse([SAMPLE_FEATURE]));
    const rows = await fetchHuntingZones(null);
    expect(rows[0].lat).toBeCloseTo(50.6);
    expect(rows[0].lon).toBeCloseTo(-3.9);
  });

  it("falls back to geometry rings when centroid is absent", async () => {
    mockFetch.mockResolvedValue(makeArcGISResponse([FEATURE_GEOMETRY_FALLBACK]));
    const rows = await fetchHuntingZones(null);
    expect(rows[0].lat).toBe(55.2);
    expect(rows[0].lon).toBe(-2.5);
  });

  it("converts Shape_Area m² to hectares", async () => {
    mockFetch.mockResolvedValue(makeArcGISResponse([SAMPLE_FEATURE]));
    const rows = await fetchHuntingZones(null);
    expect(rows[0].area_ha).toBe(9543); // Math.round(95432000 / 10000)
  });

  it("skips features with no NAME", async () => {
    mockFetch.mockResolvedValue(
      makeArcGISResponse([SAMPLE_FEATURE, FEATURE_NO_NAME]),
    );
    const rows = await fetchHuntingZones(null);
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe("Dartmoor National Park Open Access");
  });

  it("returns county and access_type", async () => {
    mockFetch.mockResolvedValue(makeArcGISResponse([SAMPLE_FEATURE]));
    const rows = await fetchHuntingZones(null);
    expect(rows[0].county).toBe("Devon");
    expect(rows[0].access_type).toBe("Open Country");
  });

  it("returns empty array when features is empty", async () => {
    mockFetch.mockResolvedValue(makeArcGISResponse([]));
    const rows = await fetchHuntingZones(null);
    expect(rows).toHaveLength(0);
  });

  it("throws on non-ok HTTP response", async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 503, json: async () => ({}) });
    await expect(fetchHuntingZones(null)).rejects.toThrow("503");
  });

  it("throws when ArcGIS returns an error object", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ error: { message: "Invalid query" } }),
    });
    await expect(fetchHuntingZones(null)).rejects.toThrow("Invalid query");
  });

  it("includes geometry bbox params when polygon is supplied", async () => {
    mockFetch.mockResolvedValue(makeArcGISResponse([]));
    await fetchHuntingZones("51.0 -2.0 51.5 -1.5 51.0 -2.0");
    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain("geometry=");
    expect(calledUrl).toContain("geometryType=esriGeometryEnvelope");
  });
});

// ── huntingZonesGbAdapter ─────────────────────────────────────────────────────

import { huntingZonesGbAdapter } from "../domains/hunting-zones-gb/index";

describe("huntingZonesGbAdapter metadata", () => {
  it("has name hunting-zones-gb", () => {
    expect(huntingZonesGbAdapter.config.name).toBe("hunting-zones-gb");
  });

  it("is scoped to GB", () => {
    expect(huntingZonesGbAdapter.config.countries).toContain("GB");
  });

  it("handles hunting zones intent", () => {
    expect(huntingZonesGbAdapter.config.intents).toContain("hunting zones");
  });

  it("stores results persistently (Track A)", () => {
    expect(huntingZonesGbAdapter.config.storeResults).toBe(true);
  });

  it("defaults viz hint to map", () => {
    expect(huntingZonesGbAdapter.config.vizHintRules.defaultHint).toBe("map");
  });
});

describe("huntingZonesGbAdapter.flattenRow", () => {
  const row = {
    name:        "Dartmoor National Park Open Access",
    county:      "Devon",
    area_ha:     9543,
    lat:         50.6,
    lon:         -3.9,
    access_type: "Open Country",
    source_id:   "1",
  };

  it("maps name to description", () => {
    const flat = huntingZonesGbAdapter.flattenRow(row);
    expect(flat.description).toBe(row.name);
  });

  it("maps county to location", () => {
    const flat = huntingZonesGbAdapter.flattenRow(row);
    expect(flat.location).toBe("Devon");
  });

  it("maps area_ha to value", () => {
    const flat = huntingZonesGbAdapter.flattenRow(row);
    expect(flat.value).toBe(9543);
  });

  it("preserves lat and lon", () => {
    const flat = huntingZonesGbAdapter.flattenRow(row);
    expect(flat.lat).toBeCloseTo(50.6);
    expect(flat.lon).toBeCloseTo(-3.9);
  });

  it("falls back to name when county is null", () => {
    const noCounty = { ...row, county: null };
    const flat = huntingZonesGbAdapter.flattenRow(noCounty);
    expect(flat.location).toBe(row.name);
  });

  it("defaults category to Open Access Land when access_type is null", () => {
    const noType = { ...row, access_type: null };
    const flat = huntingZonesGbAdapter.flattenRow(noType);
    expect(flat.category).toBe("Open Access Land");
  });

  it("stores extras with area_ha, access_type, source_id, county", () => {
    const flat = huntingZonesGbAdapter.flattenRow(row);
    const extras = flat.extras as Record<string, unknown>;
    expect(extras.area_ha).toBe(9543);
    expect(extras.access_type).toBe("Open Country");
    expect(extras.source_id).toBe("1");
    expect(extras.county).toBe("Devon");
  });
});

// ── curated registry entry ────────────────────────────────────────────────────

import { findCuratedSource } from "../curated-registry";

describe("curated registry — hunting zones", () => {
  it("findCuratedSource returns an entry for hunting zones / GB", () => {
    const source = findCuratedSource("hunting zones", "GB");
    expect(source).not.toBeNull();
    expect(source!.name).toContain("Natural England");
  });

  it("entry is type rest and stores results", () => {
    const source = findCuratedSource("hunting zones", "GB");
    expect(source!.type).toBe("rest");
    expect(source!.storeResults).toBe(true);
  });

  it("entry has weekly refresh policy", () => {
    const source = findCuratedSource("hunting zones", "GB");
    expect(source!.refreshPolicy).toBe("weekly");
  });

  it("does not match for non-GB country codes", () => {
    const source = findCuratedSource("hunting zones", "US");
    expect(source).toBeNull();
  });
});

// ── domain relationships ──────────────────────────────────────────────────────

import { DOMAIN_RELATIONSHIPS } from "../domain-relationships";

describe("domain-relationships — hunting-zones-gb", () => {
  it("includes hunting-zones-gb → transport relationship", () => {
    const rel = DOMAIN_RELATIONSHIPS.find(
      (r) => r.fromDomain === "hunting-zones-gb" && r.toDomain === "transport",
    );
    expect(rel).toBeDefined();
    expect(rel!.weight).toBeGreaterThanOrEqual(0.8);
  });

  it("includes hunting-zones-gb → weather relationship", () => {
    const rel = DOMAIN_RELATIONSHIPS.find(
      (r) => r.fromDomain === "hunting-zones-gb" && r.toDomain === "weather",
    );
    expect(rel).toBeDefined();
    expect(rel!.weight).toBeGreaterThan(0);
  });
});
