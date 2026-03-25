import { describe, it, expect, vi, beforeEach } from "vitest";
import axios from "axios";

vi.mock("axios");
vi.mock("../crime/intent", () => ({
  expandDateRange: vi.fn(),
}));

const mockAxiosGet = axios.get as ReturnType<typeof vi.fn>;

const { mockExpandDateRange } = vi.hoisted(() => ({
  mockExpandDateRange: vi.fn(),
}));

vi.mock("../../intent", () => ({
  expandDateRange: mockExpandDateRange,
}));

const mockCrime = {
  category: "burglary",
  location_type: "Force",
  location: {
    latitude: "52.2",
    longitude: "0.1",
    street: { id: 1, name: "Test Street" },
  },
  context: "",
  outcome_status: null,
  persistent_id: "abc123",
  id: 1,
  location_subtype: "",
  month: "2024-01",
};

function mockApiResponse(crimes: unknown[] = [mockCrime]) {
  mockAxiosGet.mockResolvedValue({ data: crimes });
}

const basePlan = {
  category: "burglary" as const,
  date_from: "2024-01",
  date_to: "2024-01",
  location: "Cambridge, UK",
};

const poly = "52.3,0.0:52.3,0.3:52.1,0.3:52.1,0.0";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("fetchCrimesForMonth", () => {
  it("calls correct URL with category slug", async () => {
    mockApiResponse();
    const { fetchCrimesForMonth } = await import("../../crime/fetcher");
    await fetchCrimesForMonth(basePlan, poly, "2024-01");
    expect(mockAxiosGet).toHaveBeenCalledWith(
      expect.stringContaining("crimes-street/burglary"),
      expect.any(Object),
    );
  });

  it("passes date param as the month argument", async () => {
    mockApiResponse();
    const { fetchCrimesForMonth } = await import("../../crime/fetcher");
    await fetchCrimesForMonth(basePlan, poly, "2024-01");
    expect(mockAxiosGet).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        params: expect.objectContaining({ date: "2024-01" }),
      }),
    );
  });

  it("passes poly param correctly", async () => {
    mockApiResponse();
    const { fetchCrimesForMonth } = await import("../../crime/fetcher");
    await fetchCrimesForMonth(basePlan, poly, "2024-01");
    expect(mockAxiosGet).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ params: expect.objectContaining({ poly }) }),
    );
  });

  it("returns array of RawCrime objects", async () => {
    mockApiResponse();
    const { fetchCrimesForMonth } = await import("../../crime/fetcher");
    const result = await fetchCrimesForMonth(basePlan, poly, "2024-01");
    expect(Array.isArray(result)).toBe(true);
    expect(result[0]).toMatchObject({ category: "burglary" });
  });

  it("unknown fields on crime objects are preserved", async () => {
    mockApiResponse([{ ...mockCrime, future_field: "some_value" }]);
    const { fetchCrimesForMonth } = await import("../../crime/fetcher");
    const result = await fetchCrimesForMonth(basePlan, poly, "2024-01");
    expect((result[0] as any).future_field).toBe("some_value");
  });

  it("handles empty array response without throwing", async () => {
    mockApiResponse([]);
    const { fetchCrimesForMonth } = await import("../../crime/fetcher");
    const result = await fetchCrimesForMonth(basePlan, poly, "2024-01");
    expect(result).toEqual([]);
  });

  it("throws when polygon exceeds 100 points", async () => {
    const longPoly = Array.from(
      { length: 101 },
      (_, i) => `${i}.0,${i}.0`,
    ).join(":");
    const { fetchCrimesForMonth } = await import("../../crime/fetcher");
    await expect(
      fetchCrimesForMonth(basePlan, longPoly, "2024-01"),
    ).rejects.toThrow("Polygon exceeds 100 points");
  });
});

describe("fetchCrimes", () => {
  async function setup(months: string[]) {
    const { expandDateRange } = await import("../../intent");
    (expandDateRange as ReturnType<typeof vi.fn>).mockReturnValue(months);
    mockApiResponse();
    return import("../../crime/fetcher");
  }

  it("calls API once for a single-month range", async () => {
    const { fetchCrimes } = await setup(["2024-01"]);
    await fetchCrimes(basePlan, poly);
    expect(mockAxiosGet).toHaveBeenCalledTimes(1);
  });

  it("calls API three times for a 3-month range", async () => {
    const { fetchCrimes } = await setup(["2024-01", "2024-02", "2024-03"]);
    await fetchCrimes(basePlan, poly);
    expect(mockAxiosGet).toHaveBeenCalledTimes(3);
  });

  it("calls API twelve times for a 12-month range", async () => {
    const months = Array.from(
      { length: 12 },
      (_, i) => `2024-${String(i + 1).padStart(2, "0")}`,
    );
    const { fetchCrimes } = await setup(months);
    await fetchCrimes(basePlan, poly);
    expect(mockAxiosGet).toHaveBeenCalledTimes(12);
  });

  it("merges results from all months into a single array", async () => {
    const { expandDateRange } = await import("../../intent");
    (expandDateRange as ReturnType<typeof vi.fn>).mockReturnValue([
      "2024-01",
      "2024-02",
    ]);
    mockAxiosGet
      .mockResolvedValueOnce({ data: [{ ...mockCrime, month: "2024-01" }] })
      .mockResolvedValueOnce({ data: [{ ...mockCrime, month: "2024-02" }] });
    const { fetchCrimes } = await import("../../crime/fetcher");
    const result = await fetchCrimes(basePlan, poly);
    expect(result).toHaveLength(2);
  });

  it("calls months sequentially, not in parallel", async () => {
    const order: string[] = [];
    const { expandDateRange } = await import("../../intent");
    (expandDateRange as ReturnType<typeof vi.fn>).mockReturnValue([
      "2024-01",
      "2024-02",
      "2024-03",
    ]);
    mockAxiosGet.mockImplementation((_url, config) => {
      order.push(config.params.date);
      return Promise.resolve({ data: [] });
    });
    const { fetchCrimes } = await import("../../crime/fetcher");
    await fetchCrimes(basePlan, poly);
    expect(order).toEqual(["2024-01", "2024-02", "2024-03"]);
  });

  it("returns combined results in month-ascending order", async () => {
    const { expandDateRange } = await import("../../intent");
    (expandDateRange as ReturnType<typeof vi.fn>).mockReturnValue([
      "2024-01",
      "2024-02",
    ]);
    mockAxiosGet
      .mockResolvedValueOnce({ data: [{ ...mockCrime, month: "2024-01" }] })
      .mockResolvedValueOnce({ data: [{ ...mockCrime, month: "2024-02" }] });
    const { fetchCrimes } = await import("../../crime/fetcher");
    const result = await fetchCrimes(basePlan, poly);
    expect(result[0].month).toBe("2024-01");
    expect(result[1].month).toBe("2024-02");
  });
});
