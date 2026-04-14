import { describe, it, expect, vi, beforeEach } from "vitest";
import { createPipelineAdapter } from "../domains/generic-adapter";
import type { DomainConfigV2 } from "@dredge/schemas";

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock("../providers/rest-provider", () => ({
  restGet: vi.fn(),
  createRestProvider: vi.fn(),
}));

vi.mock("../providers/csv-provider", () => ({
  createCsvProvider: vi.fn(),
}));

vi.mock("../providers/xlsx-provider", () => ({
  createXlsxProvider: vi.fn(),
}));

vi.mock("../enrichment/source-tag", () => ({
  tagRows: (_rows: unknown[], _url: string) => _rows,
}));

vi.mock("../db", () => ({
  prisma: {
    dataSource: { findMany: vi.fn().mockResolvedValue([]) },
    queryResult: { createMany: vi.fn().mockResolvedValue({ count: 0 }) },
  },
}));

import { createRestProvider } from "../providers/rest-provider";
import { createCsvProvider } from "../providers/csv-provider";

const mockRestProvider = vi.mocked(createRestProvider);
const mockCsvProvider = vi.mocked(createCsvProvider);

// ── Config fixtures ───────────────────────────────────────────────────────────

const placesConfig: DomainConfigV2 = {
  identity: {
    name: "test-places",
    displayName: "Test Places",
    description: "Test",
    countries: ["gb"],
    intents: ["places"],
  },
  source: { type: "rest", endpoint: "https://example.com/places" },
  template: { type: "places", capabilities: { has_coordinates: true } },
  fields: {
    lat: { source: "latitude", type: "number", role: "location_lat" },
    lon: { source: "longitude", type: "number", role: "location_lon" },
    description: { source: "title", type: "string", role: "label" },
    category: { source: "type", type: "string", role: "dimension" },
    date: { source: "created_at", type: "time", role: "time" },
  },
  time: { type: "static" },
  recovery: [],
  storage: {
    storeResults: true,
    tableName: "query_results",
    prismaModel: "queryResult",
    extrasStrategy: "retain_unmapped",
  },
  visualisation: { default: "map", rules: [] },
};

const nestedConfig: DomainConfigV2 = {
  ...placesConfig,
  identity: { ...placesConfig.identity, name: "test-nested" },
  fields: {
    lat: { source: "geo.lat", type: "number", role: "location_lat" },
    lon: { source: "geo.lon", type: "number", role: "location_lon" },
    description: { source: "meta.title", type: "string", role: "label" },
  },
};

const enumConfig: DomainConfigV2 = {
  ...placesConfig,
  identity: { ...placesConfig.identity, name: "test-enum" },
  fields: {
    lat: { source: "lat", type: "number", role: "location_lat" },
    lon: { source: "lon", type: "number", role: "location_lon" },
    category: {
      source: "cat",
      type: "enum",
      role: "dimension",
      normalise: true,
      transform: "humanise_category",
    },
  },
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function makePlan(overrides = {}) {
  return {
    location: "London",
    date_from: "2024-01",
    date_to: "2024-01",
    category: "all",
    ...overrides,
  };
}

// ── 1. NORMALISE — field mapping ──────────────────────────────────────────────

describe("pipeline executor — NORMALISE", () => {
  beforeEach(() => vi.clearAllMocks());

  it("maps top-level source fields to canonical names", () => {
    const adapter = createPipelineAdapter(placesConfig);
    const raw = {
      latitude: 51.5,
      longitude: -0.1,
      title: "Hyde Park",
      type: "park",
      created_at: "2024-01-01",
    };
    const canonical = adapter.flattenRow(raw);

    expect(canonical.lat).toBe(51.5);
    expect(canonical.lon).toBe(-0.1);
    expect(canonical.description).toBe("Hyde Park");
    expect(canonical.category).toBe("park");
  });

  it("resolves dot-path sources into nested objects", () => {
    const adapter = createPipelineAdapter(nestedConfig);
    const raw = {
      geo: { lat: 53.4, lon: -2.2 },
      meta: { title: "Manchester Arena" },
    };
    const canonical = adapter.flattenRow(raw);

    expect(canonical.lat).toBe(53.4);
    expect(canonical.lon).toBe(-2.2);
    expect(canonical.description).toBe("Manchester Arena");
  });

  it("returns null for missing source fields, not undefined", () => {
    const adapter = createPipelineAdapter(placesConfig);
    const raw = { latitude: 51.5 }; // longitude and title missing
    const canonical = adapter.flattenRow(raw);

    expect(canonical.lat).toBe(51.5);
    expect(canonical.lon).toBeNull();
    expect(canonical.description).toBeNull();
  });

  it("retains unmapped fields in extras when extrasStrategy is retain_unmapped", () => {
    const adapter = createPipelineAdapter(placesConfig);
    const raw = {
      latitude: 51.5,
      longitude: -0.1,
      title: "Park",
      unmapped_field: "keep me",
      another: 42,
    };
    const canonical = adapter.flattenRow(raw);

    expect((canonical.extras as Record<string, unknown>)?.unmapped_field).toBe(
      "keep me",
    );
    expect((canonical.extras as Record<string, unknown>)?.another).toBe(42);
  });

  it("discards unmapped fields when extrasStrategy is discard", () => {
    const discardConfig: DomainConfigV2 = {
      ...placesConfig,
      storage: { ...placesConfig.storage, extrasStrategy: "discard" },
    };
    const adapter = createPipelineAdapter(discardConfig);
    const raw = {
      latitude: 51.5,
      longitude: -0.1,
      title: "Park",
      unmapped_field: "drop me",
    };
    const canonical = adapter.flattenRow(raw);

    expect(canonical.extras).toBeNull();
  });

  it("coerces string numbers to number type for number fields", () => {
    const adapter = createPipelineAdapter(placesConfig);
    const raw = { latitude: "51.5", longitude: "-0.1", title: "Park" };
    const canonical = adapter.flattenRow(raw);

    expect(canonical.lat).toBe(51.5);
    expect(typeof canonical.lat).toBe("number");
  });

  it("applies humanise_category transform to enum fields with normalise:true", () => {
    const adapter = createPipelineAdapter(enumConfig);
    const raw = { lat: 51.5, lon: -0.1, cat: "anti-social-behaviour" };
    const canonical = adapter.flattenRow(raw);

    // humanise_category replaces hyphens with spaces and title-cases
    expect(canonical.category).toBe("Anti Social Behaviour");
  });
});

// ── 2. FETCH — URL building ───────────────────────────────────────────────────

describe("pipeline executor — FETCH", () => {
  beforeEach(() => vi.clearAllMocks());

  it("calls the rest provider with the config endpoint", async () => {
    const rows = [{ latitude: 51.5, longitude: -0.1, title: "Park" }];
    mockRestProvider.mockReturnValue({
      fetchRows: vi.fn().mockResolvedValue(rows),
    } as any);

    const adapter = createPipelineAdapter(placesConfig);
    const result = await adapter.fetchData(makePlan(), "");

    expect(mockRestProvider).toHaveBeenCalledWith(
      expect.objectContaining({
        url: expect.stringContaining("example.com/places"),
      }),
    );
    expect(result).toHaveLength(1);
  });

  it("substitutes {lat} and {lon} tokens in endpoint from poly centroid", async () => {
    const tokenConfig: DomainConfigV2 = {
      ...placesConfig,
      source: {
        type: "rest",
        endpoint: "https://api.example.com/data?lat={lat}&lon={lon}",
      },
    };
    mockRestProvider.mockReturnValue({
      fetchRows: vi.fn().mockResolvedValue([]),
    } as any);

    const adapter = createPipelineAdapter(tokenConfig);
    // poly centroid of a simple bounding box around London
    await adapter.fetchData(
      makePlan(),
      "51.4,-0.2:51.6,-0.2:51.6,0.0:51.4,0.0",
    );

    const calledUrl: string = mockRestProvider.mock.calls[0][0].url;
    expect(calledUrl).toMatch(/lat=\d/);
    expect(calledUrl).toMatch(/lon=-?\d/);
    expect(calledUrl).not.toContain("{lat}");
    expect(calledUrl).not.toContain("{lon}");
  });

  it("returns canonical rows (flattenRow applied to each raw row)", async () => {
    const rawRows = [
      { latitude: 51.5, longitude: -0.1, title: "Park", type: "park" },
      { latitude: 52.0, longitude: -1.5, title: "Museum", type: "museum" },
    ];
    mockRestProvider.mockReturnValue({
      fetchRows: vi.fn().mockResolvedValue(rawRows),
    } as any);

    const adapter = createPipelineAdapter(placesConfig);
    const result = (await adapter.fetchData(makePlan(), "")) as Record<
      string,
      unknown
    >[];

    expect(result[0].lat).toBe(51.5);
    expect(result[0].description).toBe("Park");
    expect(result[1].description).toBe("Museum");
  });

  it("returns empty array when provider returns no rows", async () => {
    mockRestProvider.mockReturnValue({
      fetchRows: vi.fn().mockResolvedValue([]),
    } as any);

    const adapter = createPipelineAdapter(placesConfig);
    const result = await adapter.fetchData(makePlan(), "");

    expect(result).toEqual([]);
  });

  it("returns empty array when fetch throws, does not propagate error", async () => {
    mockRestProvider.mockReturnValue({
      fetchRows: vi.fn().mockRejectedValue(new Error("network error")),
    } as any);

    const adapter = createPipelineAdapter(placesConfig);
    const result = await adapter.fetchData(makePlan(), "");

    expect(result).toEqual([]);
  });
});

// ── 3. STORE — storeResults ───────────────────────────────────────────────────

describe("pipeline executor — STORE", () => {
  beforeEach(() => vi.clearAllMocks());

  it("writes canonical fields to query_results via prismaModel", async () => {
    const prismaMock = {
      queryResult: { createMany: vi.fn().mockResolvedValue({ count: 2 }) },
    };

    const rows = [
      {
        lat: 51.5,
        lon: -0.1,
        description: "Park",
        category: "park",
        date: null,
        extras: null,
      },
      {
        lat: 52.0,
        lon: -1.5,
        description: "Museum",
        category: "museum",
        date: null,
        extras: null,
      },
    ];

    const adapter = createPipelineAdapter(placesConfig);
    await adapter.storeResults("query-123", rows, prismaMock);

    expect(prismaMock.queryResult.createMany).toHaveBeenCalledOnce();
    const { data } = prismaMock.queryResult.createMany.mock.calls[0][0];
    expect(data).toHaveLength(2);
    expect(data[0].domain_name).toBe("test-places");
    expect(data[0].lat).toBe(51.5);
    expect(data[0].description).toBe("Park");
  });

  it("stores full raw row in raw JSONB column", async () => {
    const prismaMock = {
      queryResult: { createMany: vi.fn().mockResolvedValue({ count: 1 }) },
    };
    const rows = [
      {
        lat: 51.5,
        lon: -0.1,
        description: "Park",
        raw: { original: "data" },
        extras: null,
      },
    ];

    const adapter = createPipelineAdapter(placesConfig);
    await adapter.storeResults("query-123", rows, prismaMock);

    const { data } = prismaMock.queryResult.createMany.mock.calls[0][0];
    expect(data[0].raw).toEqual({ original: "data" });
  });

  it("stores unmapped fields in extras JSONB column", async () => {
    const prismaMock = {
      queryResult: { createMany: vi.fn().mockResolvedValue({ count: 1 }) },
    };
    const rows = [
      { lat: 51.5, lon: -0.1, extras: { website: "https://park.com" } },
    ];

    const adapter = createPipelineAdapter(placesConfig);
    await adapter.storeResults("query-123", rows, prismaMock);

    const { data } = prismaMock.queryResult.createMany.mock.calls[0][0];
    expect(data[0].extras).toEqual({ website: "https://park.com" });
  });

  it("skips createMany when rows is empty", async () => {
    const prismaMock = {
      queryResult: { createMany: vi.fn() },
    };

    const adapter = createPipelineAdapter(placesConfig);
    await adapter.storeResults("query-123", [], prismaMock);

    expect(prismaMock.queryResult.createMany).not.toHaveBeenCalled();
  });

  it("uses the prismaModel from storage config, not a hardcoded model name", async () => {
    const customStorageConfig: DomainConfigV2 = {
      ...placesConfig,
      storage: { ...placesConfig.storage, prismaModel: "queryResult" },
    };
    const prismaMock = {
      queryResult: { createMany: vi.fn().mockResolvedValue({ count: 1 }) },
    };

    const adapter = createPipelineAdapter(customStorageConfig);
    await adapter.storeResults("query-123", [{ lat: 1, lon: 1 }], prismaMock);

    expect(prismaMock.queryResult.createMany).toHaveBeenCalled();
  });
});

// ── 4. VIZ HINT ───────────────────────────────────────────────────────────────

describe("pipeline executor — viz hint", () => {
  it("exposes visualisation.default as vizHintRules.defaultHint for query.ts compat", () => {
    const adapter = createPipelineAdapter(placesConfig);
    expect((adapter.config as any).vizHintRules?.defaultHint).toBe("map");
  });
});

// ── 5. RECOVERY ───────────────────────────────────────────────────────────────

describe("pipeline executor — recoverFromEmpty", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns null when recovery array is empty", async () => {
    mockRestProvider.mockReturnValue({
      fetchRows: vi.fn().mockResolvedValue([]),
    } as any);

    const adapter = createPipelineAdapter(placesConfig);
    const result = await adapter.recoverFromEmpty!(makePlan(), "", {} as any);

    expect(result).toBeNull();
  });

  it("returns data + fallback when shift_time strategy finds results on retry", async () => {
    const recoveryConfig: DomainConfigV2 = {
      ...placesConfig,
      recovery: [
        {
          strategy: "shift_time",
          trigger: "empty",
          direction: "backward",
          step: "1_month",
          maxAttempts: 2,
        },
      ],
    };

    // First call (original): empty. Second call (shifted): has rows.
    mockRestProvider
      .mockReturnValueOnce({ fetchRows: vi.fn().mockResolvedValue([]) } as any)
      .mockReturnValueOnce({
        fetchRows: vi
          .fn()
          .mockResolvedValue([
            { latitude: 51.5, longitude: -0.1, title: "Park" },
          ]),
      } as any);

    const adapter = createPipelineAdapter(recoveryConfig);
    const result = await adapter.recoverFromEmpty!(
      makePlan({ date_from: "2024-03", date_to: "2024-03" }),
      "",
      {} as any,
    );

    expect(result).not.toBeNull();
    expect(result!.data).toHaveLength(1);
    expect(result!.fallback.field).toBe("date");
  });

  it("returns null when all recovery attempts are exhausted", async () => {
    const recoveryConfig: DomainConfigV2 = {
      ...placesConfig,
      recovery: [
        {
          strategy: "shift_time",
          trigger: "empty",
          direction: "backward",
          step: "1_month",
          maxAttempts: 2,
        },
      ],
    };

    mockRestProvider.mockReturnValue({
      fetchRows: vi.fn().mockResolvedValue([]),
    } as any);

    const adapter = createPipelineAdapter(recoveryConfig);
    const result = await adapter.recoverFromEmpty!(
      makePlan({ date_from: "2024-03", date_to: "2024-03" }),
      "",
      {} as any,
    );

    expect(result).toBeNull();
  });
});
