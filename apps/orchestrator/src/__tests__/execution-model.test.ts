import { describe, it, expect, vi } from "vitest";

describe("createSnapshot", () => {
  it("creates a QueryRun and DatasetSnapshot with correct fields", async () => {
    const { createSnapshot } = await import("../execution-model");

    const mockPrisma = {
      queryRun: {
        create: vi.fn().mockResolvedValue({ id: "run-1", status: "pending" }),
        update: vi.fn().mockResolvedValue({}),
      },
      datasetSnapshot: {
        create: vi.fn().mockResolvedValue({ id: "snap-1" }),
      },
    };

    const rows = [
      { id: 1, category: "burglary" },
      { id: 2, category: "theft" },
    ];

    const result = await createSnapshot({
      queryId: "query-1",
      sourceSet: ["https://data.police.uk/api"],
      schemaVersion: "1.0",
      rows,
      prisma: mockPrisma as any,
    });

    expect(mockPrisma.queryRun.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          queryId: "query-1",
          sourceSet: ["https://data.police.uk/api"],
          schemaVersion: "1.0",
          status: "pending",
        }),
      }),
    );

    expect(mockPrisma.datasetSnapshot.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          queryRunId: "run-1",
          rowCount: 2,
          rows: rows,
        }),
      }),
    );

    expect(mockPrisma.queryRun.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "complete" }),
      }),
    );

    expect(result.runId).toBe("run-1");
    expect(result.snapshotId).toBe("snap-1");
  });

  it("generates a SHA-256 checksum of the rows", async () => {
    const { createSnapshot } = await import("../execution-model");

    const mockPrisma = {
      queryRun: {
        create: vi.fn().mockResolvedValue({ id: "run-2" }),
        update: vi.fn().mockResolvedValue({}),
      },
      datasetSnapshot: {
        create: vi.fn().mockResolvedValue({ id: "snap-2" }),
      },
    };

    const rows = [{ id: 1 }];
    await createSnapshot({
      queryId: "query-2",
      sourceSet: [],
      schemaVersion: "1.0",
      rows,
      prisma: mockPrisma as any,
    });

    const call = mockPrisma.datasetSnapshot.create.mock.calls[0][0];
    expect(call.data.checksum).toMatch(/^[a-f0-9]{64}$/);
  });

  it("produces the same checksum for identical rows", async () => {
    const { createSnapshot } = await import("../execution-model");

    const rows = [{ id: 1, name: "Alice" }];
    const checksums: string[] = [];

    for (let i = 0; i < 2; i++) {
      const mockPrisma = {
        queryRun: {
          create: vi.fn().mockResolvedValue({ id: `run-${i}` }),
          update: vi.fn().mockResolvedValue({}),
        },
        datasetSnapshot: {
          create: vi.fn().mockResolvedValue({ id: `snap-${i}` }),
        },
      };
      await createSnapshot({
        queryId: "query-3",
        sourceSet: [],
        schemaVersion: "1.0",
        rows,
        prisma: mockPrisma as any,
      });
      checksums.push(
        mockPrisma.datasetSnapshot.create.mock.calls[0][0].data.checksum,
      );
    }

    expect(checksums[0]).toBe(checksums[1]);
  });

  it("produces different checksums for different rows", async () => {
    const { createSnapshot } = await import("../execution-model");
    const checksums: string[] = [];

    for (const rows of [[{ id: 1 }], [{ id: 2 }]]) {
      const mockPrisma = {
        queryRun: {
          create: vi.fn().mockResolvedValue({ id: "run-x" }),
          update: vi.fn().mockResolvedValue({}),
        },
        datasetSnapshot: {
          create: vi.fn().mockResolvedValue({ id: "snap-x" }),
        },
      };
      await createSnapshot({
        queryId: "query-4",
        sourceSet: [],
        schemaVersion: "1.0",
        rows,
        prisma: mockPrisma as any,
      });
      checksums.push(
        mockPrisma.datasetSnapshot.create.mock.calls[0][0].data.checksum,
      );
    }

    expect(checksums[0]).not.toBe(checksums[1]);
  });

  it("marks QueryRun as failed when snapshot creation throws", async () => {
    const { createSnapshot } = await import("../execution-model");

    const mockPrisma = {
      queryRun: {
        create: vi.fn().mockResolvedValue({ id: "run-fail" }),
        update: vi.fn().mockResolvedValue({}),
      },
      datasetSnapshot: {
        create: vi.fn().mockRejectedValue(new Error("db error")),
      },
    };

    await expect(
      createSnapshot({
        queryId: "query-5",
        sourceSet: [],
        schemaVersion: "1.0",
        rows: [{ id: 1 }],
        prisma: mockPrisma as any,
      }),
    ).rejects.toThrow("db error");

    expect(mockPrisma.queryRun.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "failed" }),
      }),
    );
  });
});
