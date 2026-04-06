import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    queryResult: { createMany: vi.fn() },
  },
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

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.queryResult.createMany.mockResolvedValue({ count: 1 });
});

describe("storeResults", () => {
  it("does not call queryResult.createMany when crimes array is empty", async () => {
    const { storeResults } = await import("../domains/crime-uk/store");
    await storeResults("query-1", [], mockPrisma as any);
    expect(mockPrisma.queryResult.createMany).not.toHaveBeenCalled();
  });

  it("calls queryResult.createMany once with all rows", async () => {
    const { storeResults } = await import("../domains/crime-uk/store");
    await storeResults("query-1", [baseCrime, baseCrime], mockPrisma as any);
    expect(mockPrisma.queryResult.createMany).toHaveBeenCalledOnce();
    const { data } = mockPrisma.queryResult.createMany.mock.calls[0][0];
    expect(data).toHaveLength(2);
  });

  it("lat is a float parsed from location.latitude string", async () => {
    const { storeResults } = await import("../domains/crime-uk/store");
    await storeResults("query-1", [baseCrime], mockPrisma as any);
    const { data } = mockPrisma.queryResult.createMany.mock.calls[0][0];
    expect(typeof data[0].lat).toBe("number");
    expect(data[0].lat).toBeCloseTo(52.2053);
  });

  it("lon is a float parsed from location.longitude string", async () => {
    const { storeResults } = await import("../domains/crime-uk/store");
    await storeResults("query-1", [baseCrime], mockPrisma as any);
    const { data } = mockPrisma.queryResult.createMany.mock.calls[0][0];
    expect(typeof data[0].lon).toBe("number");
    expect(data[0].lon).toBeCloseTo(0.1218);
  });

  it("category is set from crime.category", async () => {
    const { storeResults } = await import("../domains/crime-uk/store");
    await storeResults("query-1", [baseCrime], mockPrisma as any);
    const { data } = mockPrisma.queryResult.createMany.mock.calls[0][0];
    expect(data[0].category).toBe("burglary");
  });

  it("location is the street name", async () => {
    const { storeResults } = await import("../domains/crime-uk/store");
    await storeResults("query-1", [baseCrime], mockPrisma as any);
    const { data } = mockPrisma.queryResult.createMany.mock.calls[0][0];
    expect(data[0].location).toBe("Test Street");
  });

  it("date is a Date parsed from the month string", async () => {
    const { storeResults } = await import("../domains/crime-uk/store");
    await storeResults("query-1", [baseCrime], mockPrisma as any);
    const { data } = mockPrisma.queryResult.createMany.mock.calls[0][0];
    expect(data[0].date).toBeInstanceOf(Date);
    expect((data[0].date as Date).getFullYear()).toBe(2024);
    expect((data[0].date as Date).getMonth()).toBe(0); // January
  });

  it("domain_name is crime-uk", async () => {
    const { storeResults } = await import("../domains/crime-uk/store");
    await storeResults("query-1", [baseCrime], mockPrisma as any);
    const { data } = mockPrisma.queryResult.createMany.mock.calls[0][0];
    expect(data[0].domain_name).toBe("crime-uk");
  });

  it("source_tag is police-api", async () => {
    const { storeResults } = await import("../domains/crime-uk/store");
    await storeResults("query-1", [baseCrime], mockPrisma as any);
    const { data } = mockPrisma.queryResult.createMany.mock.calls[0][0];
    expect(data[0].source_tag).toBe("police-api");
  });

  it("extras contains outcome_category, location_type, context, persistent_id", async () => {
    const { storeResults } = await import("../domains/crime-uk/store");
    await storeResults("query-1", [baseCrime], mockPrisma as any);
    const { data } = mockPrisma.queryResult.createMany.mock.calls[0][0];
    expect(data[0].extras).toMatchObject({
      outcome_category: "Under investigation",
      location_type: "Force",
      context: "",
      persistent_id: "abc123",
    });
  });

  it("raw field contains the full original crime object", async () => {
    const { storeResults } = await import("../domains/crime-uk/store");
    await storeResults("query-1", [baseCrime], mockPrisma as any);
    const { data } = mockPrisma.queryResult.createMany.mock.calls[0][0];
    expect(data[0].raw).toEqual(baseCrime);
  });

  it("query_id is passed through", async () => {
    const { storeResults } = await import("../domains/crime-uk/store");
    await storeResults("query-abc", [baseCrime], mockPrisma as any);
    const { data } = mockPrisma.queryResult.createMany.mock.calls[0][0];
    expect(data[0].query_id).toBe("query-abc");
  });
});
