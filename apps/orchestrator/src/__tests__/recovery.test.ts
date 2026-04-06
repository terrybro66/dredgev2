import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock("../domains/crime-uk/fetcher", () => ({ fetchCrimes: vi.fn() }));
vi.mock("../geocoder", () => ({ geocodeToPolygon: vi.fn() }));
vi.mock("../availability", () => ({
  getLatestMonth: vi.fn(),
  isMonthAvailable: vi.fn(),
}));

import { fetchCrimes } from "../domains/crime-uk/fetcher";
import { geocodeToPolygon } from "../geocoder";
import { getLatestMonth, isMonthAvailable } from "../availability";

const mockFetchCrimes = fetchCrimes as ReturnType<typeof vi.fn>;
const mockGeocodeToPolygon = geocodeToPolygon as ReturnType<typeof vi.fn>;
const mockGetLatestMonth = getLatestMonth as ReturnType<typeof vi.fn>;
const mockIsMonthAvailable = isMonthAvailable as ReturnType<typeof vi.fn>;

import {
  recoverWithLatestMonth,
  recoverWithSmallerRadius,
  recoverWithAllCrime,
  recoverFromEmpty,
} from "../domains/crime-uk/recovery";

const MOCK_PLAN = {
  category: "burglary" as const,
  date_from: "2026-03",
  date_to: "2026-03",
  location: "Cambridge, UK",
};
const MOCK_POLY = "52.0,0.0:52.1,0.1:52.2,0.0";
const MOCK_PRISMA = {};
const MOCK_CRIMES = [{ id: 1 }, { id: 2 }];
const MOCK_SMALLER_POLY = "52.0,0.0:52.05,0.05";

beforeEach(() => {
  vi.clearAllMocks();
  mockGetLatestMonth.mockReturnValue("2025-10");
  mockIsMonthAvailable.mockReturnValue(false); // date_from not in availability → eligible
  mockFetchCrimes.mockResolvedValue(MOCK_CRIMES);
  mockGeocodeToPolygon.mockResolvedValue({ poly: MOCK_SMALLER_POLY });
});

// ── recoverWithLatestMonth ────────────────────────────────────────────────────

describe("recoverWithLatestMonth", () => {
  it("returns null when getLatestMonth returns null (availability not loaded)", async () => {
    mockGetLatestMonth.mockReturnValue(null);
    expect(await recoverWithLatestMonth(MOCK_PLAN, MOCK_POLY)).toBeNull();
  });

  it("returns null when isMonthAvailable returns true for plan.date_from (month exists, just no data)", async () => {
    mockIsMonthAvailable.mockReturnValue(true);
    expect(await recoverWithLatestMonth(MOCK_PLAN, MOCK_POLY)).toBeNull();
  });

  it("returns null when the fallback fetch also returns []", async () => {
    mockFetchCrimes.mockResolvedValue([]);
    expect(await recoverWithLatestMonth(MOCK_PLAN, MOCK_POLY)).toBeNull();
  });

  it("returns a RecoveryResult with fallback.field === 'date' when fetch succeeds", async () => {
    const result = await recoverWithLatestMonth(MOCK_PLAN, MOCK_POLY);
    expect(result).not.toBeNull();
    expect(result!.fallback.field).toBe("date");
  });

  it("fallback.original equals plan.date_from and fallback.used equals the latest month", async () => {
    const result = await recoverWithLatestMonth(MOCK_PLAN, MOCK_POLY);
    expect(result!.fallback.original).toBe(MOCK_PLAN.date_from);
    expect(result!.fallback.used).toBe("2025-10");
  });

  it("fallback.explanation is a non-empty string", async () => {
    const result = await recoverWithLatestMonth(MOCK_PLAN, MOCK_POLY);
    expect(result!.fallback.explanation).toBeTypeOf("string");
    expect(result!.fallback.explanation.length).toBeGreaterThan(0);
  });
});

// ── recoverWithSmallerRadius ──────────────────────────────────────────────────

describe("recoverWithSmallerRadius", () => {
  it("returns null when geocode succeeds but fetch still returns []", async () => {
    mockFetchCrimes.mockResolvedValue([]);
    expect(
      await recoverWithSmallerRadius(MOCK_PLAN, MOCK_POLY, MOCK_PRISMA),
    ).toBeNull();
  });

  it("returns a RecoveryResult with fallback.field === 'radius' when fetch succeeds", async () => {
    const result = await recoverWithSmallerRadius(
      MOCK_PLAN,
      MOCK_POLY,
      MOCK_PRISMA,
    );
    expect(result).not.toBeNull();
    expect(result!.fallback.field).toBe("radius");
  });

  it("returns null (does not throw) when geocodeToPolygon throws", async () => {
    mockGeocodeToPolygon.mockRejectedValue(new Error("geocode failed"));
    await expect(
      recoverWithSmallerRadius(MOCK_PLAN, MOCK_POLY, MOCK_PRISMA),
    ).resolves.toBeNull();
  });

  it("fallback.original is '5km' and fallback.used is '2km'", async () => {
    const result = await recoverWithSmallerRadius(
      MOCK_PLAN,
      MOCK_POLY,
      MOCK_PRISMA,
    );
    expect(result!.fallback.original).toBe("5km");
    expect(result!.fallback.used).toBe("2km");
  });
});

// ── recoverWithAllCrime ───────────────────────────────────────────────────────

describe("recoverWithAllCrime", () => {
  it("returns null when plan.category === 'all-crime' — does not retry", async () => {
    const allCrimePlan = { ...MOCK_PLAN, category: "all-crime" as const };
    expect(await recoverWithAllCrime(allCrimePlan, MOCK_POLY)).toBeNull();
    expect(mockFetchCrimes).not.toHaveBeenCalled();
  });

  it("returns null when the broadened fetch also returns []", async () => {
    mockFetchCrimes.mockResolvedValue([]);
    expect(await recoverWithAllCrime(MOCK_PLAN, MOCK_POLY)).toBeNull();
  });

  it("returns a RecoveryResult with fallback.field === 'category' when fetch succeeds", async () => {
    const result = await recoverWithAllCrime(MOCK_PLAN, MOCK_POLY);
    expect(result!.fallback.field).toBe("category");
  });

  it("fallback.original is the specific category and fallback.used is 'all-crime'", async () => {
    const result = await recoverWithAllCrime(MOCK_PLAN, MOCK_POLY);
    expect(result!.fallback.original).toBe("burglary");
    expect(result!.fallback.used).toBe("all-crime");
  });
});

// ── recoverFromEmpty (orchestrator) ──────────────────────────────────────────

describe("recoverFromEmpty", () => {
  // Spy on individual strategies to verify call order and short-circuit
  // We test via observable side effects (fetchCrimes call count + returned field)

  it("when strategy 1 succeeds, returns its result without trying strategies 2 or 3", async () => {
    // Strategy 1 succeeds (default mocks: availability miss, fetchCrimes returns data)
    const result = await recoverFromEmpty(MOCK_PLAN, MOCK_POLY, MOCK_PRISMA);
    expect(result!.fallback.field).toBe("date");
    // geocodeToPolygon (strategy 2) should not have been called
    expect(mockGeocodeToPolygon).not.toHaveBeenCalled();
    // fetchCrimes called exactly once (for strategy 1)
    expect(mockFetchCrimes).toHaveBeenCalledTimes(1);
  });

  it("when strategy 1 returns null and strategy 2 succeeds, returns strategy 2's result", async () => {
    // Make strategy 1 fail: mark month as available (no date substitution)
    mockIsMonthAvailable.mockReturnValue(true);

    const result = await recoverFromEmpty(MOCK_PLAN, MOCK_POLY, MOCK_PRISMA);
    expect(result!.fallback.field).toBe("radius");
    expect(mockGeocodeToPolygon).toHaveBeenCalledTimes(1);
  });

  it("when strategies 1 and 2 return null, strategy 3 succeeds and is returned", async () => {
    mockIsMonthAvailable.mockReturnValue(true); // strategy 1 → null
    mockGeocodeToPolygon.mockRejectedValue(new Error("no geocode")); // strategy 2 → null

    const result = await recoverFromEmpty(MOCK_PLAN, MOCK_POLY, MOCK_PRISMA);
    expect(result!.fallback.field).toBe("category");
  });

  it("when all three strategies return null, returns null", async () => {
    mockIsMonthAvailable.mockReturnValue(true); // strategy 1 → null
    mockGeocodeToPolygon.mockRejectedValue(new Error("no geocode")); // strategy 2 → null
    const allCrimePlan = { ...MOCK_PLAN, category: "all-crime" as const }; // strategy 3 → null

    const result = await recoverFromEmpty(allCrimePlan, MOCK_POLY, MOCK_PRISMA);
    expect(result).toBeNull();
  });

  it("strategies are always tried in order 1 → 2 → 3", async () => {
    // Force strategies 1 and 2 to return null, verify strategy 3 is reached
    mockIsMonthAvailable.mockReturnValue(true);
    mockFetchCrimes
      .mockResolvedValueOnce([]) // strategy 2 fetch → null
      .mockResolvedValueOnce(MOCK_CRIMES); // strategy 3 fetch → success

    mockGeocodeToPolygon.mockResolvedValue({ poly: MOCK_SMALLER_POLY });

    const result = await recoverFromEmpty(MOCK_PLAN, MOCK_POLY, MOCK_PRISMA);
    expect(result!.fallback.field).toBe("category");
    // geocodeToPolygon called once (strategy 2), fetchCrimes called twice (strategies 2 + 3)
    expect(mockGeocodeToPolygon).toHaveBeenCalledTimes(1);
    expect(mockFetchCrimes).toHaveBeenCalledTimes(2);
  });
});
