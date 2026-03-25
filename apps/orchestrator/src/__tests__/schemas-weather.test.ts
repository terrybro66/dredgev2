import { describe, it, expect } from "vitest";
import {
  WeatherQueryPlanSchema,
  DomainConfigSchema,
  VizHintSchema,
} from "@dredge/schemas";
import { deriveVizHint } from "../intent";

// ── WeatherQueryPlanSchema ────────────────────────────────────────────────────

describe("WeatherQueryPlanSchema", () => {
  it("validates a minimal weather query with location and date range", () => {
    const result = WeatherQueryPlanSchema.safeParse({
      location: "Edinburgh, UK",
      date_from: "2024-03-01",
      date_to: "2024-03-07",
    });
    expect(result.success).toBe(true);
  });

  it("validates with an optional metric field", () => {
    const result = WeatherQueryPlanSchema.safeParse({
      location: "Bristol, UK",
      date_from: "2024-01-01",
      date_to: "2024-01-01",
      metric: "temperature",
    });
    expect(result.success).toBe(true);
  });

  it("accepts all valid metric values", () => {
    for (const metric of ["temperature", "precipitation", "wind"] as const) {
      const result = WeatherQueryPlanSchema.safeParse({
        location: "London, UK",
        date_from: "2024-01-01",
        date_to: "2024-01-01",
        metric,
      });
      expect(result.success).toBe(true);
    }
  });

  it("rejects an invalid metric value", () => {
    const result = WeatherQueryPlanSchema.safeParse({
      location: "London, UK",
      date_from: "2024-01-01",
      date_to: "2024-01-01",
      metric: "humidity",
    });
    expect(result.success).toBe(false);
  });

  it("rejects YYYY-MM date format — weather requires YYYY-MM-DD", () => {
    const result = WeatherQueryPlanSchema.safeParse({
      location: "Edinburgh, UK",
      date_from: "2024-03",
      date_to: "2024-03",
    });
    expect(result.success).toBe(false);
  });

  it("rejects coordinates as location", () => {
    const result = WeatherQueryPlanSchema.safeParse({
      location: "52.2053, 0.1218",
      date_from: "2024-01-01",
      date_to: "2024-01-01",
    });
    expect(result.success).toBe(false);
  });

  it("rejects missing location", () => {
    const result = WeatherQueryPlanSchema.safeParse({
      date_from: "2024-01-01",
      date_to: "2024-01-01",
    });
    expect(result.success).toBe(false);
  });

  it("rejects empty location string", () => {
    const result = WeatherQueryPlanSchema.safeParse({
      location: "",
      date_from: "2024-01-01",
      date_to: "2024-01-01",
    });
    expect(result.success).toBe(false);
  });
});

// ── Weather DomainConfig ──────────────────────────────────────────────────────

const WEATHER_DOMAIN_CONFIG = {
  name: "weather",
  tableName: "weather_results",
  prismaModel: "weatherResult",
  countries: [],
  intents: ["weather"],
  apiUrl: "https://api.openweathermap.org",
  apiKeyEnv: "OPENWEATHER_API_KEY",
  locationStyle: "coordinates" as const,
  params: {},
  flattenRow: {},
  categoryMap: {},
  vizHintRules: {
    defaultHint: "dashboard" as const,
    multiMonthHint: "dashboard" as const,
  },
  rateLimit: { requestsPerMinute: 60 },
  cacheTtlHours: 1,
};

describe("Weather DomainConfig", () => {
  it("passes Zod validation", () => {
    const result = DomainConfigSchema.safeParse(WEATHER_DOMAIN_CONFIG);
    expect(result.success).toBe(true);
  });

  it("has empty countries array — global routing", () => {
    expect(WEATHER_DOMAIN_CONFIG.countries).toHaveLength(0);
  });

  it("has cacheTtlHours of 1 — volatile data", () => {
    expect(WEATHER_DOMAIN_CONFIG.cacheTtlHours).toBe(1);
  });

  it("has rateLimit of 60 requests per minute", () => {
    expect(WEATHER_DOMAIN_CONFIG.rateLimit?.requestsPerMinute).toBe(60);
  });

  it("VizHint 'dashboard' is valid in the schema", () => {
    const result = VizHintSchema.safeParse("dashboard");
    expect(result.success).toBe(true);
  });
});

// ── deriveVizHint — weather ───────────────────────────────────────────────────

const WEATHER_PLAN = {
  location: "Edinburgh, UK",
  date_from: "2024-03-01",
  date_to: "2024-03-07",
};

const CRIME_PLAN = {
  category: "burglary" as const,
  date_from: "2024-01",
  date_to: "2024-01",
  location: "Cambridge, UK",
};

describe("deriveVizHint — weather intent", () => {
  it("returns 'dashboard' for a single-day weather query", () => {
    const plan = {
      ...WEATHER_PLAN,
      date_from: "2024-03-01",
      date_to: "2024-03-01",
    };
    expect(
      deriveVizHint(plan as any, "weather in Edinburgh today", "weather"),
    ).toBe("dashboard");
  });

  it("returns 'dashboard' for a multi-day weather query", () => {
    expect(
      deriveVizHint(
        WEATHER_PLAN as any,
        "weather in Edinburgh last week",
        "weather",
      ),
    ).toBe("dashboard");
  });

  it("returns 'dashboard' for a 30-day weather query", () => {
    const plan = {
      ...WEATHER_PLAN,
      date_from: "2024-03-01",
      date_to: "2024-03-30",
    };
    expect(
      deriveVizHint(plan as any, "weather in Edinburgh last month", "weather"),
    ).toBe("dashboard");
  });

  it("returns 'dashboard' regardless of raw text content when intent is weather", () => {
    expect(
      deriveVizHint(
        WEATHER_PLAN as any,
        "list weather in Edinburgh",
        "weather",
      ),
    ).toBe("dashboard");
    expect(
      deriveVizHint(
        WEATHER_PLAN as any,
        "show me weather in Edinburgh",
        "weather",
      ),
    ).toBe("dashboard");
    expect(
      deriveVizHint(
        WEATHER_PLAN as any,
        "table of weather in Edinburgh",
        "weather",
      ),
    ).toBe("dashboard");
  });
});

// ── deriveVizHint — crime regression ─────────────────────────────────────────

describe("deriveVizHint — crime intent (regression)", () => {
  it("returns 'map' for a single-month crime query", () => {
    expect(
      deriveVizHint(CRIME_PLAN, "burglaries in Cambridge in January 2024"),
    ).toBe("map");
  });

  it("returns 'bar' for a multi-month crime query", () => {
    const plan = { ...CRIME_PLAN, date_from: "2023-07", date_to: "2024-01" };
    expect(deriveVizHint(plan, "burglaries in Cambridge last 6 months")).toBe(
      "bar",
    );
  });

  it("returns 'table' when query contains list keywords", () => {
    expect(deriveVizHint(CRIME_PLAN, "list burglaries in Cambridge")).toBe(
      "table",
    );
    expect(deriveVizHint(CRIME_PLAN, "show me burglaries in Cambridge")).toBe(
      "table",
    );
    expect(
      deriveVizHint(CRIME_PLAN, "what are the burglaries in Cambridge"),
    ).toBe("table");
  });

  it("default intent parameter is 'crime' — existing call sites unaffected", () => {
    // Call without intent arg — should behave identically to before
    expect(
      deriveVizHint(CRIME_PLAN, "burglaries in Cambridge in January 2024"),
    ).toBe("map");
    expect(
      deriveVizHint(
        { ...CRIME_PLAN, date_from: "2023-07", date_to: "2024-01" },
        "burglaries last 6 months",
      ),
    ).toBe("bar");
  });
});
