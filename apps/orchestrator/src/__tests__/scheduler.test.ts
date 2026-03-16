import { describe, it, expect, vi, beforeEach } from "vitest";

describe("RefreshScheduler", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("isEnabled() returns false when REFRESH_SCHEDULER_ENABLED is not set", async () => {
    delete process.env.REFRESH_SCHEDULER_ENABLED;
    const { refreshScheduler } = await import("../enrichment/scheduler");
    expect(refreshScheduler.isEnabled()).toBe(false);
  });

  it("isEnabled() returns true when REFRESH_SCHEDULER_ENABLED=true", async () => {
    process.env.REFRESH_SCHEDULER_ENABLED = "true";
    const { refreshScheduler } = await import("../enrichment/scheduler");
    expect(refreshScheduler.isEnabled()).toBe(true);
  });

  it("scheduleRefresh() registers a domain for refresh", async () => {
    process.env.REFRESH_SCHEDULER_ENABLED = "true";
    const { refreshScheduler } = await import("../enrichment/scheduler");
    const mockAdapter = {
      config: {
        name: "crime-uk",
        sources: [
          { url: "https://example.com/data.csv", refreshPolicy: "daily" },
        ],
      },
      fetchData: vi.fn().mockResolvedValue([{ id: "1" }]),
      flattenRow: (r: unknown) => r as Record<string, unknown>,
      storeResults: vi.fn().mockResolvedValue(undefined),
    };

    expect(() =>
      refreshScheduler.scheduleRefresh(mockAdapter as any, {} as any),
    ).not.toThrow();
  });

  it("runRefresh() calls fetchData and creates a new snapshot", async () => {
    process.env.REFRESH_SCHEDULER_ENABLED = "true";
    const { refreshScheduler } = await import("../enrichment/scheduler");

    const mockAdapter = {
      config: {
        name: "crime-uk",
        apiUrl: "https://example.com",
        sources: [
          { url: "https://example.com/data.csv", refreshPolicy: "daily" },
        ],
      },
      fetchData: vi.fn().mockResolvedValue([{ id: "1" }, { id: "2" }]),
      flattenRow: (r: unknown) => r as Record<string, unknown>,
      storeResults: vi.fn().mockResolvedValue(undefined),
    };

    const mockPrisma = {
      queryRun: {
        create: vi.fn().mockResolvedValue({ id: "run-1" }),
        update: vi.fn().mockResolvedValue({}),
      },
      datasetSnapshot: {
        create: vi.fn().mockResolvedValue({ id: "snap-1" }),
      },
    };

    await refreshScheduler.runRefresh(mockAdapter as any, mockPrisma as any);

    expect(mockAdapter.fetchData).toHaveBeenCalled();
    expect(mockPrisma.queryRun.create).toHaveBeenCalled();
    expect(mockPrisma.datasetSnapshot.create).toHaveBeenCalled();
  });

  it("runRefresh() does not mutate existing snapshots", async () => {
    process.env.REFRESH_SCHEDULER_ENABLED = "true";
    const { refreshScheduler } = await import("../enrichment/scheduler");

    const mockAdapter = {
      config: {
        name: "crime-uk",
        apiUrl: "https://example.com",
        sources: [],
      },
      fetchData: vi.fn().mockResolvedValue([]),
      flattenRow: (r: unknown) => r as Record<string, unknown>,
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

    // Must never delete existing snapshots
    expect(mockPrisma.datasetSnapshot.deleteMany).not.toHaveBeenCalled();
  });
});
