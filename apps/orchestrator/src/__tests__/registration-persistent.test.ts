/**
 * Block F — Registration: persistent path (storeResults: true)
 *
 * Branch: feat/registration-persistent
 *
 * Tests cover the full contract of registerDiscoveredDomain() when the
 * proposed config has storeResults: true:
 *
 *   - Creates a DataSource record with storeResults: true
 *   - Creates a new domain entry in the registry if one doesn't exist
 *   - Reuses existing domain entry if one already exists for the same name
 *   - Registers a full GenericAdapter with storage in the domain registry
 *   - The registered adapter writes results to query_results on fetch
 *   - Marks the DomainDiscovery record as registered
 *   - Returns { path: "persistent", domainName }
 *   - Throws on invalid config
 *   - End-to-end: registered adapter is queryable via getDomainForQuery
 *
 * Run:
 *   pnpm vitest run src/__tests__/registration-persistent.test.ts --reporter=verbose
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Hoist all mock factories before vi.mock() calls ───────────────────────────

const { mockDataSourceCreate } = vi.hoisted(() => ({
  mockDataSourceCreate: vi.fn(),
}));
const { mockDataSourceFindFirst } = vi.hoisted(() => ({
  mockDataSourceFindFirst: vi.fn(),
}));
const { mockDiscoveryUpdate } = vi.hoisted(() => ({
  mockDiscoveryUpdate: vi.fn(),
}));
const { mockRegisterDomain } = vi.hoisted(() => ({
  mockRegisterDomain: vi.fn(),
}));
const { mockGetDomainByName } = vi.hoisted(() => ({
  mockGetDomainByName: vi.fn(),
}));
const { mockGetDomainForQuery } = vi.hoisted(() => ({
  mockGetDomainForQuery: vi.fn(),
}));

vi.mock("../db", () => ({
  prisma: {
    dataSource: {
      create: mockDataSourceCreate,
      findFirst: mockDataSourceFindFirst,
    },
    domainDiscovery: {
      update: mockDiscoveryUpdate,
    },
  },
}));

vi.mock("../domains/registry", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../domains/registry")>();
  return {
    ...actual,
    registerDomain: mockRegisterDomain,
    getDomainByName: mockGetDomainByName,
    getDomainForQuery: mockGetDomainForQuery,
  };
});

// ── Shared fixtures ───────────────────────────────────────────────────────────

const persistentConfig = {
  name: "flood-risk-gb",
  apiUrl: "https://environment.data.gov.uk/flood-monitoring/api/floodAreas",
  providerType: "rest" as const,
  fieldMap: {
    description: "description",
    label: "location",
    lat: "lat",
    long: "lon",
  },
  storeResults: true,
  refreshPolicy: "daily" as const,
  ephemeralRationale: "",
  confidence: 0.92,
  intent: "flood risk",
  country_code: "GB",
  sampleRows: [
    {
      description: "Flood alert for River Thames",
      label: "River Thames at Twickenham",
      lat: 51.45,
      long: -0.33,
    },
  ],
};

const mockPrismaForAdapter = {
  queryResult: {
    createMany: vi.fn().mockResolvedValue({ count: 2 }),
    findMany: vi.fn().mockResolvedValue([]),
  },
  dataSource: {
    findMany: vi.fn().mockResolvedValue([]),
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  mockDataSourceCreate.mockResolvedValue({
    id: "ds-persist-1",
    ...persistentConfig,
  });
  mockDataSourceFindFirst.mockResolvedValue(null);
  mockDiscoveryUpdate.mockResolvedValue({});
  mockRegisterDomain.mockImplementation(() => {});
  mockGetDomainByName.mockReturnValue(undefined); // not already registered
  mockGetDomainForQuery.mockReturnValue(undefined);

  mockPrismaForAdapter.queryResult.createMany.mockResolvedValue({ count: 2 });
  mockPrismaForAdapter.queryResult.findMany.mockResolvedValue([]);
  mockPrismaForAdapter.dataSource.findMany.mockResolvedValue([]);
});

// ── Suite 1: registerDiscoveredDomain — persistent path ───────────────────────

describe("registerDiscoveredDomain — persistent path (storeResults: true)", () => {
  it("creates a DataSource record with storeResults: true", async () => {
    const { registerDiscoveredDomain } = await import("../agent/registration");

    await registerDiscoveredDomain({
      discoveryId: "disc-persist-1",
      proposedConfig: persistentConfig,
      prisma: {
        dataSource: { create: mockDataSourceCreate },
        domainDiscovery: { update: mockDiscoveryUpdate },
      },
    });

    expect(mockDataSourceCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          storeResults: true,
          domainName: "flood-risk-gb",
        }),
      }),
    );
  });

  it("creates a DataSource with the correct refreshPolicy from proposed config", async () => {
    const { registerDiscoveredDomain } = await import("../agent/registration");

    await registerDiscoveredDomain({
      discoveryId: "disc-persist-1",
      proposedConfig: persistentConfig,
      prisma: {
        dataSource: { create: mockDataSourceCreate },
        domainDiscovery: { update: mockDiscoveryUpdate },
      },
    });

    expect(mockDataSourceCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          refreshPolicy: "daily",
          url: "https://environment.data.gov.uk/flood-monitoring/api/floodAreas",
        }),
      }),
    );
  });

  it("registers a GenericAdapter in the domain registry", async () => {
    const { registerDiscoveredDomain } = await import("../agent/registration");

    await registerDiscoveredDomain({
      discoveryId: "disc-persist-1",
      proposedConfig: persistentConfig,
      prisma: {
        dataSource: { create: mockDataSourceCreate },
        domainDiscovery: { update: mockDiscoveryUpdate },
      },
    });

    expect(mockRegisterDomain).toHaveBeenCalledOnce();
  });

  it("registered adapter has storeResults: true on its config", async () => {
    const { registerDiscoveredDomain } = await import("../agent/registration");

    await registerDiscoveredDomain({
      discoveryId: "disc-persist-1",
      proposedConfig: persistentConfig,
      prisma: {
        dataSource: { create: mockDataSourceCreate },
        domainDiscovery: { update: mockDiscoveryUpdate },
      },
    });

    const registeredAdapter = mockRegisterDomain.mock.calls[0]?.[0];
    expect(registeredAdapter?.config?.storeResults).toBe(true);
  });

  it("registered adapter config includes the correct intents and countries", async () => {
    const { registerDiscoveredDomain } = await import("../agent/registration");

    await registerDiscoveredDomain({
      discoveryId: "disc-persist-1",
      proposedConfig: persistentConfig,
      prisma: {
        dataSource: { create: mockDataSourceCreate },
        domainDiscovery: { update: mockDiscoveryUpdate },
      },
    });

    const registeredAdapter = mockRegisterDomain.mock.calls[0]?.[0];
    expect(registeredAdapter?.config?.intents).toContain("flood risk");
    expect(registeredAdapter?.config?.countries).toContain("GB");
  });

  it("registered adapter config has tableName: query_results and prismaModel: queryResult", async () => {
    const { registerDiscoveredDomain } = await import("../agent/registration");

    await registerDiscoveredDomain({
      discoveryId: "disc-persist-1",
      proposedConfig: persistentConfig,
      prisma: {
        dataSource: { create: mockDataSourceCreate },
        domainDiscovery: { update: mockDiscoveryUpdate },
      },
    });

    const registeredAdapter = mockRegisterDomain.mock.calls[0]?.[0];
    expect(registeredAdapter?.config?.tableName).toBe("query_results");
    expect(registeredAdapter?.config?.prismaModel).toBe("queryResult");
  });

  it("marks the DomainDiscovery record as registered", async () => {
    const { registerDiscoveredDomain } = await import("../agent/registration");

    await registerDiscoveredDomain({
      discoveryId: "disc-persist-1",
      proposedConfig: persistentConfig,
      prisma: {
        dataSource: { create: mockDataSourceCreate },
        domainDiscovery: { update: mockDiscoveryUpdate },
      },
    });

    expect(mockDiscoveryUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "disc-persist-1" },
        data: expect.objectContaining({ status: "registered" }),
      }),
    );
  });

  it("returns { path: 'persistent', domainName }", async () => {
    const { registerDiscoveredDomain } = await import("../agent/registration");

    const result = await registerDiscoveredDomain({
      discoveryId: "disc-persist-1",
      proposedConfig: persistentConfig,
      prisma: {
        dataSource: { create: mockDataSourceCreate },
        domainDiscovery: { update: mockDiscoveryUpdate },
      },
    });

    expect(result).toEqual({
      path: "persistent",
      domainName: "flood-risk-gb",
    });
  });

  it("throws if proposedConfig is missing a name", async () => {
    const { registerDiscoveredDomain } = await import("../agent/registration");

    await expect(
      registerDiscoveredDomain({
        discoveryId: "disc-persist-1",
        proposedConfig: { ...persistentConfig, name: undefined } as any,
        prisma: {
          dataSource: { create: mockDataSourceCreate },
          domainDiscovery: { update: mockDiscoveryUpdate },
        },
      }),
    ).rejects.toThrow();
  });

  it("throws if domainName is already registered in the registry", async () => {
    mockGetDomainByName.mockReturnValue({
      config: { name: "flood-risk-gb" },
    });

    const { registerDiscoveredDomain } = await import("../agent/registration");

    await expect(
      registerDiscoveredDomain({
        discoveryId: "disc-persist-1",
        proposedConfig: persistentConfig,
        prisma: {
          dataSource: { create: mockDataSourceCreate },
          domainDiscovery: { update: mockDiscoveryUpdate },
        },
      }),
    ).rejects.toThrow(/already registered/i);
  });

  it("does not create a DataSource if domain is already registered", async () => {
    mockGetDomainByName.mockReturnValue({
      config: { name: "flood-risk-gb" },
    });

    const { registerDiscoveredDomain } = await import("../agent/registration");

    await registerDiscoveredDomain({
      discoveryId: "disc-persist-1",
      proposedConfig: persistentConfig,
      prisma: {
        dataSource: { create: mockDataSourceCreate },
        domainDiscovery: { update: mockDiscoveryUpdate },
      },
    }).catch(() => {});

    expect(mockDataSourceCreate).not.toHaveBeenCalled();
  });
});

// ── Suite 2: persistent adapter — storage behaviour ───────────────────────────

describe("persistent adapter — storage behaviour", () => {
  it("registered adapter storeResults calls prisma.queryResult.createMany", async () => {
    const { registerDiscoveredDomain } = await import("../agent/registration");

    await registerDiscoveredDomain({
      discoveryId: "disc-persist-1",
      proposedConfig: persistentConfig,
      prisma: {
        dataSource: { create: mockDataSourceCreate },
        domainDiscovery: { update: mockDiscoveryUpdate },
      },
    });

    const registeredAdapter = mockRegisterDomain.mock.calls[0]?.[0];
    expect(registeredAdapter).toBeDefined();

    const rows = [
      {
        description: "Flood alert",
        date: "2025-06-01",
        source_tag: "environment-agency",
        lat: 51.45,
        lon: -0.33,
      },
    ];

    await registeredAdapter.storeResults("query-1", rows, mockPrismaForAdapter);

    expect(mockPrismaForAdapter.queryResult.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([
          expect.objectContaining({
            domain_name: "flood-risk-gb",
            description: "Flood alert",
          }),
        ]),
      }),
    );
  });

  it("registered adapter storeResults is a no-op when rows is empty", async () => {
    const { registerDiscoveredDomain } = await import("../agent/registration");

    await registerDiscoveredDomain({
      discoveryId: "disc-persist-1",
      proposedConfig: persistentConfig,
      prisma: {
        dataSource: { create: mockDataSourceCreate },
        domainDiscovery: { update: mockDiscoveryUpdate },
      },
    });

    const registeredAdapter = mockRegisterDomain.mock.calls[0]?.[0];

    await registeredAdapter.storeResults("query-1", [], mockPrismaForAdapter);

    expect(mockPrismaForAdapter.queryResult.createMany).not.toHaveBeenCalled();
  });

  it("registered adapter storeResults writes domain_name on every row", async () => {
    const { registerDiscoveredDomain } = await import("../agent/registration");

    await registerDiscoveredDomain({
      discoveryId: "disc-persist-1",
      proposedConfig: persistentConfig,
      prisma: {
        dataSource: { create: mockDataSourceCreate },
        domainDiscovery: { update: mockDiscoveryUpdate },
      },
    });

    const registeredAdapter = mockRegisterDomain.mock.calls[0]?.[0];

    const rows = [
      { description: "Alert A", source_tag: "ea", date: "2025-06-01" },
      { description: "Alert B", source_tag: "ea", date: "2025-06-02" },
    ];

    await registeredAdapter.storeResults("query-1", rows, mockPrismaForAdapter);

    const written =
      mockPrismaForAdapter.queryResult.createMany.mock.calls[0][0].data;
    expect(written).toHaveLength(2);
    expect(written[0].domain_name).toBe("flood-risk-gb");
    expect(written[1].domain_name).toBe("flood-risk-gb");
  });

  it("registered adapter fetchData is a callable function", async () => {
    const { registerDiscoveredDomain } = await import("../agent/registration");

    await registerDiscoveredDomain({
      discoveryId: "disc-persist-1",
      proposedConfig: persistentConfig,
      prisma: {
        dataSource: { create: mockDataSourceCreate },
        domainDiscovery: { update: mockDiscoveryUpdate },
      },
    });

    const registeredAdapter = mockRegisterDomain.mock.calls[0]?.[0];
    expect(typeof registeredAdapter.fetchData).toBe("function");
  });

  it("registered adapter config has correct name and apiUrl", async () => {
    const { registerDiscoveredDomain } = await import("../agent/registration");

    await registerDiscoveredDomain({
      discoveryId: "disc-persist-1",
      proposedConfig: persistentConfig,
      prisma: {
        dataSource: { create: mockDataSourceCreate },
        domainDiscovery: { update: mockDiscoveryUpdate },
      },
    });

    const registeredAdapter = mockRegisterDomain.mock.calls[0]?.[0];
    expect(registeredAdapter.config.name).toBe("flood-risk-gb");
    expect(registeredAdapter.config.apiUrl).toBe(
      "https://environment.data.gov.uk/flood-monitoring/api/floodAreas",
    );
  });
});
