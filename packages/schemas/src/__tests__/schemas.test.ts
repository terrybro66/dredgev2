import { describe, it, expect } from "vitest";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Re-import everything from your schemas package. Adjust the import path to
// match your actual package name / workspace alias.
// ---------------------------------------------------------------------------
import {
  // crime domain
  CrimeCategory,
  CrimeCategorySlugs,
  QueryPlanSchema,
  ParsedQuerySchema,
  IntentErrorSchema,
  PoliceCrimeSchema,
  CrimeResultSchema,

  // domain config
  LocationStyle,
  DomainConfigSchema,

  // cache + job  (new in v4.1)
  QueryCacheEntrySchema,
  GeocoderCacheEntrySchema,
  QueryJobSchema,

  // shared utility
  NominatimResponseSchema,
  CoordinatesSchema,
  PolygonSchema,
  PostgresColumnType,
  AddColumnSchema,
} from "@dredge/schemas";

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------
const validQueryPlan = {
  category: "burglary",
  date_from: "2024-01",
  date_to: "2024-03",
  location: "Cambridge, UK",
};

const validDomainConfig = {
  name: "crime-uk",
  tableName: "crime_results",
  prismaModel: "crimeResult",
  countries: ["GB"],
  intents: ["crime"],
  apiUrl: "https://data.police.uk/api",
  apiKeyEnv: null,
  locationStyle: "polygon" as const,
  params: {},
  flattenRow: { raw: "$" },
  categoryMap: { burglary: "burglary" },
  vizHintRules: { defaultHint: "map" as const, multiMonthHint: "bar" as const },
};

// ---------------------------------------------------------------------------
// CrimeCategory / slugs
// ---------------------------------------------------------------------------
describe("CrimeCategorySlugs", () => {
  it("includes all expected slugs", () => {
    const expected = [
      "all-crime",
      "anti-social-behaviour",
      "bicycle-theft",
      "burglary",
      "criminal-damage-arson",
      "drugs",
      "other-theft",
      "possession-of-weapons",
      "public-order",
      "robbery",
      "shoplifting",
      "theft-from-the-person",
      "vehicle-crime",
      "violent-crime",
      "other-crime",
    ];
    expected.forEach((slug) => expect(CrimeCategorySlugs).toContain(slug));
  });

  it("has exactly 15 slugs", () => {
    expect(CrimeCategorySlugs).toHaveLength(15);
  });
});

describe("CrimeCategory enum", () => {
  it("parses a valid slug", () => {
    expect(() => CrimeCategory.parse("burglary")).not.toThrow();
  });

  it("rejects an unknown slug", () => {
    expect(() => CrimeCategory.parse("jaywalking")).toThrow();
  });
});

// ---------------------------------------------------------------------------
// QueryPlanSchema
// ---------------------------------------------------------------------------
describe("QueryPlanSchema", () => {
  it("parses a valid plan", () => {
    const result = QueryPlanSchema.parse(validQueryPlan);
    expect(result.category).toBe("burglary");
    expect(result.date_from).toBe("2024-01");
    expect(result.date_to).toBe("2024-03");
    expect(result.location).toBe("Cambridge, UK");
  });

  it("accepts non-crime category strings for non-crime domains", () => {
    // category is now a union of CrimeCategorySchema | z.string().min(1)
    // to allow flood-risk, cinema-listings, etc.
    expect(() =>
      QueryPlanSchema.parse({ ...validQueryPlan, category: "jaywalking" }),
    ).not.toThrow();
  });

  it("rejects an empty category string", () => {
    expect(() =>
      QueryPlanSchema.parse({ ...validQueryPlan, category: "" }),
    ).toThrow();
  });

  it("rejects date_from not in YYYY-MM format", () => {
    expect(() =>
      QueryPlanSchema.parse({ ...validQueryPlan, date_from: "January 2024" }),
    ).toThrow();
  });

  it("rejects date_to not in YYYY-MM format", () => {
    expect(() =>
      QueryPlanSchema.parse({ ...validQueryPlan, date_to: "2024/03" }),
    ).toThrow();
  });

  it("rejects a coordinate string as location", () => {
    expect(() =>
      QueryPlanSchema.parse({ ...validQueryPlan, location: "52.2053,0.1218" }),
    ).toThrow();
  });

  it("rejects missing fields", () => {
    expect(() => QueryPlanSchema.parse({})).toThrow();
  });

  it("does not include viz_hint", () => {
    const result = QueryPlanSchema.parse(validQueryPlan);
    expect(result).not.toHaveProperty("viz_hint");
  });
});

// ---------------------------------------------------------------------------
// ParsedQuerySchema
// ---------------------------------------------------------------------------
describe("ParsedQuerySchema", () => {
  const validParsed = {
    ...validQueryPlan,
    viz_hint: "map",
    resolved_location: "Cambridge, Cambridgeshire, England",
    months: ["2024-01", "2024-02", "2024-03"],
  };

  it("parses a valid parsed query", () => {
    const result = ParsedQuerySchema.parse(validParsed);
    expect(result.viz_hint).toBe("map");
    expect(result.resolved_location).toBe("Cambridge, Cambridgeshire, England");
    expect(result.months).toHaveLength(3);
  });

  it("accepts all valid viz_hint values", () => {
    (["map", "bar", "table"] as const).forEach((hint) => {
      expect(() =>
        ParsedQuerySchema.parse({ ...validParsed, viz_hint: hint }),
      ).not.toThrow();
    });
  });

  it("rejects an invalid viz_hint", () => {
    expect(() =>
      ParsedQuerySchema.parse({ ...validParsed, viz_hint: "chart" }),
    ).toThrow();
  });

  it("rejects empty months array", () => {
    expect(() =>
      ParsedQuerySchema.parse({ ...validParsed, months: [] }),
    ).toThrow();
  });

  it("requires resolved_location", () => {
    const { resolved_location, ...rest } = validParsed;
    expect(() => ParsedQuerySchema.parse(rest)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// IntentErrorSchema
// ---------------------------------------------------------------------------
describe("IntentErrorSchema", () => {
  it("parses a valid incomplete_intent error", () => {
    const result = IntentErrorSchema.parse({
      error: "incomplete_intent",
      understood: { category: "burglary" },
      missing: ["location"],
      message: "Please specify a location",
    });
    expect(result.error).toBe("incomplete_intent");
    expect(result.missing).toContain("location");
  });

  it("parses a geocode_failed error", () => {
    expect(() =>
      IntentErrorSchema.parse({
        error: "geocode_failed",
        understood: {},
        missing: [],
        message: "Could not geocode: Narnia",
      }),
    ).not.toThrow();
  });

  it("rejects an unknown error type", () => {
    expect(() =>
      IntentErrorSchema.parse({
        error: "server_exploded",
        understood: {},
        missing: [],
        message: "boom",
      }),
    ).toThrow();
  });

  it("allows empty understood object", () => {
    expect(() =>
      IntentErrorSchema.parse({
        error: "invalid_intent",
        understood: {},
        missing: ["category", "location"],
        message: "Could not understand query",
      }),
    ).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// PoliceCrimeSchema
// ---------------------------------------------------------------------------
describe("PoliceCrimeSchema", () => {
  const validCrime = {
    category: "burglary",
    location_type: "Force",
    location: {
      latitude: "52.205337",
      longitude: "0.121817",
      street: { id: 883498, name: "On or near Thornton Road" },
    },
    context: "",
    outcome_status: null,
    persistent_id: "abc123",
    id: 76399121,
    location_subtype: "",
    month: "2024-01",
  };

  it("parses a valid crime object", () => {
    const result = PoliceCrimeSchema.parse(validCrime);
    expect(result.category).toBe("burglary");
  });

  it("preserves unknown fields via passthrough", () => {
    const result = PoliceCrimeSchema.parse({
      ...validCrime,
      undocumented_future_field: "some_value",
    });
    expect((result as any).undocumented_future_field).toBe("some_value");
  });
});

// ---------------------------------------------------------------------------
// CrimeResultSchema
// ---------------------------------------------------------------------------
describe("CrimeResultSchema", () => {
  it("parses a valid crime result", () => {
    const result = CrimeResultSchema.parse({
      id: "clxxx",
      query_id: "qid123",
      category: "burglary",
      month: "2024-01",
      street: "On or near Thornton Road",
      latitude: 52.205337,
      longitude: 0.121817,
    });
    expect(result.latitude).toBeTypeOf("number");
    expect(result.longitude).toBeTypeOf("number");
  });

  it("latitude and longitude are numbers, not strings", () => {
    expect(() =>
      CrimeResultSchema.parse({
        id: "clxxx",
        query_id: "qid123",
        category: "burglary",
        month: "2024-01",
        latitude: "52.205337",
        longitude: "0.121817",
      }),
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// LocationStyle
// ---------------------------------------------------------------------------
describe("LocationStyle", () => {
  it("accepts polygon", () => {
    expect(() => LocationStyle.parse("polygon")).not.toThrow();
  });

  it("accepts coordinates", () => {
    expect(() => LocationStyle.parse("coordinates")).not.toThrow();
  });

  it("rejects anything else", () => {
    expect(() => LocationStyle.parse("bounding_box")).toThrow();
  });
});

// ---------------------------------------------------------------------------
// DomainConfigSchema  (v4.1 — includes prismaModel and intents)
// ---------------------------------------------------------------------------
describe("DomainConfigSchema", () => {
  it("parses a valid domain config", () => {
    const result = DomainConfigSchema.parse(validDomainConfig);
    expect(result.name).toBe("crime-uk");
    expect(result.prismaModel).toBe("crimeResult");
    expect(result.intents).toContain("crime");
  });

  it("requires prismaModel", () => {
    const { prismaModel, ...rest } = validDomainConfig;
    expect(() => DomainConfigSchema.parse(rest)).toThrow();
  });

  it("requires intents array", () => {
    const { intents, ...rest } = validDomainConfig;
    expect(() => DomainConfigSchema.parse(rest)).toThrow();
  });

  it("rejects empty intents array", () => {
    expect(() =>
      DomainConfigSchema.parse({ ...validDomainConfig, intents: [] }),
    ).toThrow();
  });

  it("accepts empty countries array (any-country domain)", () => {
    expect(() =>
      DomainConfigSchema.parse({ ...validDomainConfig, countries: [] }),
    ).not.toThrow();
  });

  it("accepts null apiKeyEnv", () => {
    expect(() =>
      DomainConfigSchema.parse({ ...validDomainConfig, apiKeyEnv: null }),
    ).not.toThrow();
  });

  it("accepts a string apiKeyEnv", () => {
    expect(() =>
      DomainConfigSchema.parse({
        ...validDomainConfig,
        apiKeyEnv: "OPENWEATHER_API_KEY",
      }),
    ).not.toThrow();
  });

  it("rejects an invalid locationStyle", () => {
    expect(() =>
      DomainConfigSchema.parse({
        ...validDomainConfig,
        locationStyle: "bounding_box",
      }),
    ).toThrow();
  });

  it("rejects invalid vizHintRules defaultHint", () => {
    expect(() =>
      DomainConfigSchema.parse({
        ...validDomainConfig,
        vizHintRules: { defaultHint: "pie", multiMonthHint: "bar" },
      }),
    ).toThrow();
  });

  it("flattenRow $ value is accepted for raw column", () => {
    expect(() =>
      DomainConfigSchema.parse({
        ...validDomainConfig,
        flattenRow: { raw: "$", temp_max: "main.temp_max" },
      }),
    ).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// QueryCacheEntrySchema  (new in v4.1)
// ---------------------------------------------------------------------------
describe("QueryCacheEntrySchema", () => {
  const validEntry = {
    id: "clxxx",
    query_hash: "abc123def456",
    domain: "crime-uk",
    result_count: 42,
    results: [{ id: "r1", latitude: 52.2, longitude: 0.1 }],
    createdAt: new Date().toISOString(),
  };

  it("parses a valid cache entry", () => {
    const result = QueryCacheEntrySchema.parse(validEntry);
    expect(result.query_hash).toBe("abc123def456");
    expect(result.result_count).toBe(42);
  });

  it("requires query_hash", () => {
    const { query_hash, ...rest } = validEntry;
    expect(() => QueryCacheEntrySchema.parse(rest)).toThrow();
  });

  it("requires result_count to be a number", () => {
    expect(() =>
      QueryCacheEntrySchema.parse({ ...validEntry, result_count: "42" }),
    ).toThrow();
  });

  it("requires domain", () => {
    const { domain, ...rest } = validEntry;
    expect(() => QueryCacheEntrySchema.parse(rest)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// GeocoderCacheEntrySchema  (new in v4.1)
// ---------------------------------------------------------------------------
describe("GeocoderCacheEntrySchema", () => {
  const validEntry = {
    id: "clxxx",
    place_name: "cambridge, uk",
    display_name: "Cambridge, Cambridgeshire, England",
    lat: 52.205337,
    lon: 0.121817,
    country_code: "GB",
    poly: null,
    createdAt: new Date().toISOString(),
  };

  it("parses a valid geocoder cache entry", () => {
    const result = GeocoderCacheEntrySchema.parse(validEntry);
    expect(result.place_name).toBe("cambridge, uk");
    expect(result.country_code).toBe("GB");
  });

  it("accepts null poly (coordinates-only cache hit)", () => {
    expect(() =>
      GeocoderCacheEntrySchema.parse({ ...validEntry, poly: null }),
    ).not.toThrow();
  });

  it("accepts a poly string", () => {
    expect(() =>
      GeocoderCacheEntrySchema.parse({
        ...validEntry,
        poly: "52.21,0.12:52.22,0.13:52.21,0.14",
      }),
    ).not.toThrow();
  });

  it("requires place_name to be lowercase-normalised", () => {
    // Schema validates that place_name is lowercase
    expect(() =>
      GeocoderCacheEntrySchema.parse({
        ...validEntry,
        place_name: "Cambridge, UK",
      }),
    ).toThrow();
  });

  it("requires lat and lon to be numbers", () => {
    expect(() =>
      GeocoderCacheEntrySchema.parse({ ...validEntry, lat: "52.205337" }),
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// QueryJobSchema  (new in v4.1)
// ---------------------------------------------------------------------------
describe("QueryJobSchema", () => {
  const validJob = {
    id: "clxxx",
    query_id: "qid123",
    status: "complete",
    domain: "crime-uk",
    cache_hit: false,
    rows_inserted: 87,
    parse_ms: 320,
    geocode_ms: 210,
    fetch_ms: 1540,
    store_ms: 88,
    error_message: null,
    createdAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
  };

  it("parses a valid complete job", () => {
    const result = QueryJobSchema.parse(validJob);
    expect(result.status).toBe("complete");
    expect(result.cache_hit).toBe(false);
    expect(result.rows_inserted).toBe(87);
  });

  it("parses a cache hit job", () => {
    const result = QueryJobSchema.parse({
      ...validJob,
      cache_hit: true,
      fetch_ms: null,
      store_ms: null,
      rows_inserted: 0,
    });
    expect(result.cache_hit).toBe(true);
    expect(result.fetch_ms).toBeNull();
  });

  it("parses an error job", () => {
    expect(() =>
      QueryJobSchema.parse({
        ...validJob,
        status: "error",
        error_message: "Police API returned 404",
        completedAt: new Date().toISOString(),
      }),
    ).not.toThrow();
  });

  it("accepts null timing fields", () => {
    expect(() =>
      QueryJobSchema.parse({
        ...validJob,
        parse_ms: null,
        geocode_ms: null,
        fetch_ms: null,
        store_ms: null,
      }),
    ).not.toThrow();
  });

  it("accepts null completedAt on pending job", () => {
    expect(() =>
      QueryJobSchema.parse({
        ...validJob,
        status: "pending",
        completedAt: null,
      }),
    ).not.toThrow();
  });

  it("rejects invalid status", () => {
    expect(() =>
      QueryJobSchema.parse({ ...validJob, status: "running" }),
    ).toThrow();
  });

  it("requires rows_inserted to be a number", () => {
    expect(() =>
      QueryJobSchema.parse({ ...validJob, rows_inserted: "87" }),
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// NominatimResponseSchema
// ---------------------------------------------------------------------------
describe("NominatimResponseSchema", () => {
  const validResponse = [
    {
      boundingbox: ["52.1", "52.3", "0.0", "0.3"],
      display_name: "Cambridge, Cambridgeshire, England",
      lat: "52.205337",
      lon: "0.121817",
      country_code: "gb",
    },
  ];

  it("parses a valid Nominatim response", () => {
    const result = NominatimResponseSchema.parse(validResponse);
    expect(result[0].country_code).toBe("gb");
  });

  it("parses an empty array (no results)", () => {
    expect(() => NominatimResponseSchema.parse([])).not.toThrow();
  });

  it("requires country_code on each hit", () => {
    expect(() =>
      NominatimResponseSchema.parse([
        { boundingbox: [], display_name: "x", lat: "1", lon: "1" },
      ]),
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// CoordinatesSchema
// ---------------------------------------------------------------------------
describe("CoordinatesSchema", () => {
  it("parses valid coordinates", () => {
    const result = CoordinatesSchema.parse({
      lat: 52.205337,
      lon: 0.121817,
      display_name: "Cambridge, Cambridgeshire, England",
      country_code: "GB",
    });
    expect(result.lat).toBeTypeOf("number");
    expect(result.lon).toBeTypeOf("number");
  });

  it("rejects string lat/lon", () => {
    expect(() =>
      CoordinatesSchema.parse({
        lat: "52.205337",
        lon: "0.121817",
        display_name: "Cambridge",
        country_code: "GB",
      }),
    ).toThrow();
  });

  it("requires country_code", () => {
    expect(() =>
      CoordinatesSchema.parse({
        lat: 52.205337,
        lon: 0.121817,
        display_name: "Cambridge",
      }),
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// PolygonSchema
// ---------------------------------------------------------------------------
describe("PolygonSchema", () => {
  const make16PointPoly = () =>
    Array.from({ length: 16 }, (_, i) => `52.${i},0.${i}`).join(":");

  it("accepts a valid 16-point polygon", () => {
    expect(() => PolygonSchema.parse(make16PointPoly())).not.toThrow();
  });

  it("rejects a polygon with more than 100 points", () => {
    const tooMany = Array.from(
      { length: 101 },
      (_, i) => `52.${i},0.${i}`,
    ).join(":");
    expect(() => PolygonSchema.parse(tooMany)).toThrow();
  });

  it("rejects an empty string", () => {
    expect(() => PolygonSchema.parse("")).toThrow();
  });

  it("rejects malformed format", () => {
    expect(() => PolygonSchema.parse("52.2|0.1|52.3|0.2")).toThrow();
  });
});

// ---------------------------------------------------------------------------
// PostgresColumnType
// ---------------------------------------------------------------------------
describe("PostgresColumnType", () => {
  const valid = [
    "text",
    "integer",
    "bigint",
    "boolean",
    "double precision",
    "jsonb",
    "timestamptz",
  ];

  valid.forEach((type) => {
    it(`accepts "${type}"`, () => {
      expect(() => PostgresColumnType.parse(type)).not.toThrow();
    });
  });

  it("rejects an unsupported type", () => {
    expect(() => PostgresColumnType.parse("varchar(255)")).toThrow();
  });

  it("rejects serial (auto-increment not allowed via schema evolution)", () => {
    expect(() => PostgresColumnType.parse("serial")).toThrow();
  });
});

// ---------------------------------------------------------------------------
// AddColumnSchema
// ---------------------------------------------------------------------------
describe("AddColumnSchema", () => {
  it("parses a valid add column op", () => {
    const result = AddColumnSchema.parse({
      type: "add_column",
      column: "wind_speed",
      columnType: "double precision",
    });
    expect(result.column).toBe("wind_speed");
    expect(result.columnType).toBe("double precision");
  });

  it("rejects a column name with uppercase letters", () => {
    expect(() =>
      AddColumnSchema.parse({
        type: "add_column",
        column: "WindSpeed",
        columnType: "double precision",
      }),
    ).toThrow();
  });

  it("rejects a column name starting with a number", () => {
    expect(() =>
      AddColumnSchema.parse({
        type: "add_column",
        column: "1speed",
        columnType: "text",
      }),
    ).toThrow();
  });

  it("rejects a column name with hyphens", () => {
    expect(() =>
      AddColumnSchema.parse({
        type: "add_column",
        column: "wind-speed",
        columnType: "text",
      }),
    ).toThrow();
  });

  it("rejects a column name longer than 63 characters", () => {
    expect(() =>
      AddColumnSchema.parse({
        type: "add_column",
        column: "a".repeat(64),
        columnType: "text",
      }),
    ).toThrow();
  });

  it("rejects an invalid columnType", () => {
    expect(() =>
      AddColumnSchema.parse({
        type: "add_column",
        column: "speed",
        columnType: "varchar(255)",
      }),
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// DomainConfig sources array + refreshPolicy (Phase 7)
// ---------------------------------------------------------------------------
describe("DomainConfigSchema — sources array", () => {
  it("existing config without sources still parses (backwards compatible)", () => {
    expect(() => DomainConfigSchema.parse(validDomainConfig)).not.toThrow();
  });

  it("accepts a sources array with a rest source", () => {
    expect(() =>
      DomainConfigSchema.parse({
        ...validDomainConfig,
        sources: [
          {
            type: "rest",
            url: "https://data.police.uk/api",
            refreshPolicy: "realtime",
          },
        ],
      }),
    ).not.toThrow();
  });

  it("accepts a sources array with a csv source", () => {
    expect(() =>
      DomainConfigSchema.parse({
        ...validDomainConfig,
        sources: [
          {
            type: "csv",
            url: "https://example.com/data.csv",
            refreshPolicy: "weekly",
          },
        ],
      }),
    ).not.toThrow();
  });

  it("accepts mixed source types in the same domain", () => {
    expect(() =>
      DomainConfigSchema.parse({
        ...validDomainConfig,
        sources: [
          {
            type: "rest",
            url: "https://api.example.com",
            refreshPolicy: "realtime",
          },
          {
            type: "csv",
            url: "https://example.com/data.csv",
            refreshPolicy: "weekly",
          },
          {
            type: "xlsx",
            url: "https://example.com/data.xlsx",
            refreshPolicy: "static",
          },
        ],
      }),
    ).not.toThrow();
  });

  it("rejects an invalid refreshPolicy value", () => {
    expect(() =>
      DomainConfigSchema.parse({
        ...validDomainConfig,
        sources: [
          {
            type: "rest",
            url: "https://api.example.com",
            refreshPolicy: "hourly",
          },
        ],
      }),
    ).toThrow();
  });

  it("rejects an invalid source type", () => {
    expect(() =>
      DomainConfigSchema.parse({
        ...validDomainConfig,
        sources: [
          {
            type: "ftp",
            url: "ftp://example.com/data",
            refreshPolicy: "daily",
          },
        ],
      }),
    ).toThrow();
  });

  it("rejects a source missing a url", () => {
    expect(() =>
      DomainConfigSchema.parse({
        ...validDomainConfig,
        sources: [{ type: "csv", refreshPolicy: "daily" }],
      }),
    ).toThrow();
  });
});
