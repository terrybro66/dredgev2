import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";

// ── mock node-cron before any import ─────────────────────────────────────────
const { mockCronSchedule } = vi.hoisted(() => ({
  mockCronSchedule: vi.fn(),
}));
vi.mock("node-cron", () => ({
  schedule: mockCronSchedule,
  default: { schedule: mockCronSchedule },
}));

// ── mock execution-model so createSnapshot never hits real prisma ─────────────
const { mockCreateSnapshot } = vi.hoisted(() => ({
  mockCreateSnapshot: vi.fn(),
}));
vi.mock("../execution-model", () => ({ createSnapshot: mockCreateSnapshot }));

// ─────────────────────────────────────────────────────────────────────────────

// Import once — vi.resetModules() was clearing the mock registry between tests,
// causing node-cron to re-import as the real module. Since isEnabled() reads
// process.env dynamically at call time, a single import is sufficient.
let refreshScheduler: Awaited<
  typeof import("../enrichment/scheduler")
>["refreshScheduler"];

beforeAll(async () => {
  ({ refreshScheduler } = await import("../enrichment/scheduler"));
});

describe("RefreshScheduler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateSnapshot.mockResolvedValue({
      runId: "run-1",
      snapshotId: "snap-1",
    });
  });

  // ── isEnabled ───────────────────────────────────────────────────────────────

  it("isEnabled() returns false when REFRESH_SCHEDULER_ENABLED is not set", () => {
    delete process.env.REFRESH_SCHEDULER_ENABLED;
    expect(refreshScheduler.isEnabled()).toBe(false);
  });

  it("isEnabled() returns true when REFRESH_SCHEDULER_ENABLED=true", () => {
    process.env.REFRESH_SCHEDULER_ENABLED = "true";
    expect(refreshScheduler.isEnabled()).toBe(true);
  });

  // ── scheduleRefresh ─────────────────────────────────────────────────────────

  it("scheduleRefresh() registers a domain for refresh", () => {
    process.env.REFRESH_SCHEDULER_ENABLED = "true";
    const mockAdapter = {
      config: {
        identity: { name: "crime-uk", displayName: "Crime UK", description: "", countries: ["GB"], intents: ["crime"] },
        source: { type: "rest", endpoint: "https://example.com/data.csv" },
        template: { type: "listings", capabilities: {} },
        fields: {},
        time: { type: "static" },
        recovery: [],
        storage: { storeResults: true, tableName: "query_results", prismaModel: "queryResult", extrasStrategy: "retain_unmapped" },
        visualisation: { default: "table", rules: [] },
        cache: { ttlHours: 168 },
      },
      fetchData: vi.fn().mockResolvedValue([{ id: "1" }]),
      storeResults: vi.fn().mockResolvedValue(undefined),
    };

    refreshScheduler.scheduleRefresh(mockAdapter as any, {} as any);
    expect(mockCronSchedule).toHaveBeenCalledTimes(1);
  });

  it("scheduleRefresh() calls cron.schedule for a daily source", () => {
    process.env.REFRESH_SCHEDULER_ENABLED = "true";
    const mockAdapter = {
      config: {
        identity: { name: "crime-uk", displayName: "Crime UK", description: "", countries: ["GB"], intents: ["crime"] },
        source: { type: "rest", endpoint: "https://example.com/data.csv" },
        template: { type: "listings", capabilities: {} },
        fields: {},
        time: { type: "static" },
        recovery: [],
        storage: { storeResults: true, tableName: "query_results", prismaModel: "queryResult", extrasStrategy: "retain_unmapped" },
        visualisation: { default: "table", rules: [] },
        cache: { ttlHours: 168 },
      },
      fetchData: vi.fn().mockResolvedValue([]),
      storeResults: vi.fn().mockResolvedValue(undefined),
    };

    refreshScheduler.scheduleRefresh(mockAdapter as any, {} as any);

    expect(mockCronSchedule).toHaveBeenCalledWith(
      expect.stringContaining("0"),
      expect.any(Function),
    );
  });

  it("scheduleRefresh() calls cron.schedule for a weekly source", () => {
    process.env.REFRESH_SCHEDULER_ENABLED = "true";
    const mockAdapter = {
      config: {
        identity: { name: "crime-uk", displayName: "Crime UK", description: "", countries: ["GB"], intents: ["crime"] },
        source: { type: "rest", endpoint: "https://example.com/data.csv" },
        template: { type: "listings", capabilities: {} },
        fields: {},
        time: { type: "static" },
        recovery: [],
        storage: { storeResults: true, tableName: "query_results", prismaModel: "queryResult", extrasStrategy: "retain_unmapped" },
        visualisation: { default: "table", rules: [] },
        cache: { ttlHours: 168 },
      },
      fetchData: vi.fn().mockResolvedValue([]),
      storeResults: vi.fn().mockResolvedValue(undefined),
    };

    refreshScheduler.scheduleRefresh(mockAdapter as any, {} as any);

    expect(mockCronSchedule).toHaveBeenCalledTimes(1);
  });

  it("scheduleRefresh() does not schedule static sources (no cache field)", () => {
    process.env.REFRESH_SCHEDULER_ENABLED = "true";
    const mockAdapter = {
      config: {
        identity: { name: "static-domain", displayName: "Static", description: "", countries: [], intents: ["test"] },
        source: { type: "rest", endpoint: "https://example.com/data.csv" },
        template: { type: "listings", capabilities: {} },
        fields: {},
        time: { type: "static" },
        recovery: [],
        storage: { storeResults: true, tableName: "query_results", prismaModel: "queryResult", extrasStrategy: "retain_unmapped" },
        visualisation: { default: "table", rules: [] },
        // no cache field → scheduler treats as realtime → skips
      },
      fetchData: vi.fn().mockResolvedValue([]),
      storeResults: vi.fn().mockResolvedValue(undefined),
    };

    refreshScheduler.scheduleRefresh(mockAdapter as any, {} as any);

    expect(mockCronSchedule).not.toHaveBeenCalled();
  });

  it("scheduleRefresh() does not schedule realtime sources (no cache field)", () => {
    process.env.REFRESH_SCHEDULER_ENABLED = "true";
    const mockAdapter = {
      config: {
        identity: { name: "realtime-domain", displayName: "Realtime", description: "", countries: [], intents: ["test"] },
        source: { type: "rest", endpoint: "https://example.com/api" },
        template: { type: "listings", capabilities: {} },
        fields: {},
        time: { type: "realtime" },
        recovery: [],
        storage: { storeResults: true, tableName: "query_results", prismaModel: "queryResult", extrasStrategy: "retain_unmapped" },
        visualisation: { default: "table", rules: [] },
        // no cache field → skips
      },
      fetchData: vi.fn().mockResolvedValue([]),
      storeResults: vi.fn().mockResolvedValue(undefined),
    };

    refreshScheduler.scheduleRefresh(mockAdapter as any, {} as any);

    expect(mockCronSchedule).not.toHaveBeenCalled();
  });

  it("scheduleRefresh() does not call cron.schedule when disabled", () => {
    delete process.env.REFRESH_SCHEDULER_ENABLED;
    const mockAdapter = {
      config: {
        identity: { name: "crime-uk", displayName: "Crime UK", description: "", countries: ["GB"], intents: ["crime"] },
        source: { type: "rest", endpoint: "https://example.com/data.csv" },
        template: { type: "listings", capabilities: {} },
        fields: {},
        time: { type: "static" },
        recovery: [],
        storage: { storeResults: true, tableName: "query_results", prismaModel: "queryResult", extrasStrategy: "retain_unmapped" },
        visualisation: { default: "table", rules: [] },
        cache: { ttlHours: 168 },
      },
      fetchData: vi.fn().mockResolvedValue([]),
      storeResults: vi.fn().mockResolvedValue(undefined),
    };

    refreshScheduler.scheduleRefresh(mockAdapter as any, {} as any);

    expect(mockCronSchedule).not.toHaveBeenCalled();
  });

  // ── runRefresh ──────────────────────────────────────────────────────────────

  it("runRefresh() calls fetchData and creates a new snapshot", async () => {
    process.env.REFRESH_SCHEDULER_ENABLED = "true";
    const mockAdapter = {
      config: {
        identity: { name: "crime-uk", displayName: "Crime UK", description: "", countries: ["GB"], intents: ["crime"] },
        source: { type: "rest", endpoint: "https://example.com/data.csv" },
        template: { type: "listings", capabilities: {} },
        fields: {},
        time: { type: "static" },
        recovery: [],
        storage: { storeResults: true, tableName: "query_results", prismaModel: "queryResult", extrasStrategy: "retain_unmapped" },
        visualisation: { default: "table", rules: [] },
        cache: { ttlHours: 168 },
      },
      fetchData: vi.fn().mockResolvedValue([{ id: "1" }, { id: "2" }]),
      storeResults: vi.fn().mockResolvedValue(undefined),
    };

    await refreshScheduler.runRefresh(mockAdapter as any, {} as any);

    expect(mockAdapter.fetchData).toHaveBeenCalled();
    expect(mockCreateSnapshot).toHaveBeenCalled();
  });

  it("runRefresh() passes sourceSet from adapter sources to createSnapshot", async () => {
    process.env.REFRESH_SCHEDULER_ENABLED = "true";
    const mockAdapter = {
      config: {
        identity: { name: "crime-uk", displayName: "Crime UK", description: "", countries: ["GB"], intents: ["crime"] },
        source: { type: "rest", endpoint: "https://example.com/data.csv" },
        template: { type: "listings", capabilities: {} },
        fields: {},
        time: { type: "static" },
        recovery: [],
        storage: { storeResults: true, tableName: "query_results", prismaModel: "queryResult", extrasStrategy: "retain_unmapped" },
        visualisation: { default: "table", rules: [] },
        cache: { ttlHours: 168 },
      },
      fetchData: vi.fn().mockResolvedValue([{ id: "1" }]),
      storeResults: vi.fn().mockResolvedValue(undefined),
    };

    await refreshScheduler.runRefresh(mockAdapter as any, {} as any);

    expect(mockCreateSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceSet: ["https://example.com/data.csv"],
      }),
    );
  });

  it("runRefresh() uses source endpoint as sourceSet", async () => {
    process.env.REFRESH_SCHEDULER_ENABLED = "true";
    const mockAdapter = {
      config: {
        identity: { name: "crime-uk", displayName: "Crime UK", description: "", countries: ["GB"], intents: ["crime"] },
        source: { type: "rest", endpoint: "https://example.com/api" },
        template: { type: "listings", capabilities: {} },
        fields: {},
        time: { type: "static" },
        recovery: [],
        storage: { storeResults: true, tableName: "query_results", prismaModel: "queryResult", extrasStrategy: "retain_unmapped" },
        visualisation: { default: "table", rules: [] },
        cache: { ttlHours: 168 },
      },
      fetchData: vi.fn().mockResolvedValue([]),
      storeResults: vi.fn().mockResolvedValue(undefined),
    };

    await refreshScheduler.runRefresh(mockAdapter as any, {} as any);

    expect(mockCreateSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceSet: ["https://example.com/api"],
      }),
    );
  });

  it("runRefresh() queryId is prefixed with refresh: and includes domain name", async () => {
    process.env.REFRESH_SCHEDULER_ENABLED = "true";
    const mockAdapter = {
      config: {
        identity: { name: "crime-uk", displayName: "Crime UK", description: "", countries: ["GB"], intents: ["crime"] },
        source: { type: "rest", endpoint: "https://example.com" },
        template: { type: "listings", capabilities: {} },
        fields: {},
        time: { type: "static" },
        recovery: [],
        storage: { storeResults: true, tableName: "query_results", prismaModel: "queryResult", extrasStrategy: "retain_unmapped" },
        visualisation: { default: "table", rules: [] },
        cache: { ttlHours: 168 },
      },
      fetchData: vi.fn().mockResolvedValue([]),
      storeResults: vi.fn().mockResolvedValue(undefined),
    };

    await refreshScheduler.runRefresh(mockAdapter as any, {} as any);

    expect(mockCreateSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        queryId: expect.stringMatching(/^refresh:crime-uk:/),
      }),
    );
  });

  it("runRefresh() does not mutate existing snapshots", async () => {
    process.env.REFRESH_SCHEDULER_ENABLED = "true";
    const mockAdapter = {
      config: {
        identity: { name: "crime-uk", displayName: "Crime UK", description: "", countries: ["GB"], intents: ["crime"] },
        source: { type: "rest", endpoint: "https://example.com" },
        template: { type: "listings", capabilities: {} },
        fields: {},
        time: { type: "static" },
        recovery: [],
        storage: { storeResults: true, tableName: "query_results", prismaModel: "queryResult", extrasStrategy: "retain_unmapped" },
        visualisation: { default: "table", rules: [] },
        cache: { ttlHours: 168 },
      },
      fetchData: vi.fn().mockResolvedValue([]),
      storeResults: vi.fn().mockResolvedValue(undefined),
    };

    const mockPrisma = {
      queryRun: {
        create: vi.fn().mockResolvedValue({ id: "run-2" }),
        update: vi.fn().mockResolvedValue({}),
      },
      datasetSnapshot: {
        create: vi.fn().mockResolvedValue({ id: "snap-2" }),
        deleteMany: vi.fn(),
      },
    };

    await refreshScheduler.runRefresh(mockAdapter as any, mockPrisma as any);

    expect(mockPrisma.datasetSnapshot.deleteMany).not.toHaveBeenCalled();
  });

  it("runRefresh() returns early without calling createSnapshot when disabled", async () => {
    delete process.env.REFRESH_SCHEDULER_ENABLED;
    const mockAdapter = {
      config: {
        identity: { name: "crime-uk", displayName: "Crime UK", description: "", countries: ["GB"], intents: ["crime"] },
        source: { type: "rest", endpoint: "https://example.com" },
        template: { type: "listings", capabilities: {} },
        fields: {},
        time: { type: "static" },
        recovery: [],
        storage: { storeResults: true, tableName: "query_results", prismaModel: "queryResult", extrasStrategy: "retain_unmapped" },
        visualisation: { default: "table", rules: [] },
        cache: { ttlHours: 168 },
      },
      fetchData: vi.fn().mockResolvedValue([{ id: "1" }]),
      storeResults: vi.fn().mockResolvedValue(undefined),
    };

    await refreshScheduler.runRefresh(mockAdapter as any, {} as any);

    expect(mockAdapter.fetchData).not.toHaveBeenCalled();
    expect(mockCreateSnapshot).not.toHaveBeenCalled();
  });
});
