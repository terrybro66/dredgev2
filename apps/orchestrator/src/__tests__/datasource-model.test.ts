/**
 * Block B — DataSource model + loadDomains() seeding
 *
 * Branch: feat/datasource-model
 *
 * Tests are grouped into three suites:
 *
 *   1. DataSource model (integration, real DB)
 *      Verifies the Prisma model shape, constraints, and defaults.
 *      DataSource is already in the schema so these should be green immediately
 *      after prisma generate — they confirm the contract before we build on it.
 *
 *   2. loadDomains() seeding (unit, mocked DB)
 *      Verifies that loadDomains() upserts a DataSource record for each
 *      built-in adapter (crime-uk, weather) and is idempotent.
 *
 *   3. GenericAdapter source loading (unit, mocked DB)
 *      Verifies that GenericAdapter reads enabled sources from the DB rather
 *      than from the static config.sources array.
 *
 * Run:
 *   pnpm vitest run src/__tests__/datasource-model.test.ts --reporter=verbose
 */

import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  vi,
  beforeEach,
} from "vitest";
import { PrismaClient } from "@prisma/client";

// ---------------------------------------------------------------------------
// Suite 1 — DataSource model (integration, real DB)
// ---------------------------------------------------------------------------

const prisma = new PrismaClient();

const createdIds: string[] = [];

beforeAll(async () => {
  await prisma.dataSource.deleteMany({
    where: { name: { startsWith: "__test__" } },
  });
});

afterAll(async () => {
  if (createdIds.length > 0) {
    await prisma.dataSource.deleteMany({
      where: { id: { in: [...createdIds] } },
    });
  }
  await prisma.$disconnect();
});

// Replace the static minimalSource with one that generates a unique URL per call
let sourceCounter = 0;

function minimalSource(overrides: Record<string, unknown> = {}) {
  sourceCounter++;
  return {
    domainName: "__test__cinema-listings-gb",
    name: "__test__Odeon UK",
    url: `https://www.odeon.co.uk/api/showtimes/${sourceCounter}`,
    type: "rest" as const,
    fieldMap: { title: "description", showtime: "date" },
    refreshPolicy: "realtime" as const,
    storeResults: false,
    ...overrides,
  };
}
describe("DataSource model — schema shape", () => {
  it("can create a DataSource record with all required fields", async () => {
    const ds = await prisma.dataSource.create({ data: minimalSource() });
    createdIds.push(ds.id);

    expect(ds.id).toBeTruthy();
    expect(ds.domainName).toBe("__test__cinema-listings-gb");
    expect(ds.name).toBe("__test__Odeon UK");
    expect(ds.url).toContain("https://www.odeon.co.uk/api/showtimes");
    expect(ds.type).toBe("rest");
    expect(ds.refreshPolicy).toBe("realtime");
    expect(ds.storeResults).toBe(false);
  });

  it("storeResults defaults to true when not specified", async () => {
    const ds = await prisma.dataSource.create({
      data: minimalSource({ storeResults: undefined }),
    });
    createdIds.push(ds.id);

    expect(ds.storeResults).toBe(true);
  });

  it("enabled defaults to true", async () => {
    const ds = await prisma.dataSource.create({ data: minimalSource() });
    createdIds.push(ds.id);

    expect(ds.enabled).toBe(true);
  });

  it("confidence defaults to 1.0", async () => {
    const ds = await prisma.dataSource.create({ data: minimalSource() });
    createdIds.push(ds.id);

    expect(ds.confidence).toBe(1.0);
  });

  it("discoveredBy defaults to manual", async () => {
    const ds = await prisma.dataSource.create({ data: minimalSource() });
    createdIds.push(ds.id);

    expect(ds.discoveredBy).toBe("manual");
  });

  it("createdAt defaults to now()", async () => {
    const before = new Date();
    const ds = await prisma.dataSource.create({ data: minimalSource() });
    const after = new Date();
    createdIds.push(ds.id);

    expect(ds.createdAt).toBeInstanceOf(Date);
    expect(ds.createdAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(ds.createdAt.getTime()).toBeLessThanOrEqual(after.getTime());
  });

  it("approvedAt is nullable", async () => {
    const ds = await prisma.dataSource.create({ data: minimalSource() });
    createdIds.push(ds.id);

    expect(ds.approvedAt).toBeNull();
  });

  it("lastFetchedAt is nullable", async () => {
    const ds = await prisma.dataSource.create({ data: minimalSource() });
    createdIds.push(ds.id);

    expect(ds.lastFetchedAt).toBeNull();
  });

  it("lastRowCount is nullable", async () => {
    const ds = await prisma.dataSource.create({ data: minimalSource() });
    createdIds.push(ds.id);

    expect(ds.lastRowCount).toBeNull();
  });

  it("extractionPrompt is nullable", async () => {
    const ds = await prisma.dataSource.create({ data: minimalSource() });
    createdIds.push(ds.id);

    expect(ds.extractionPrompt).toBeNull();
  });

  it("extractionPrompt can be set for scrape-type sources", async () => {
    const ds = await prisma.dataSource.create({
      data: minimalSource({
        type: "scrape",
        extractionPrompt: "Extract film title, showtime, and screen type",
      }),
    });
    createdIds.push(ds.id);

    expect(ds.extractionPrompt).toBe(
      "Extract film title, showtime, and screen type",
    );
  });

  it("type accepts all valid enum values", async () => {
    const types = ["rest", "csv", "xlsx", "pdf", "scrape"] as const;

    for (const type of types) {
      const ds = await prisma.dataSource.create({
        data: minimalSource({ type, name: `__test__source-${type}` }),
      });
      createdIds.push(ds.id);
      expect(ds.type).toBe(type);
    }
  });

  it("refreshPolicy accepts all valid enum values", async () => {
    const policies = ["realtime", "daily", "weekly", "static"] as const;

    for (const refreshPolicy of policies) {
      const ds = await prisma.dataSource.create({
        data: minimalSource({
          refreshPolicy,
          name: `__test__source-${refreshPolicy}`,
        }),
      });
      createdIds.push(ds.id);
      expect(ds.refreshPolicy).toBe(refreshPolicy);
    }
  });

  it("discoveredBy accepts all valid enum values", async () => {
    const sources = ["manual", "catalogue", "serp", "browser"] as const;

    for (const discoveredBy of sources) {
      const ds = await prisma.dataSource.create({
        data: minimalSource({
          discoveredBy,
          name: `__test__source-disc-${discoveredBy}`,
        }),
      });
      createdIds.push(ds.id);
      expect(ds.discoveredBy).toBe(discoveredBy);
    }
  });

  it("confidence is a float and can be set to any value between 0.0 and 1.0", async () => {
    const ds = await prisma.dataSource.create({
      data: minimalSource({ confidence: 0.75 }),
    });
    createdIds.push(ds.id);

    expect(ds.confidence).toBe(0.75);
  });

  it("fieldMap is stored as JSON and round-trips correctly", async () => {
    const fieldMap = {
      title: "description",
      showtime: "date",
      price: "value",
      cert: "extras.certificate",
    };
    const ds = await prisma.dataSource.create({
      data: minimalSource({ fieldMap }),
    });
    createdIds.push(ds.id);

    expect(ds.fieldMap).toMatchObject(fieldMap);
  });

  it("can disable a source by setting enabled to false", async () => {
    const ds = await prisma.dataSource.create({
      data: minimalSource({ enabled: false }),
    });
    createdIds.push(ds.id);

    expect(ds.enabled).toBe(false);
  });

  it("multiple sources can share the same domainName", async () => {
    const ds1 = await prisma.dataSource.create({
      data: minimalSource({ name: "__test__Odeon UK" }),
    });
    const ds2 = await prisma.dataSource.create({
      data: minimalSource({ name: "__test__Vue UK" }),
    });
    createdIds.push(ds1.id, ds2.id);

    const sources = await prisma.dataSource.findMany({
      where: { id: { in: [ds1.id, ds2.id] } },
    });
    expect(sources).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Suite 2 — loadDomains() seeding (unit, mocked DB)
// ---------------------------------------------------------------------------

// Hoist mock factories before vi.mock() calls.
const { mockDataSourceUpsert } = vi.hoisted(() => ({
  mockDataSourceUpsert: vi.fn(),
}));
const { mockDataSourceFindMany } = vi.hoisted(() => ({
  mockDataSourceFindMany: vi.fn(),
}));
const { mockOnLoad } = vi.hoisted(() => ({ mockOnLoad: vi.fn() }));

// Mock the db module so loadDomains() uses our fake prisma.
vi.mock("../db", () => ({
  prisma: {
    dataSource: {
      upsert: mockDataSourceUpsert,
      findMany: mockDataSourceFindMany,
    },
    // No registered dynamic domains in these tests
    domainDiscovery: {
      findMany: vi.fn().mockResolvedValue([]),
    },
  },
}));

// Mock onLoad on adapters so we don't hit real APIs.
vi.mock("../domains/crime-uk/index", () => ({
  crimeUkAdapter: {
    config: {
      name: "crime-uk",
      tableName: "crime_results",
      prismaModel: "crimeResult",
      defaultOrderBy: { month: "asc" },
      countries: ["GB"],
      intents: ["crime"],
      apiUrl: "https://data.police.uk/api",
      apiKeyEnv: null,
      locationStyle: "polygon",
      params: {},
      flattenRow: {},
      categoryMap: {},
      vizHintRules: { defaultHint: "map", multiMonthHint: "bar" },
      rateLimit: { requestsPerMinute: 30 },
      cacheTtlHours: null,
    },
    fetchData: vi.fn(),
    flattenRow: vi.fn(),
    storeResults: vi.fn(),
    onLoad: mockOnLoad,
  },
}));

vi.mock("../domains/weather/index", () => ({
  weatherAdapter: {
    config: {
      name: "weather",
      tableName: "weather_results",
      prismaModel: "weatherResult",
      defaultOrderBy: { date: "asc" },
      countries: [],
      intents: ["weather"],
      apiUrl: "https://api.open-meteo.com/v1/forecast",
      apiKeyEnv: null,
      locationStyle: "coordinates",
      params: {},
      flattenRow: {},
      categoryMap: {},
      vizHintRules: { defaultHint: "dashboard", multiMonthHint: "dashboard" },
      rateLimit: { requestsPerMinute: 60 },
      cacheTtlHours: 1,
    },
    fetchData: vi.fn(),
    flattenRow: vi.fn(),
    storeResults: vi.fn(),
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  mockDataSourceUpsert.mockResolvedValue({});
  mockDataSourceFindMany.mockResolvedValue([]);
  mockOnLoad.mockResolvedValue(undefined);
});

describe("loadDomains() — DataSource seeding", () => {
  it("upserts a DataSource record for crime-uk on load", async () => {
    const { loadDomains } = await import("../domains/registry");
    await loadDomains();

    const calls = mockDataSourceUpsert.mock.calls;
    const crimeCall = calls.find(
      ([arg]) =>
        arg?.create?.domainName === "crime-uk" ||
        arg?.where?.domainName_url?.domainName === "crime-uk",
    );
    expect(crimeCall).toBeDefined();
  });

  it("upserts a DataSource record for weather on load", async () => {
    const { loadDomains } = await import("../domains/registry");
    await loadDomains();

    const calls = mockDataSourceUpsert.mock.calls;
    const weatherCall = calls.find(
      ([arg]) =>
        arg?.create?.domainName === "weather" ||
        arg?.where?.domainName_url?.domainName === "weather",
    );
    expect(weatherCall).toBeDefined();
  });

  it("seeds the crime-uk DataSource with storeResults: true", async () => {
    const { loadDomains } = await import("../domains/registry");
    await loadDomains();

    const calls = mockDataSourceUpsert.mock.calls;
    const crimeCall = calls.find(
      ([arg]) => arg?.create?.domainName === "crime-uk",
    );
    expect(crimeCall?.[0]?.create?.storeResults).toBe(true);
  });

  it("seeds the weather DataSource with storeResults: true", async () => {
    const { loadDomains } = await import("../domains/registry");
    await loadDomains();

    const calls = mockDataSourceUpsert.mock.calls;
    const weatherCall = calls.find(
      ([arg]) => arg?.create?.domainName === "weather",
    );
    expect(weatherCall?.[0]?.create?.storeResults).toBe(true);
  });

  it("uses upsert so calling loadDomains() twice does not create duplicate records", async () => {
    const { loadDomains, clearRegistry } = await import("../domains/registry");
    clearRegistry();
    await loadDomains();
    clearRegistry();
    await loadDomains();

    // upsert should be called exactly once per domain per invocation.
    // With 6 built-in adapters (crime-uk, weather, cinemas-gb, hunting-zones-gb,
    // geocoder, travel-estimator) × 2 calls = 12 upserts.
    // Crucially, NOT creates — which would cause a unique constraint error on a real DB.
    expect(mockDataSourceUpsert).toHaveBeenCalledTimes(12);
  });

  it("calls onLoad on adapters that define it", async () => {
    const { loadDomains, clearRegistry } = await import("../domains/registry");
    clearRegistry();
    await loadDomains();

    expect(mockOnLoad).toHaveBeenCalledOnce();
  });

  it("seeds DataSource with discoveredBy: manual for built-in adapters", async () => {
    const { loadDomains, clearRegistry } = await import("../domains/registry");
    clearRegistry();
    await loadDomains();

    for (const [arg] of mockDataSourceUpsert.mock.calls) {
      expect(arg?.create?.discoveredBy).toBe("manual");
    }
  });

  it("seeds DataSource with enabled: true for built-in adapters", async () => {
    const { loadDomains, clearRegistry } = await import("../domains/registry");
    clearRegistry();
    await loadDomains();

    for (const [arg] of mockDataSourceUpsert.mock.calls) {
      expect(arg?.create?.enabled).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Suite 3 — GenericAdapter source loading (unit, mocked DB)
// Verifies that createGenericAdapter reads enabled sources from the DB
// rather than relying solely on the static config.sources array.
// ---------------------------------------------------------------------------

describe("GenericAdapter — DB-backed source loading", () => {
  it("fetchData returns empty array when DB has no enabled sources for the domain", async () => {
    mockDataSourceFindMany.mockResolvedValue([]);

    const { createGenericAdapter } = await import("../domains/generic-adapter");
    const adapter = createGenericAdapter({
      name: "cinema-listings-gb",
      tableName: "query_results",
      prismaModel: "queryResult",
      countries: ["GB"],
      intents: ["cinema"],
      apiUrl: "https://example.com",
      apiKeyEnv: null,
      locationStyle: "coordinates",
      params: {},
      flattenRow: {},
      categoryMap: {},
      vizHintRules: { defaultHint: "table", multiMonthHint: "table" },
    });

    const rows = await adapter.fetchData({}, "51.5,-0.1");
    expect(rows).toEqual([]);
  });

  it("fetchData skips disabled sources from the DB", async () => {
    // One enabled, one disabled — only the enabled one should be fetched.
    mockDataSourceFindMany.mockResolvedValue([
      {
        id: "src-1",
        url: "https://example.com/enabled",
        type: "rest",
        enabled: true,
        storeResults: false,
        fieldMap: {},
      },
      {
        id: "src-2",
        url: "https://example.com/disabled",
        type: "rest",
        enabled: false,
        storeResults: false,
        fieldMap: {},
      },
    ]);

    const { createGenericAdapter } = await import("../domains/generic-adapter");
    const adapter = createGenericAdapter({
      name: "cinema-listings-gb",
      tableName: "query_results",
      prismaModel: "queryResult",
      countries: ["GB"],
      intents: ["cinema"],
      apiUrl: "https://example.com",
      apiKeyEnv: null,
      locationStyle: "coordinates",
      params: {},
      flattenRow: {},
      categoryMap: {},
      vizHintRules: { defaultHint: "table", multiMonthHint: "table" },
    });

    // The adapter should query the DB for sources, not use a static array.
    // We can't easily assert which URLs were fetched without mocking providers,
    // so we assert that findMany was called with the domain name filter.
    await adapter.fetchData({}, "51.5,-0.1").catch(() => {
      // provider fetch will fail without a real URL — that's fine here
    });

    expect(mockDataSourceFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          domainName: "cinema-listings-gb",
          enabled: true,
        }),
      }),
    );
  });

  it("storeResults writes to query_results via prisma.queryResult.createMany", async () => {
    const mockPrisma = {
      queryResult: {
        createMany: vi.fn().mockResolvedValue({ count: 2 }),
      },
    };

    const { createGenericAdapter } = await import("../domains/generic-adapter");
    const adapter = createGenericAdapter({
      name: "cinema-listings-gb",
      tableName: "query_results",
      prismaModel: "queryResult",
      countries: ["GB"],
      intents: ["cinema"],
      apiUrl: "https://example.com",
      apiKeyEnv: null,
      locationStyle: "coordinates",
      params: {},
      flattenRow: {},
      categoryMap: {},
      vizHintRules: { defaultHint: "table", multiMonthHint: "table" },
    });

    const rows = [
      { description: "Dune Part Two", date: "2025-06-01", source_tag: "odeon" },
      { description: "Gladiator II", date: "2025-06-01", source_tag: "odeon" },
    ];

    await adapter.storeResults("query-1", rows, mockPrisma as any);

    expect(mockPrisma.queryResult.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([
          expect.objectContaining({ description: "Dune Part Two" }),
          expect.objectContaining({ description: "Gladiator II" }),
        ]),
      }),
    );
  });

  it("storeResults is a no-op when rows array is empty", async () => {
    const mockPrisma = {
      queryResult: {
        createMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
    };

    const { createGenericAdapter } = await import("../domains/generic-adapter");
    const adapter = createGenericAdapter({
      name: "cinema-listings-gb",
      tableName: "query_results",
      prismaModel: "queryResult",
      countries: ["GB"],
      intents: ["cinema"],
      apiUrl: "https://example.com",
      apiKeyEnv: null,
      locationStyle: "coordinates",
      params: {},
      flattenRow: {},
      categoryMap: {},
      vizHintRules: { defaultHint: "table", multiMonthHint: "table" },
    });

    await adapter.storeResults("query-1", [], mockPrisma as any);

    expect(mockPrisma.queryResult.createMany).not.toHaveBeenCalled();
  });

  it("storeResults includes domain_name and source_tag on every written row", async () => {
    const mockPrisma = {
      queryResult: {
        createMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    };

    const { createGenericAdapter } = await import("../domains/generic-adapter");
    const adapter = createGenericAdapter({
      name: "flood-risk-gb",
      tableName: "query_results",
      prismaModel: "queryResult",
      countries: ["GB"],
      intents: ["flood"],
      apiUrl: "https://example.com",
      apiKeyEnv: null,
      locationStyle: "coordinates",
      params: {},
      flattenRow: {},
      categoryMap: {},
      vizHintRules: { defaultHint: "table", multiMonthHint: "table" },
    });

    const rows = [
      {
        description: "Flood alert",
        date: "2025-06-01",
        source_tag: "environment-agency",
      },
    ];

    await adapter.storeResults("query-1", rows, mockPrisma as any);

    const written = mockPrisma.queryResult.createMany.mock.calls[0][0].data[0];
    expect(written.domain_name).toBe("flood-risk-gb");
    expect(written.source_tag).toBeDefined();
  });
});
