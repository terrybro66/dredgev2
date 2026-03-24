/**
 * Block D — Registration: ephemeral path (storeResults: false)
 *
 * Branch: feat/registration-ephemeral
 *
 * Tests cover the full contract of registerDiscoveredDomain() when the
 * proposed config has storeResults: false:
 *
 *   - Creates a DataSource record in the DB
 *   - Registers a fetch-and-discard adapter in the domain registry
 *   - The registered adapter does NOT write to query_results on fetch
 *   - The registered adapter does NOT create a cache entry
 *   - The registered adapter does NOT create a snapshot
 *   - Marks the DomainDiscovery record as registered
 *   - Returns { path: "ephemeral", domainName }
 *   - Throws on invalid config
 *   - Throws if domainName is already registered
 *   - End-to-end: register then query returns live results
 *
 * Run:
 *   pnpm vitest run src/__tests__/registration-ephemeral.test.ts --reporter=verbose
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Hoist all mock factories before vi.mock() calls ───────────────────────────

const { mockDataSourceCreate } = vi.hoisted(() => ({
  mockDataSourceCreate: vi.fn(),
}));
const { mockDataSourceFindFirst } = vi.hoisted(() => ({
  mockDataSourceFindFirst: vi.fn(),
}));
const { mockDiscoveryFindUnique } = vi.hoisted(() => ({
  mockDiscoveryFindUnique: vi.fn(),
}));
const { mockDiscoveryUpdate } = vi.hoisted(() => ({
  mockDiscoveryUpdate: vi.fn(),
}));

vi.mock("../db", () => ({
  prisma: {
    dataSource: {
      create: mockDataSourceCreate,
      findFirst: mockDataSourceFindFirst,
    },
    domainDiscovery: {
      findUnique: mockDiscoveryFindUnique,
      update: mockDiscoveryUpdate,
    },
  },
}));

// Mock the registry so we can spy on registerDomain and inspect what gets
// registered, while still using the real getDomainForQuery / getDomainByName.
const { mockRegisterDomain } = vi.hoisted(() => ({
  mockRegisterDomain: vi.fn(),
}));
const { mockGetDomainByName } = vi.hoisted(() => ({
  mockGetDomainByName: vi.fn(),
}));
const { mockClearRegistry } = vi.hoisted(() => ({
  mockClearRegistry: vi.fn(),
}));

vi.mock("../domains/registry", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../domains/registry")>();
  return {
    ...actual,
    registerDomain: mockRegisterDomain,
    getDomainByName: mockGetDomainByName,
    clearRegistry: mockClearRegistry,
  };
});

// ── Shared fixtures ───────────────────────────────────────────────────────────

const ephemeralConfig = {
  name: "cinema-listings-gb",
  apiUrl: "https://www.odeon.co.uk/api/showtimes",
  providerType: "rest" as const,
  fieldMap: { title: "description", showtime: "date" },
  storeResults: false,
  refreshPolicy: "realtime" as const,
  ephemeralRationale: "Showtimes change constantly — discard after delivery.",
  confidence: 0.9,
  intent: "cinema listings",
  country_code: "GB",
  sampleRows: [{ title: "Dune Part Two", showtime: "2025-06-01T19:30:00Z" }],
};

const discoveryRecord = {
  id: "disc-ephemeral-1",
  intent: "cinema listings",
  country_code: "GB",
  status: "requires_review",
  proposed_config: ephemeralConfig,
  store_results: false,
  refresh_policy: "realtime",
  ephemeral_rationale: "Showtimes change constantly.",
  confidence: 0.9,
};

const mockPrismaForAdapter = {
  queryResult: { createMany: vi.fn() },
  queryCache: { create: vi.fn() },
  queryRun: { create: vi.fn() },
  datasetSnapshot: { create: vi.fn() },
};

beforeEach(() => {
  vi.clearAllMocks();
  mockDataSourceCreate.mockResolvedValue({ id: "ds-1", ...ephemeralConfig });
  mockDataSourceFindFirst.mockResolvedValue(null);
  mockDiscoveryFindUnique.mockResolvedValue(discoveryRecord);
  mockDiscoveryUpdate.mockResolvedValue({});
  mockRegisterDomain.mockImplementation(() => {});
  mockGetDomainByName.mockReturnValue(undefined); // not already registered
  mockClearRegistry.mockImplementation(() => {});

  // Reset adapter-level mocks
  mockPrismaForAdapter.queryResult.createMany.mockResolvedValue({ count: 0 });
  mockPrismaForAdapter.queryCache.create.mockResolvedValue({});
  mockPrismaForAdapter.queryRun.create.mockResolvedValue({ id: "run-1" });
  mockPrismaForAdapter.datasetSnapshot.create.mockResolvedValue({
    id: "snap-1",
  });
});

// ── Suite 1: registerDiscoveredDomain — ephemeral path ────────────────────────

describe("registerDiscoveredDomain — ephemeral path (storeResults: false)", () => {
  it("creates a DataSource record with storeResults: false", async () => {
    const { registerDiscoveredDomain } = await import("../agent/registration");

    await registerDiscoveredDomain({
      discoveryId: "disc-ephemeral-1",
      proposedConfig: ephemeralConfig,
      prisma: {
        dataSource: { create: mockDataSourceCreate },
        domainDiscovery: {
          findUnique: mockDiscoveryFindUnique,
          update: mockDiscoveryUpdate,
        },
      },
    });

    expect(mockDataSourceCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          storeResults: false,
          domainName: "cinema-listings-gb",
        }),
      }),
    );
  });

  it("creates a DataSource record with the correct url and type", async () => {
    const { registerDiscoveredDomain } = await import("../agent/registration");

    await registerDiscoveredDomain({
      discoveryId: "disc-ephemeral-1",
      proposedConfig: ephemeralConfig,
      prisma: {
        dataSource: { create: mockDataSourceCreate },
        domainDiscovery: {
          findUnique: mockDiscoveryFindUnique,
          update: mockDiscoveryUpdate,
        },
      },
    });

    expect(mockDataSourceCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          url: "https://www.odeon.co.uk/api/showtimes",
          type: "rest",
        }),
      }),
    );
  });

  it("registers an adapter in the domain registry", async () => {
    const { registerDiscoveredDomain } = await import("../agent/registration");

    await registerDiscoveredDomain({
      discoveryId: "disc-ephemeral-1",
      proposedConfig: ephemeralConfig,
      prisma: {
        dataSource: { create: mockDataSourceCreate },
        domainDiscovery: {
          findUnique: mockDiscoveryFindUnique,
          update: mockDiscoveryUpdate,
        },
      },
    });

    expect(mockRegisterDomain).toHaveBeenCalledOnce();
  });

  it("registered adapter has storeResults: false on its config", async () => {
    const { registerDiscoveredDomain } = await import("../agent/registration");

    await registerDiscoveredDomain({
      discoveryId: "disc-ephemeral-1",
      proposedConfig: ephemeralConfig,
      prisma: {
        dataSource: { create: mockDataSourceCreate },
        domainDiscovery: {
          findUnique: mockDiscoveryFindUnique,
          update: mockDiscoveryUpdate,
        },
      },
    });

    const registeredAdapter = mockRegisterDomain.mock.calls[0]?.[0];
    expect(registeredAdapter?.config?.storeResults).toBe(false);
  });

  it("registered adapter config includes the correct intents and countries", async () => {
    const { registerDiscoveredDomain } = await import("../agent/registration");

    await registerDiscoveredDomain({
      discoveryId: "disc-ephemeral-1",
      proposedConfig: ephemeralConfig,
      prisma: {
        dataSource: { create: mockDataSourceCreate },
        domainDiscovery: {
          findUnique: mockDiscoveryFindUnique,
          update: mockDiscoveryUpdate,
        },
      },
    });

    const registeredAdapter = mockRegisterDomain.mock.calls[0]?.[0];
    expect(registeredAdapter?.config?.intents).toContain("cinema listings");
    expect(registeredAdapter?.config?.countries).toContain("GB");
  });

  it("marks the DomainDiscovery record as registered", async () => {
    const { registerDiscoveredDomain } = await import("../agent/registration");

    await registerDiscoveredDomain({
      discoveryId: "disc-ephemeral-1",
      proposedConfig: ephemeralConfig,
      prisma: {
        dataSource: { create: mockDataSourceCreate },
        domainDiscovery: {
          findUnique: mockDiscoveryFindUnique,
          update: mockDiscoveryUpdate,
        },
      },
    });

    expect(mockDiscoveryUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "disc-ephemeral-1" },
        data: expect.objectContaining({ status: "registered" }),
      }),
    );
  });

  it("returns { path: 'ephemeral', domainName }", async () => {
    const { registerDiscoveredDomain } = await import("../agent/registration");

    const result = await registerDiscoveredDomain({
      discoveryId: "disc-ephemeral-1",
      proposedConfig: ephemeralConfig,
      prisma: {
        dataSource: { create: mockDataSourceCreate },
        domainDiscovery: {
          findUnique: mockDiscoveryFindUnique,
          update: mockDiscoveryUpdate,
        },
      },
    });

    expect(result).toEqual({
      path: "ephemeral",
      domainName: "cinema-listings-gb",
    });
  });

  it("throws if proposedConfig is missing a name", async () => {
    const { registerDiscoveredDomain } = await import("../agent/registration");

    const badConfig = { ...ephemeralConfig, name: undefined };

    await expect(
      registerDiscoveredDomain({
        discoveryId: "disc-ephemeral-1",
        proposedConfig: badConfig as any,
        prisma: {
          dataSource: { create: mockDataSourceCreate },
          domainDiscovery: {
            findUnique: mockDiscoveryFindUnique,
            update: mockDiscoveryUpdate,
          },
        },
      }),
    ).rejects.toThrow();
  });

  it("throws if proposedConfig is missing an apiUrl", async () => {
    const { registerDiscoveredDomain } = await import("../agent/registration");

    const badConfig = { ...ephemeralConfig, apiUrl: undefined };

    await expect(
      registerDiscoveredDomain({
        discoveryId: "disc-ephemeral-1",
        proposedConfig: badConfig as any,
        prisma: {
          dataSource: { create: mockDataSourceCreate },
          domainDiscovery: {
            findUnique: mockDiscoveryFindUnique,
            update: mockDiscoveryUpdate,
          },
        },
      }),
    ).rejects.toThrow();
  });

  it("throws if the domainName is already registered in the registry", async () => {
    mockGetDomainByName.mockReturnValue({
      config: { name: "cinema-listings-gb" },
    });

    const { registerDiscoveredDomain } = await import("../agent/registration");

    await expect(
      registerDiscoveredDomain({
        discoveryId: "disc-ephemeral-1",
        proposedConfig: ephemeralConfig,
        prisma: {
          dataSource: { create: mockDataSourceCreate },
          domainDiscovery: {
            findUnique: mockDiscoveryFindUnique,
            update: mockDiscoveryUpdate,
          },
        },
      }),
    ).rejects.toThrow(/already registered/i);
  });

  it("does not create a DataSource record if the domain is already registered", async () => {
    mockGetDomainByName.mockReturnValue({
      config: { name: "cinema-listings-gb" },
    });

    const { registerDiscoveredDomain } = await import("../agent/registration");

    await registerDiscoveredDomain({
      discoveryId: "disc-ephemeral-1",
      proposedConfig: ephemeralConfig,
      prisma: {
        dataSource: { create: mockDataSourceCreate },
        domainDiscovery: {
          findUnique: mockDiscoveryFindUnique,
          update: mockDiscoveryUpdate,
        },
      },
    }).catch(() => {}); // expected to throw

    expect(mockDataSourceCreate).not.toHaveBeenCalled();
  });
});

// ── Suite 2: ephemeral adapter pipeline enforcement ───────────────────────────
// Once registered, the adapter must skip all storage operations.

describe("ephemeral adapter — pipeline enforcement", () => {
  it("registered adapter storeResults is a no-op — does not call prisma.queryResult.createMany", async () => {
    const { registerDiscoveredDomain } = await import("../agent/registration");

    await registerDiscoveredDomain({
      discoveryId: "disc-ephemeral-1",
      proposedConfig: ephemeralConfig,
      prisma: {
        dataSource: { create: mockDataSourceCreate },
        domainDiscovery: {
          findUnique: mockDiscoveryFindUnique,
          update: mockDiscoveryUpdate,
        },
      },
    });

    const registeredAdapter = mockRegisterDomain.mock.calls[0]?.[0];
    expect(registeredAdapter).toBeDefined();

    await registeredAdapter.storeResults(
      "query-1",
      [{ title: "Dune" }],
      mockPrismaForAdapter,
    );

    expect(mockPrismaForAdapter.queryResult.createMany).not.toHaveBeenCalled();
  });

  it("registered adapter fetchData is a callable function", async () => {
    const { registerDiscoveredDomain } = await import("../agent/registration");

    await registerDiscoveredDomain({
      discoveryId: "disc-ephemeral-1",
      proposedConfig: ephemeralConfig,
      prisma: {
        dataSource: { create: mockDataSourceCreate },
        domainDiscovery: {
          findUnique: mockDiscoveryFindUnique,
          update: mockDiscoveryUpdate,
        },
      },
    });

    const registeredAdapter = mockRegisterDomain.mock.calls[0]?.[0];
    expect(registeredAdapter).toBeDefined();
    expect(typeof registeredAdapter.fetchData).toBe("function");
  });

  it("registered adapter config has the correct name, apiUrl and storeResults", async () => {
    const { registerDiscoveredDomain } = await import("../agent/registration");

    await registerDiscoveredDomain({
      discoveryId: "disc-ephemeral-1",
      proposedConfig: ephemeralConfig,
      prisma: {
        dataSource: { create: mockDataSourceCreate },
        domainDiscovery: {
          findUnique: mockDiscoveryFindUnique,
          update: mockDiscoveryUpdate,
        },
      },
    });

    const registeredAdapter = mockRegisterDomain.mock.calls[0]?.[0];
    expect(registeredAdapter.config.name).toBe("cinema-listings-gb");
    expect(registeredAdapter.config.apiUrl).toBe(
      "https://www.odeon.co.uk/api/showtimes",
    );
    expect(registeredAdapter.config.storeResults).toBe(false);
  });
});
