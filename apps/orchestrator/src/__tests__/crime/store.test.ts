import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockPrisma, mockGetCurrentColumns } = vi.hoisted(() => ({
  mockPrisma: {
    $queryRaw: vi.fn(),
    $transaction: vi.fn(),
    crimeResult: { create: vi.fn() },
  },
  mockGetCurrentColumns: vi.fn(),
}));

vi.mock("../../schema", () => ({
  getCurrentColumns: mockGetCurrentColumns,
}));
const baseCrime = {
  category: "burglary",
  month: "2024-01",
  location: {
    latitude: "52.2053",
    longitude: "0.1218",
    street: { id: 1, name: "Test Street" },
  },
  outcome_status: { category: "Under investigation", date: "2024-02" },
  location_type: "Force",
  context: "",
  persistent_id: "abc123",
  id: 1,
  location_subtype: "",
};

const baseColumns = [
  "id",
  "query_id",
  "persistent_id",
  "category",
  "month",
  "street",
  "latitude",
  "longitude",
  "outcome_category",
  "outcome_date",
  "location_type",
  "context",
  "raw",
];

beforeEach(() => {
  vi.clearAllMocks();
  mockGetCurrentColumns.mockResolvedValue(baseColumns);
  mockPrisma.$transaction.mockResolvedValue([]);
  mockPrisma.crimeResult.create.mockReturnValue({ then: vi.fn() });
});

describe("storeResults", () => {
  it("calls prisma.$transaction with the correct number of create operations", async () => {
    const { storeResults } = await import("../../crime/store");
    await storeResults("query-1", [baseCrime, baseCrime], mockPrisma as any);
    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
    const ops = mockPrisma.$transaction.mock.calls[0][0];
    expect(ops).toHaveLength(2);
  });

  it("latitude is stored as a float, not a string", async () => {
    const { storeResults } = await import("../../crime/store");
    await storeResults("query-1", [baseCrime], mockPrisma as any);
    const data = mockPrisma.crimeResult.create.mock.calls[0][0].data;
    expect(typeof data.latitude).toBe("number");
    expect(data.latitude).toBeCloseTo(52.2053);
  });

  it("longitude is stored as a float, not a string", async () => {
    const { storeResults } = await import("../../crime/store");
    await storeResults("query-1", [baseCrime], mockPrisma as any);
    const data = mockPrisma.crimeResult.create.mock.calls[0][0].data;
    expect(typeof data.longitude).toBe("number");
    expect(data.longitude).toBeCloseTo(0.1218);
  });

  it("raw field contains the full original crime object", async () => {
    const { storeResults } = await import("../../crime/store");
    await storeResults("query-1", [baseCrime], mockPrisma as any);
    const data = mockPrisma.crimeResult.create.mock.calls[0][0].data;
    expect(data.raw).toEqual(baseCrime);
  });

  it("only writes columns that currently exist in the schema", async () => {
    mockGetCurrentColumns.mockResolvedValue([
      "id",
      "query_id",
      "category",
      "month",
    ]);
    const { storeResults } = await import("../../crime/store");
    await storeResults("query-1", [baseCrime], mockPrisma as any);
    const data = mockPrisma.crimeResult.create.mock.calls[0][0].data;
    expect(Object.keys(data)).toEqual(
      expect.arrayContaining(["query_id", "category", "month"]),
    );
    expect(data).not.toHaveProperty("latitude");
    expect(data).not.toHaveProperty("street");
  });

  it("a column not in the schema is silently dropped", async () => {
    mockGetCurrentColumns.mockResolvedValue(["id", "query_id", "category"]);
    const { storeResults } = await import("../../crime/store");
    await storeResults("query-1", [baseCrime], mockPrisma as any);
    const data = mockPrisma.crimeResult.create.mock.calls[0][0].data;
    expect(data).not.toHaveProperty("month");
    expect(data).not.toHaveProperty("latitude");
  });

  it("a new column added by schema evolution in the same request is written correctly", async () => {
    mockGetCurrentColumns.mockResolvedValue([...baseColumns, "new_field"]);
    const crimeWithNew = { ...baseCrime, new_field: "extra_value" } as any;
    const { storeResults } = await import("../../crime/store");
    await storeResults("query-1", [crimeWithNew], mockPrisma as any);
    const data = mockPrisma.crimeResult.create.mock.calls[0][0].data;
    expect(data.new_field).toBe("extra_value");
  });

  it("unknown top-level fields are included in the flattened row", async () => {
    mockGetCurrentColumns.mockResolvedValue([...baseColumns, "future_field"]);
    const crimeWithUnknown = {
      ...baseCrime,
      future_field: "future_value",
    } as any;
    const { storeResults } = await import("../../crime/store");
    await storeResults("query-1", [crimeWithUnknown], mockPrisma as any);
    const data = mockPrisma.crimeResult.create.mock.calls[0][0].data;
    expect(data.future_field).toBe("future_value");
  });

  it("does not call prisma.$transaction when crimes array is empty", async () => {
    const { storeResults } = await import("../../crime/store");
    await storeResults("query-1", [], mockPrisma as any);
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });
});
