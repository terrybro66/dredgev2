import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import type { Mocked } from "vitest";
import axios from "axios";

vi.mock("axios");
const mockedAxios = axios as Mocked<typeof axios>;

const POLICE_URL = "https://data.police.uk/api/crimes-street-dates";
const WEATHER_URL = "https://example.com/weather-dates";

const MOCK_MONTHS_UNSORTED = ["2025-08", "2025-10", "2025-09", "2025-07"];
const MOCK_MONTHS_SORTED = ["2025-10", "2025-09", "2025-08", "2025-07"];

const consoleSpy = {
  log: vi.spyOn(console, "log").mockImplementation(() => {}),
  error: vi.spyOn(console, "error").mockImplementation(() => {}),
};

beforeEach(async () => {
  vi.clearAllMocks();
  consoleSpy.log.mockImplementation(() => {});
  consoleSpy.error.mockImplementation(() => {});
  const { resetStore } = await import("../availability");
  await resetStore();
});
// ── loadAvailability ──────────────────────────────────────────────────────────

describe("loadAvailability", () => {
  it("after a successful load, getAvailableMonths returns the mocked month array", async () => {
    const { loadAvailability, getAvailableMonths } =
      await import("../availability");
    mockedAxios.get.mockResolvedValue({ data: MOCK_MONTHS_UNSORTED });

    await loadAvailability("police-uk", POLICE_URL, (d) => d as string[]);

    expect(getAvailableMonths("police-uk")).toEqual(MOCK_MONTHS_SORTED);
  });

  it("months are stored sorted most-recent-first", async () => {
    const { loadAvailability, getAvailableMonths } =
      await import("../availability");
    mockedAxios.get.mockResolvedValue({ data: MOCK_MONTHS_UNSORTED });

    await loadAvailability("police-uk", POLICE_URL, (d) => d as string[]);

    const months = getAvailableMonths("police-uk");
    expect(months[0]).toBe("2025-10");
    expect(months[months.length - 1]).toBe("2025-07");
  });

  it("calling loadAvailability a second time for the same source overwrites previous data", async () => {
    const { loadAvailability, getAvailableMonths } =
      await import("../availability");
    mockedAxios.get.mockResolvedValueOnce({ data: ["2025-01", "2025-02"] });
    await loadAvailability("police-uk", POLICE_URL, (d) => d as string[]);

    mockedAxios.get.mockResolvedValueOnce({ data: ["2024-11", "2024-12"] });
    await loadAvailability("police-uk", POLICE_URL, (d) => d as string[]);

    expect(getAvailableMonths("police-uk")).toEqual(["2024-12", "2024-11"]);
  });

  it("loading a different source does not affect the first source's data", async () => {
    const { loadAvailability, getAvailableMonths } =
      await import("../availability");
    mockedAxios.get.mockResolvedValueOnce({ data: ["2025-10", "2025-09"] });
    await loadAvailability("police-uk", POLICE_URL, (d) => d as string[]);

    mockedAxios.get.mockResolvedValueOnce({ data: ["2025-06"] });
    await loadAvailability("weather-uk", WEATHER_URL, (d) => d as string[]);

    expect(getAvailableMonths("police-uk")).toEqual(["2025-10", "2025-09"]);
    expect(getAvailableMonths("weather-uk")).toEqual(["2025-06"]);
  });

  it("when axios throws a network error, the function resolves without throwing", async () => {
    const { loadAvailability } = await import("../availability");
    mockedAxios.get.mockRejectedValue(new Error("Network Error"));

    await expect(
      loadAvailability("police-uk", POLICE_URL, (d) => d as string[]),
    ).resolves.toBeUndefined();
  });

  it("when axios returns an empty array, store is set to empty array without error", async () => {
    const { loadAvailability, getAvailableMonths } =
      await import("../availability");
    mockedAxios.get.mockResolvedValue({ data: [] });

    await loadAvailability("police-uk", POLICE_URL, (d) => d as string[]);

    expect(getAvailableMonths("police-uk")).toEqual([]);
  });

  it("logs structured JSON with event: availability_loaded on success", async () => {
    const { loadAvailability } = await import("../availability");
    mockedAxios.get.mockResolvedValue({ data: ["2025-10"] });

    await loadAvailability("police-uk", POLICE_URL, (d) => d as string[]);

    expect(consoleSpy.log).toHaveBeenCalledWith(
      expect.stringContaining('"event":"availability_loaded"'),
    );
    const logged = JSON.parse(consoleSpy.log.mock.calls[0][0] as string);
    expect(logged.event).toBe("availability_loaded");
    expect(logged.source).toBe("police-uk");
  });

  it("logs structured JSON with event: availability_failed on network failure", async () => {
    const { loadAvailability } = await import("../availability");
    mockedAxios.get.mockRejectedValue(new Error("ECONNREFUSED"));

    await loadAvailability("police-uk", POLICE_URL, (d) => d as string[]);

    expect(consoleSpy.error).toHaveBeenCalledWith(
      expect.stringContaining('"event":"availability_failed"'),
    );
    const logged = JSON.parse(consoleSpy.error.mock.calls[0][0] as string);
    expect(logged.event).toBe("availability_failed");
    expect(logged.source).toBe("police-uk");
  });
});

// ── getLatestMonth ────────────────────────────────────────────────────────────

describe("getLatestMonth", () => {
  it("returns the most recent month string after a successful load", async () => {
    const { loadAvailability, getLatestMonth } =
      await import("../availability");
    mockedAxios.get.mockResolvedValue({ data: MOCK_MONTHS_UNSORTED });

    await loadAvailability("police-uk", POLICE_URL, (d) => d as string[]);

    expect(await getLatestMonth("police-uk")).toBe("2025-10");
  });

  it("returns null when the source has never been loaded", async () => {
    const { getLatestMonth } = await import("../availability");
    expect(await getLatestMonth("never-loaded-source")).toBeNull();
  });

  it("returns null when the source was loaded but returned an empty array", async () => {
    const { loadAvailability, getLatestMonth } =
      await import("../availability");
    mockedAxios.get.mockResolvedValue({ data: [] });

    await loadAvailability("empty-source", POLICE_URL, (d) => d as string[]);

    expect(await getLatestMonth("empty-source")).toBeNull();
  });

  it("F3: reads from Redis when in-memory cache is cold and returns correct month", async () => {
    const { loadAvailability, getLatestMonth, clearInMemoryStore } =
      await import("../availability");
    mockedAxios.get.mockResolvedValue({ data: MOCK_MONTHS_UNSORTED });

    // Load into both in-memory and Redis
    await loadAvailability("police-uk", POLICE_URL, (d) => d as string[]);

    // Simulate server restart: clear only in-memory store, leave Redis intact
    clearInMemoryStore();

    // Should recover from Redis
    expect(await getLatestMonth("police-uk")).toBe("2025-10");
  });

  it("F3: returns null on full cold miss (neither in-memory nor Redis has data)", async () => {
    const { getLatestMonth } = await import("../availability");
    // resetStore in beforeEach cleared both — source was never loaded
    expect(await getLatestMonth("never-loaded-source")).toBeNull();
  });
});

// ── isMonthAvailable ──────────────────────────────────────────────────────────

describe("isMonthAvailable", () => {
  it("returns true when the month is in the loaded list", async () => {
    const { loadAvailability, isMonthAvailable } =
      await import("../availability");
    mockedAxios.get.mockResolvedValue({ data: ["2025-10", "2025-09"] });

    await loadAvailability("police-uk", POLICE_URL, (d) => d as string[]);

    expect(await isMonthAvailable("police-uk", "2025-09")).toBe(true);
  });

  it("returns false when the month is not in the loaded list", async () => {
    const { loadAvailability, isMonthAvailable } =
      await import("../availability");
    mockedAxios.get.mockResolvedValue({ data: ["2025-10", "2025-09"] });

    await loadAvailability("police-uk", POLICE_URL, (d) => d as string[]);

    expect(await isMonthAvailable("police-uk", "2025-01")).toBe(false);
  });

  it("returns true when the source has never been loaded (fail open)", async () => {
    const { isMonthAvailable } = await import("../availability");
    expect(await isMonthAvailable("unknown-source", "2025-10")).toBe(true);
  });

  it("returns true when the source was loaded with an empty list (fail open)", async () => {
    const { loadAvailability, isMonthAvailable } =
      await import("../availability");
    mockedAxios.get.mockResolvedValue({ data: [] });

    await loadAvailability("police-uk", POLICE_URL, (d) => d as string[]);

    expect(await isMonthAvailable("police-uk", "2025-10")).toBe(true);
  });

  it("month string format must match exactly — 2025-10 does not match 2025-9 or october-2025", async () => {
    const { loadAvailability, isMonthAvailable } =
      await import("../availability");
    mockedAxios.get.mockResolvedValue({ data: ["2025-10"] });

    await loadAvailability("police-uk", POLICE_URL, (d) => d as string[]);

    expect(await isMonthAvailable("police-uk", "2025-9")).toBe(false);
    expect(await isMonthAvailable("police-uk", "october-2025")).toBe(false);
    expect(await isMonthAvailable("police-uk", "2025-10")).toBe(true);
  });

  it("F3: reads from Redis when in-memory cache is cold", async () => {
    const { loadAvailability, isMonthAvailable, clearInMemoryStore } =
      await import("../availability");
    mockedAxios.get.mockResolvedValue({ data: ["2025-10", "2025-09"] });

    // Load into both in-memory and Redis
    await loadAvailability("police-uk", POLICE_URL, (d) => d as string[]);

    // Simulate server restart
    clearInMemoryStore();

    // Should recover from Redis — month is in list
    expect(await isMonthAvailable("police-uk", "2025-09")).toBe(true);
    // Month not in list should return false (not fail-open)
    expect(await isMonthAvailable("police-uk", "2020-01")).toBe(false);
  });
});

// ── getAvailableMonths ────────────────────────────────────────────────────────

describe("getAvailableMonths", () => {
  it("returns full sorted array after a successful load", async () => {
    const { loadAvailability, getAvailableMonths } =
      await import("../availability");
    mockedAxios.get.mockResolvedValue({ data: MOCK_MONTHS_UNSORTED });

    await loadAvailability("police-uk", POLICE_URL, (d) => d as string[]);

    expect(getAvailableMonths("police-uk")).toEqual(MOCK_MONTHS_SORTED);
  });

  it("returns [] when source has never been loaded", async () => {
    const { getAvailableMonths } = await import("../availability");
    expect(getAvailableMonths("completely-unknown")).toEqual([]);
  });
});

import { createAvailabilityCache } from "../availability";

describe("Redis-backed availability cache", () => {
  it("stores and retrieves a value", async () => {
    const cache = createAvailabilityCache();
    await cache.set("police-api", ["2024-01", "2024-02"]);
    const result = await cache.get("police-api");
    expect(result).toEqual(["2024-01", "2024-02"]);
  });

  it("returns null for an unknown key", async () => {
    const cache = createAvailabilityCache();
    const result = await cache.get("nonexistent-source");
    expect(result).toBeNull();
  });

  it("two instances share state via Redis", async () => {
    const cacheA = createAvailabilityCache();
    const cacheB = createAvailabilityCache();
    await cacheA.set("shared-source", ["2024-01"]);
    const result = await cacheB.get("shared-source");
    expect(result).toEqual(["2024-01"]);
  });

  it("falls back to in-memory when Redis is unavailable", async () => {
    const Redis = (await import("ioredis")).default;
    const badClient = new Redis("redis://localhost:19999", {
      maxRetriesPerRequest: 0,
      connectTimeout: 500,
      lazyConnect: true,
    });
    const cache = createAvailabilityCache(badClient);
    await cache.set("fallback-source", ["2024-01"]);
    const result = await cache.get("fallback-source");
    expect(result).toEqual(["2024-01"]);
    await badClient.quit();
  });

  afterAll(async () => {
    const client = (await import("../redis")).getRedisClient();
    await client.quit();
  });
});
