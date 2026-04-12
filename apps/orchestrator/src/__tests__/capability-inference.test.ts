import { describe, it, expect } from "vitest";
import { inferCapabilities, generateChips } from "../capability-inference";
import type { ResultHandle, Chip } from "../types/connected";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeHandle(
  overrides: Partial<ResultHandle> & { data: unknown[] },
): ResultHandle {
  return {
    id: "qr_1",
    type: "test_result",
    domain: "test-domain",
    capabilities: [],
    ephemeral: false,
    rowCount: overrides.data.length,
    ...overrides,
  };
}

// ── inferCapabilities ─────────────────────────────────────────────────────────

describe("inferCapabilities", () => {
  describe("has_coordinates", () => {
    it("returns has_coordinates when ≥ 80% of rows have lat + lon", () => {
      const rows = [
        { lat: 51.5, lon: -0.1 },
        { lat: 51.6, lon: -0.2 },
        { lat: 51.7, lon: -0.3 },
        { lat: 51.8, lon: -0.4 },
        { lat: 51.9, lon: -0.5 },
      ];
      expect(inferCapabilities(rows)).toContain("has_coordinates");
    });

    it("accepts latitude / longitude field names", () => {
      const rows = [
        { latitude: 51.5, longitude: -0.1 },
        { latitude: 51.6, longitude: -0.2 },
      ];
      expect(inferCapabilities(rows)).toContain("has_coordinates");
    });

    it("does NOT return has_coordinates when fewer than 80% have coords", () => {
      const rows = [
        { lat: 51.5, lon: -0.1 },
        { lat: 51.6, lon: -0.2 },
        { description: "no coords" },
        { description: "no coords" },
        { description: "no coords" },
      ];
      expect(inferCapabilities(rows)).not.toContain("has_coordinates");
    });

    it("does NOT return has_coordinates for empty rows", () => {
      expect(inferCapabilities([])).not.toContain("has_coordinates");
    });

    it("does NOT return has_coordinates when lat is null", () => {
      const rows = [{ lat: null, lon: -0.1 }, { lat: null, lon: -0.2 }];
      expect(inferCapabilities(rows)).not.toContain("has_coordinates");
    });
  });

  describe("has_time_series", () => {
    it("returns has_time_series when rows span ≥ 2 distinct dates with a value field", () => {
      const rows = [
        { date: "2025-01", value: 10 },
        { date: "2025-02", value: 15 },
        { date: "2025-03", value: 12 },
      ];
      expect(inferCapabilities(rows)).toContain("has_time_series");
    });

    it("returns has_time_series when rows have a count field instead of value", () => {
      const rows = [
        { date: "2025-01", count: 100 },
        { date: "2025-02", count: 120 },
      ];
      expect(inferCapabilities(rows)).toContain("has_time_series");
    });

    it("does NOT return has_time_series with only 1 distinct date", () => {
      const rows = [
        { date: "2025-01", value: 10 },
        { date: "2025-01", value: 15 },
      ];
      expect(inferCapabilities(rows)).not.toContain("has_time_series");
    });

    it("does NOT return has_time_series when there is no value or count field", () => {
      const rows = [
        { date: "2025-01", description: "event" },
        { date: "2025-02", description: "event" },
      ];
      expect(inferCapabilities(rows)).not.toContain("has_time_series");
    });

    it("does NOT return has_time_series when there is no date field", () => {
      const rows = [{ value: 10 }, { value: 15 }];
      expect(inferCapabilities(rows)).not.toContain("has_time_series");
    });
  });

  describe("has_polygon", () => {
    it("returns has_polygon when any row has GeoJSON Polygon geometry", () => {
      const rows = [
        {
          geometry: {
            type: "Polygon",
            coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]],
          },
        },
      ];
      expect(inferCapabilities(rows)).toContain("has_polygon");
    });

    it("returns has_polygon for MultiPolygon", () => {
      const rows = [{ geometry: { type: "MultiPolygon", coordinates: [] } }];
      expect(inferCapabilities(rows)).toContain("has_polygon");
    });

    it("does NOT return has_polygon for Point geometry", () => {
      const rows = [{ geometry: { type: "Point", coordinates: [0, 0] } }];
      expect(inferCapabilities(rows)).not.toContain("has_polygon");
    });

    it("does NOT return has_polygon when no geometry field", () => {
      const rows = [{ lat: 51.5, lon: -0.1 }];
      expect(inferCapabilities(rows)).not.toContain("has_polygon");
    });
  });

  describe("has_schedule", () => {
    it("returns has_schedule when rows have start_time and end_time", () => {
      const rows = [
        { start_time: "19:30", end_time: "21:30", title: "Show A" },
        { start_time: "20:00", end_time: "22:00", title: "Show B" },
      ];
      expect(inferCapabilities(rows)).toContain("has_schedule");
    });

    it("returns has_schedule when start_time / end_time are in extras", () => {
      const rows = [
        { extras: { start_time: "19:30", end_time: "21:30" } },
      ];
      expect(inferCapabilities(rows)).toContain("has_schedule");
    });

    it("does NOT return has_schedule with only start_time", () => {
      const rows = [{ start_time: "19:30", title: "Show" }];
      expect(inferCapabilities(rows)).not.toContain("has_schedule");
    });
  });

  describe("has_category", () => {
    it("returns has_category when rows have ≥ 2 distinct non-null category values", () => {
      const rows = [
        { category: "comedy" },
        { category: "theatre" },
        { category: "comedy" },
      ];
      expect(inferCapabilities(rows)).toContain("has_category");
    });

    it("does NOT return has_category when all rows share the same category", () => {
      const rows = [{ category: "comedy" }, { category: "comedy" }];
      expect(inferCapabilities(rows)).not.toContain("has_category");
    });

    it("does NOT return has_category when category is null/missing", () => {
      const rows = [{ category: null }, { description: "no category" }];
      expect(inferCapabilities(rows)).not.toContain("has_category");
    });
  });

  describe("multiple capabilities", () => {
    it("returns multiple capabilities when rows qualify for several", () => {
      const rows = [
        { lat: 51.5, lon: -0.1, date: "2025-01", value: 10, category: "A" },
        { lat: 51.6, lon: -0.2, date: "2025-02", value: 20, category: "B" },
        { lat: 51.7, lon: -0.3, date: "2025-03", value: 15, category: "A" },
      ];
      const caps = inferCapabilities(rows);
      expect(caps).toContain("has_coordinates");
      expect(caps).toContain("has_time_series");
      expect(caps).toContain("has_category");
    });
  });
});

// ── generateChips ─────────────────────────────────────────────────────────────

describe("generateChips", () => {
  it("generates show_map and calculate_travel from has_coordinates", () => {
    const handle = makeHandle({
      data: [{ lat: 51.5, lon: -0.1 }],
      capabilities: ["has_coordinates"],
    });
    const chips = generateChips(handle);
    const actions = chips.map((c) => c.action);
    expect(actions).toContain("show_map");
    expect(actions).toContain("calculate_travel");
  });

  it("generates show_chart from has_time_series", () => {
    const handle = makeHandle({
      data: [{ date: "2025-01", value: 10 }, { date: "2025-02", value: 20 }],
      capabilities: ["has_time_series"],
    });
    const chips = generateChips(handle);
    expect(chips.map((c) => c.action)).toContain("show_chart");
  });

  it("generates overlay_spatial from has_polygon", () => {
    const handle = makeHandle({
      data: [{ geometry: { type: "Polygon", coordinates: [] } }],
      capabilities: ["has_polygon"],
    });
    const chips = generateChips(handle);
    expect(chips.map((c) => c.action)).toContain("overlay_spatial");
  });

  it("generates filter_by (no_overlap) from has_schedule", () => {
    const handle = makeHandle({
      data: [{ start_time: "19:30", end_time: "21:30" }],
      capabilities: ["has_schedule"],
    });
    const chips = generateChips(handle);
    const filterChip = chips.find(
      (c) => c.action === "filter_by" && c.args.constraint === "no_overlap",
    );
    expect(filterChip).toBeDefined();
    expect(filterChip!.label).toMatch(/clash|overlap/i);
  });

  it("generates filter_by (category) from has_category", () => {
    const handle = makeHandle({
      data: [{ category: "A" }, { category: "B" }],
      capabilities: ["has_category"],
    });
    const chips = generateChips(handle);
    const filterChip = chips.find(
      (c) => c.action === "filter_by" && c.args.field === "category",
    );
    expect(filterChip).toBeDefined();
  });

  it("generates clarify chip from has_regulatory_reference", () => {
    const handle = makeHandle({
      data: [],
      capabilities: ["has_regulatory_reference"],
    });
    const chips = generateChips(handle);
    expect(chips.map((c) => c.action)).toContain("clarify");
  });

  it("chip args carry the handle id as ref", () => {
    const handle = makeHandle({
      id: "qr_42",
      data: [{ lat: 51.5, lon: -0.1 }],
      capabilities: ["has_coordinates"],
    });
    const chips = generateChips(handle);
    for (const chip of chips) {
      expect(chip.args.ref).toBe("qr_42");
    }
  });

  it("returns empty array for a handle with no capabilities", () => {
    const handle = makeHandle({ data: [{ description: "bare row" }], capabilities: [] });
    expect(generateChips(handle)).toHaveLength(0);
  });

  it("returns no duplicate actions for the same capability", () => {
    const handle = makeHandle({
      data: [{ lat: 51.5, lon: -0.1 }],
      capabilities: ["has_coordinates"],
    });
    const chips = generateChips(handle);
    const actions = chips.map((c) => c.action);
    const unique = new Set(actions);
    expect(unique.size).toBe(actions.length);
  });

  // ── B4: transport chip suppression ─────────────────────────────────────────

  it("does NOT generate calculate_travel for crime-uk domain", () => {
    const handle = makeHandle({
      domain: "crime-uk",
      data: [{ lat: 51.5, lon: -0.1 }, { lat: 51.6, lon: -0.2 }],
      capabilities: ["has_coordinates"],
    });
    const chips = generateChips(handle);
    expect(chips.map((c) => c.action)).not.toContain("calculate_travel");
  });

  it("still generates show_map for crime-uk (only calculate_travel suppressed)", () => {
    const handle = makeHandle({
      domain: "crime-uk",
      data: [{ lat: 51.5, lon: -0.1 }, { lat: 51.6, lon: -0.2 }],
      capabilities: ["has_coordinates"],
    });
    const chips = generateChips(handle);
    expect(chips.map((c) => c.action)).toContain("show_map");
  });

  it("DOES generate calculate_travel for non-crime domains with coordinates", () => {
    const handle = makeHandle({
      domain: "cinemas-gb",
      data: [{ lat: 51.5, lon: -0.1 }],
      capabilities: ["has_coordinates"],
    });
    const chips = generateChips(handle);
    expect(chips.map((c) => c.action)).toContain("calculate_travel");
  });
});
