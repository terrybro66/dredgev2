import { describe, it, expect, vi, beforeEach } from "vitest";
import { setUserLocation, getUserLocation, SessionLocation } from "../session";

vi.mock("../redis", () => ({
  getRedisClient: vi.fn(),
}));

const mockGet = vi.fn();
const mockSet = vi.fn();

import { getRedisClient } from "../redis";

beforeEach(() => {
  vi.clearAllMocks();
  (getRedisClient as ReturnType<typeof vi.fn>).mockReturnValue({
    get: mockGet,
    set: mockSet,
  });
});

const loc: SessionLocation = {
  lat: 51.5,
  lon: -0.12,
  display_name: "London, UK",
  country_code: "gb",
};

describe("getUserLocation()", () => {
  it("returns parsed location when Redis has a value", async () => {
    mockGet.mockResolvedValue(JSON.stringify(loc));
    const result = await getUserLocation("sess-1");
    expect(result).toEqual(loc);
    expect(mockGet).toHaveBeenCalledWith("session:location:sess-1");
  });

  it("returns null when Redis has no value", async () => {
    mockGet.mockResolvedValue(null);
    const result = await getUserLocation("sess-1");
    expect(result).toBeNull();
  });

  it("returns null when Redis throws", async () => {
    mockGet.mockRejectedValue(new Error("connection refused"));
    const result = await getUserLocation("sess-1");
    expect(result).toBeNull();
  });
});

describe("setUserLocation()", () => {
  it("writes JSON to the correct key with 24h TTL", async () => {
    mockSet.mockResolvedValue("OK");
    await setUserLocation("sess-1", loc);
    expect(mockSet).toHaveBeenCalledWith(
      "session:location:sess-1",
      JSON.stringify(loc),
      "EX",
      86400,
    );
  });

  it("does not throw when Redis throws", async () => {
    mockSet.mockRejectedValue(new Error("connection refused"));
    await expect(setUserLocation("sess-1", loc)).resolves.not.toThrow();
  });
});
