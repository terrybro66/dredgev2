import { describe, it, expect } from "vitest";
import {
  WeatherQueryPlanSchema,
  AggregatedBinSchema,
  VizHintSchema,
} from "../index";

// ── WeatherQueryPlanSchema ────────────────────────────────────────────────────

describe("WeatherQueryPlanSchema", () => {
  const valid = {
    location: "Edinburgh",
    date_from: "2024-03-01",
    date_to: "2024-03-07",
  };

  it("accepts a valid plan with location and date range", () => {
    expect(() => WeatherQueryPlanSchema.parse(valid)).not.toThrow();
  });

  it("accepts an optional metric: temperature", () => {
    expect(() =>
      WeatherQueryPlanSchema.parse({ ...valid, metric: "temperature" })
    ).not.toThrow();
  });

  it("accepts an optional metric: precipitation", () => {
    expect(() =>
      WeatherQueryPlanSchema.parse({ ...valid, metric: "precipitation" })
    ).not.toThrow();
  });

  it("accepts an optional metric: wind", () => {
    expect(() =>
      WeatherQueryPlanSchema.parse({ ...valid, metric: "wind" })
    ).not.toThrow();
  });

  it("passes when metric is absent", () => {
    const { metric, ...withoutMetric } = { ...valid, metric: "wind" };
    expect(() => WeatherQueryPlanSchema.parse(valid)).not.toThrow();
  });

  it("rejects an unknown metric value", () => {
    expect(() =>
      WeatherQueryPlanSchema.parse({ ...valid, metric: "humidity" })
    ).toThrow();
  });

  it("rejects a missing location", () => {
    const { location, ...noLocation } = valid;
    expect(() => WeatherQueryPlanSchema.parse(noLocation)).toThrow();
  });

  it("rejects an empty location string", () => {
    expect(() =>
      WeatherQueryPlanSchema.parse({ ...valid, location: "" })
    ).toThrow();
  });

  it("rejects a location that looks like coordinates", () => {
    expect(() =>
      WeatherQueryPlanSchema.parse({ ...valid, location: "52.2, -0.1" })
    ).toThrow();
  });

  it("rejects a location that looks like coordinates without spaces", () => {
    expect(() =>
      WeatherQueryPlanSchema.parse({ ...valid, location: "52.2,-0.1" })
    ).toThrow();
  });

  it("rejects a missing date_from", () => {
    const { date_from, ...noDateFrom } = valid;
    expect(() => WeatherQueryPlanSchema.parse(noDateFrom)).toThrow();
  });

  it("rejects a missing date_to", () => {
    const { date_to, ...noDateTo } = valid;
    expect(() => WeatherQueryPlanSchema.parse(noDateTo)).toThrow();
  });

  it("rejects date_from in YYYY-MM format (must be YYYY-MM-DD)", () => {
    expect(() =>
      WeatherQueryPlanSchema.parse({ ...valid, date_from: "2024-03" })
    ).toThrow();
  });

  it("rejects date_to in YYYY-MM format (must be YYYY-MM-DD)", () => {
    expect(() =>
      WeatherQueryPlanSchema.parse({ ...valid, date_to: "2024-03" })
    ).toThrow();
  });

  it("rejects a date_from with invalid format", () => {
    expect(() =>
      WeatherQueryPlanSchema.parse({ ...valid, date_from: "01-03-2024" })
    ).toThrow();
  });

  it("returns typed output with correct field values", () => {
    const result = WeatherQueryPlanSchema.parse({
      ...valid,
      metric: "precipitation",
    });
    expect(result.location).toBe("Edinburgh");
    expect(result.date_from).toBe("2024-03-01");
    expect(result.date_to).toBe("2024-03-07");
    expect(result.metric).toBe("precipitation");
  });
});

// ── AggregatedBinSchema ───────────────────────────────────────────────────────

describe("AggregatedBinSchema", () => {
  const valid = { lat: 52.205, lon: 0.121, count: 14 };

  it("accepts a valid bin with lat, lon, and count", () => {
    expect(() => AggregatedBinSchema.parse(valid)).not.toThrow();
  });

  it("rejects a missing lat", () => {
    const { lat, ...noLat } = valid;
    expect(() => AggregatedBinSchema.parse(noLat)).toThrow();
  });

  it("rejects a missing lon", () => {
    const { lon, ...noLon } = valid;
    expect(() => AggregatedBinSchema.parse(noLon)).toThrow();
  });

  it("rejects a missing count", () => {
    const { count, ...noCount } = valid;
    expect(() => AggregatedBinSchema.parse(noCount)).toThrow();
  });

  it("rejects count of zero — bins must have at least one incident", () => {
    expect(() =>
      AggregatedBinSchema.parse({ ...valid, count: 0 })
    ).toThrow();
  });

  it("rejects a negative count", () => {
    expect(() =>
      AggregatedBinSchema.parse({ ...valid, count: -1 })
    ).toThrow();
  });

  it("rejects a non-integer count", () => {
    expect(() =>
      AggregatedBinSchema.parse({ ...valid, count: 1.5 })
    ).toThrow();
  });

  it("rejects a string lat", () => {
    expect(() =>
      AggregatedBinSchema.parse({ ...valid, lat: "52.205" })
    ).toThrow();
  });

  it("returns typed output with correct field values", () => {
    const result = AggregatedBinSchema.parse(valid);
    expect(result.lat).toBe(52.205);
    expect(result.lon).toBe(0.121);
    expect(result.count).toBe(14);
  });
});

// ── VizHint — dashboard value (new in v6.0) ───────────────────────────────────

describe("VizHintSchema — dashboard", () => {
  it('accepts "dashboard" as a valid viz hint', () => {
    expect(() => VizHintSchema.parse("dashboard")).not.toThrow();
  });

  it('accepts all pre-existing hints alongside "dashboard"', () => {
    for (const hint of ["map", "bar", "table", "heatmap", "dashboard"]) {
      expect(() => VizHintSchema.parse(hint)).not.toThrow();
    }
  });

  it("rejects an unknown hint value", () => {
    expect(() => VizHintSchema.parse("pie")).toThrow();
  });

  it("rejects an empty string", () => {
    expect(() => VizHintSchema.parse("")).toThrow();
  });
});
