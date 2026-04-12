import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockGetLatestMonth } = vi.hoisted(() => ({
  mockGetLatestMonth: vi.fn(),
}));

vi.mock("../availability", () => ({
  getLatestMonth: mockGetLatestMonth,
}));

import {
  defaultResolveTemporalRange,
  resolveTemporalRangeForCrime,
} from "../temporal-resolver";

// ── helpers ───────────────────────────────────────────────────────────────────

function monthsAgo(n: number): string {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

beforeEach(() => {
  mockGetLatestMonth.mockReset();
});

// ── defaultResolveTemporalRange ───────────────────────────────────────────────

describe("defaultResolveTemporalRange", () => {
  describe("'unspecified'", () => {
    it("returns last calendar month for both date_from and date_to", () => {
      const result = defaultResolveTemporalRange("unspecified");
      const lm = monthsAgo(1);
      expect(result).toEqual({ date_from: lm, date_to: lm });
    });
  });

  describe("'last month'", () => {
    it("returns last calendar month for both date_from and date_to", () => {
      const result = defaultResolveTemporalRange("last month");
      const lm = monthsAgo(1);
      expect(result).toEqual({ date_from: lm, date_to: lm });
    });
  });

  describe("'last N months'", () => {
    it("'last 3 months' — date_from is 3 months ago, date_to is last month", () => {
      const result = defaultResolveTemporalRange("last 3 months");
      expect(result).toEqual({
        date_from: monthsAgo(3),
        date_to: monthsAgo(1),
      });
    });

    it("'last 6 months' — date_from is 6 months ago", () => {
      const result = defaultResolveTemporalRange("last 6 months");
      expect(result).toEqual({
        date_from: monthsAgo(6),
        date_to: monthsAgo(1),
      });
    });

    it("'last 12 months' — date_from is 12 months ago", () => {
      const result = defaultResolveTemporalRange("last 12 months");
      expect(result).toEqual({
        date_from: monthsAgo(12),
        date_to: monthsAgo(1),
      });
    });

    it("'last 1 months' — same as last month", () => {
      const result = defaultResolveTemporalRange("last 1 months");
      const lm = monthsAgo(1);
      expect(result).toEqual({ date_from: lm, date_to: lm });
    });
  });

  describe("'last year'", () => {
    it("date_from is 12 months ago, date_to is last month", () => {
      const result = defaultResolveTemporalRange("last year");
      expect(result).toEqual({
        date_from: monthsAgo(12),
        date_to: monthsAgo(1),
      });
    });
  });

  describe("named month — 'January 2026'", () => {
    it("resolves January 2026 to 2026-01 for both fields", () => {
      const result = defaultResolveTemporalRange("January 2026");
      expect(result).toEqual({ date_from: "2026-01", date_to: "2026-01" });
    });

    it("resolves March 2025 correctly", () => {
      const result = defaultResolveTemporalRange("March 2025");
      expect(result).toEqual({ date_from: "2025-03", date_to: "2025-03" });
    });

    it("resolves December 2024 correctly", () => {
      const result = defaultResolveTemporalRange("December 2024");
      expect(result).toEqual({ date_from: "2024-12", date_to: "2024-12" });
    });

    it("is case-insensitive — 'january 2026' works", () => {
      const result = defaultResolveTemporalRange("january 2026");
      expect(result).toEqual({ date_from: "2026-01", date_to: "2026-01" });
    });
  });

  describe("YYYY-MM passthrough", () => {
    it("'2024-03' returns date_from and date_to both as 2024-03", () => {
      const result = defaultResolveTemporalRange("2024-03");
      expect(result).toEqual({ date_from: "2024-03", date_to: "2024-03" });
    });

    it("'2025-11' passes through correctly", () => {
      const result = defaultResolveTemporalRange("2025-11");
      expect(result).toEqual({ date_from: "2025-11", date_to: "2025-11" });
    });
  });

  describe("unknown expression", () => {
    it("falls back to last month for unrecognised strings", () => {
      const result = defaultResolveTemporalRange("sometime soon");
      const lm = monthsAgo(1);
      expect(result).toEqual({ date_from: lm, date_to: lm });
    });
  });

  describe("return shape", () => {
    it("always returns an object with date_from and date_to", () => {
      const result = defaultResolveTemporalRange("last month");
      expect(result).toHaveProperty("date_from");
      expect(result).toHaveProperty("date_to");
    });

    it("date_from and date_to are always YYYY-MM format", () => {
      const result = defaultResolveTemporalRange("last 3 months");
      expect(result.date_from).toMatch(/^\d{4}-\d{2}$/);
      expect(result.date_to).toMatch(/^\d{4}-\d{2}$/);
    });

    it("date_from is never later than date_to", () => {
      const result = defaultResolveTemporalRange("last 6 months");
      expect(result.date_from <= result.date_to).toBe(true);
    });
  });
});

// ── resolveTemporalRangeForCrime ──────────────────────────────────────────────

describe("resolveTemporalRangeForCrime", () => {
  describe("relative expressions — uses availability cache", () => {
    it("'unspecified' with cache available — uses latest month for both fields", async () => {
      mockGetLatestMonth.mockResolvedValue("2025-02");
      const result = await resolveTemporalRangeForCrime("unspecified");
      expect(result).toEqual({ date_from: "2025-02", date_to: "2025-02" });
    });

    it("'last month' with cache available — uses latest month for both fields", async () => {
      mockGetLatestMonth.mockResolvedValue("2025-02");
      const result = await resolveTemporalRangeForCrime("last month");
      expect(result).toEqual({ date_from: "2025-02", date_to: "2025-02" });
    });

    it("'last 3 months' with cache — date_to is latest month, date_from is 2 months before", async () => {
      mockGetLatestMonth.mockResolvedValue("2025-03");
      const result = await resolveTemporalRangeForCrime("last 3 months");
      expect(result).toEqual({ date_from: "2025-01", date_to: "2025-03" });
    });

    it("'last 6 months' with cache — date_from is 5 months before latest", async () => {
      mockGetLatestMonth.mockResolvedValue("2025-06");
      const result = await resolveTemporalRangeForCrime("last 6 months");
      expect(result).toEqual({ date_from: "2025-01", date_to: "2025-06" });
    });

    it("'last 12 months' with cache — date_from is 11 months before latest", async () => {
      mockGetLatestMonth.mockResolvedValue("2025-12");
      const result = await resolveTemporalRangeForCrime("last 12 months");
      expect(result).toEqual({ date_from: "2025-01", date_to: "2025-12" });
    });

    it("'last year' with cache — same as last 12 months", async () => {
      mockGetLatestMonth.mockResolvedValue("2025-03");
      const result = await resolveTemporalRangeForCrime("last year");
      expect(result).toEqual({ date_from: "2024-04", date_to: "2025-03" });
    });

    it("calls getLatestMonth with 'police-uk'", async () => {
      mockGetLatestMonth.mockResolvedValue("2025-02");
      await resolveTemporalRangeForCrime("last month");
      expect(mockGetLatestMonth).toHaveBeenCalledWith("police-uk");
    });
  });

  describe("cache miss — falls back to defaultResolveTemporalRange", () => {
    it("returns defaultResolveTemporalRange result when cache returns null", async () => {
      mockGetLatestMonth.mockResolvedValue(null);
      const result = await resolveTemporalRangeForCrime("last month");
      const fallback = defaultResolveTemporalRange("last month");
      expect(result).toEqual(fallback);
    });

    it("still returns a valid date range on cache miss", async () => {
      mockGetLatestMonth.mockResolvedValue(null);
      const result = await resolveTemporalRangeForCrime("unspecified");
      expect(result.date_from).toMatch(/^\d{4}-\d{2}$/);
      expect(result.date_to).toMatch(/^\d{4}-\d{2}$/);
    });
  });

  describe("absolute expressions — skips cache, resolves directly", () => {
    it("YYYY-MM passthrough does not call getLatestMonth", async () => {
      const result = await resolveTemporalRangeForCrime("2024-03");
      expect(mockGetLatestMonth).not.toHaveBeenCalled();
      expect(result).toEqual({ date_from: "2024-03", date_to: "2024-03" });
    });

    it("named month does not call getLatestMonth", async () => {
      const result = await resolveTemporalRangeForCrime("January 2026");
      expect(mockGetLatestMonth).not.toHaveBeenCalled();
      expect(result).toEqual({ date_from: "2026-01", date_to: "2026-01" });
    });
  });

  describe("cross-year boundary", () => {
    it("'last 3 months' spanning year boundary resolves correctly", async () => {
      mockGetLatestMonth.mockResolvedValue("2025-01");
      const result = await resolveTemporalRangeForCrime("last 3 months");
      expect(result).toEqual({ date_from: "2024-11", date_to: "2025-01" });
    });

    it("'last 12 months' from January goes back to previous February", async () => {
      mockGetLatestMonth.mockResolvedValue("2025-01");
      const result = await resolveTemporalRangeForCrime("last 12 months");
      expect(result).toEqual({ date_from: "2024-02", date_to: "2025-01" });
    });
  });
});
