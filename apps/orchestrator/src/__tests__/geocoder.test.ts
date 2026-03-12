import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Mocked } from "vitest";
import axios from "axios";

vi.mock("axios");
const mockedAxios = axios as Mocked<typeof axios>;

// ── prisma mock ───────────────────────────────────────────────────────────────
// We mock prisma entirely so tests never touch a real database.
// Each test can override individual methods via mockResolvedValueOnce.

const mockPrisma = {
  geocoderCache: {
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
  $queryRaw: vi.fn(),
};

// ── Nominatim helpers ─────────────────────────────────────────────────────────

const mockHit = {
  display_name: "Cambridge, Cambridgeshire, England",
  boundingbox: ["52.1", "52.3", "0.0", "0.3"],
  lat: "52.205337",
  lon: "0.121817",
  country_code: "gb",
};

function mockNominatimResponse(hits: unknown[] = [mockHit]) {
  mockedAxios.get.mockResolvedValue({ data: hits });
}

// A valid 16-point poly string returned by the PostGIS mock
const MOCK_POLY = Array.from(
  { length: 16 },
  (_, i) =>
    `52.${i.toString().padStart(6, "0")},0.${i.toString().padStart(6, "0")}`,
).join(":");

function mockPostGIS() {
  mockPrisma.$queryRaw.mockResolvedValue([{ poly: MOCK_POLY }]);
}

beforeEach(() => {
  vi.clearAllMocks();
  // default: no cache hit
  mockPrisma.geocoderCache.findUnique.mockResolvedValue(null);
  mockPrisma.geocoderCache.create.mockResolvedValue({});
  mockPrisma.geocoderCache.update.mockResolvedValue({});
  mockPostGIS();
});

// ── geocodeToPolygon ──────────────────────────────────────────────────────────

describe("geocodeToPolygon", () => {
  it("calls Nominatim with correct params and User-Agent on cache miss", async () => {
    mockNominatimResponse();
    const { geocodeToPolygon } = await import("../geocoder");
    await geocodeToPolygon("Cambridge, UK", mockPrisma);

    expect(mockedAxios.get).toHaveBeenCalledWith(
      expect.stringContaining("nominatim"),
      expect.objectContaining({
        params: expect.objectContaining({
          q: "Cambridge, UK",
          format: "json",
          limit: 1,
        }),
        headers: expect.objectContaining({ "User-Agent": "dredge/1.0" }),
      }),
    );
  });

  it("calls PostGIS ST_Project query on cache miss", async () => {
    mockNominatimResponse();
    const { geocodeToPolygon } = await import("../geocoder");
    await geocodeToPolygon("Cambridge, UK", mockPrisma);

    expect(mockPrisma.$queryRaw).toHaveBeenCalled();
  });

  it("returns { poly, display_name, country_code }", async () => {
    mockNominatimResponse();
    const { geocodeToPolygon } = await import("../geocoder");
    const result = await geocodeToPolygon("Cambridge, UK", mockPrisma);

    expect(result).toHaveProperty("poly");
    expect(result).toHaveProperty(
      "display_name",
      "Cambridge, Cambridgeshire, England",
    );
    expect(result).toHaveProperty("country_code", "GB");
  });

  it("country_code is uppercased", async () => {
    mockNominatimResponse([{ ...mockHit, country_code: "gb" }]);
    const { geocodeToPolygon } = await import("../geocoder");
    const { country_code } = await geocodeToPolygon(
      "Cambridge, UK",
      mockPrisma,
    );

    expect(country_code).toBe("GB");
  });

  it("returned poly has 16 points", async () => {
    mockNominatimResponse();
    const { geocodeToPolygon } = await import("../geocoder");
    const { poly } = await geocodeToPolygon("Cambridge, UK", mockPrisma);

    expect(poly.split(":")).toHaveLength(16);
  });

  it("writes a new cache row on cold miss", async () => {
    mockNominatimResponse();
    const { geocodeToPolygon } = await import("../geocoder");
    await geocodeToPolygon("Cambridge, UK", mockPrisma);

    expect(mockPrisma.geocoderCache.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          place_name: "cambridge, uk",
          country_code: "GB",
          poly: MOCK_POLY,
        }),
      }),
    );
  });

  it("normalises place_name to lowercase before cache write", async () => {
    mockNominatimResponse();
    const { geocodeToPolygon } = await import("../geocoder");
    await geocodeToPolygon("CAMBRIDGE, UK", mockPrisma);

    expect(mockPrisma.geocoderCache.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ place_name: "cambridge, uk" }),
      }),
    );
  });

  it("skips Nominatim on full cache hit (poly present)", async () => {
    mockPrisma.geocoderCache.findUnique.mockResolvedValue({
      place_name: "cambridge, uk",
      display_name: "Cambridge, Cambridgeshire, England",
      lat: 52.205337,
      lon: 0.121817,
      country_code: "GB",
      poly: MOCK_POLY,
    });

    const { geocodeToPolygon } = await import("../geocoder");
    await geocodeToPolygon("Cambridge, UK", mockPrisma);

    expect(mockedAxios.get).not.toHaveBeenCalled();
  });

  it("skips PostGIS on full cache hit (poly present)", async () => {
    mockPrisma.geocoderCache.findUnique.mockResolvedValue({
      place_name: "cambridge, uk",
      display_name: "Cambridge, Cambridgeshire, England",
      lat: 52.205337,
      lon: 0.121817,
      country_code: "GB",
      poly: MOCK_POLY,
    });

    const { geocodeToPolygon } = await import("../geocoder");
    await geocodeToPolygon("Cambridge, UK", mockPrisma);

    expect(mockPrisma.$queryRaw).not.toHaveBeenCalled();
  });

  it("returns cached poly on full cache hit", async () => {
    mockPrisma.geocoderCache.findUnique.mockResolvedValue({
      place_name: "cambridge, uk",
      display_name: "Cambridge, Cambridgeshire, England",
      lat: 52.205337,
      lon: 0.121817,
      country_code: "GB",
      poly: MOCK_POLY,
    });

    const { geocodeToPolygon } = await import("../geocoder");
    const result = await geocodeToPolygon("Cambridge, UK", mockPrisma);

    expect(result.poly).toBe(MOCK_POLY);
  });

  it("skips Nominatim on partial cache hit (centroid cached, no poly)", async () => {
    mockPrisma.geocoderCache.findUnique.mockResolvedValue({
      place_name: "cambridge, uk",
      display_name: "Cambridge, Cambridgeshire, England",
      lat: 52.205337,
      lon: 0.121817,
      country_code: "GB",
      poly: null,
    });

    const { geocodeToPolygon } = await import("../geocoder");
    await geocodeToPolygon("Cambridge, UK", mockPrisma);

    expect(mockedAxios.get).not.toHaveBeenCalled();
  });

  it("still calls PostGIS on partial cache hit (poly is null)", async () => {
    mockPrisma.geocoderCache.findUnique.mockResolvedValue({
      place_name: "cambridge, uk",
      display_name: "Cambridge, Cambridgeshire, England",
      lat: 52.205337,
      lon: 0.121817,
      country_code: "GB",
      poly: null,
    });

    const { geocodeToPolygon } = await import("../geocoder");
    await geocodeToPolygon("Cambridge, UK", mockPrisma);

    expect(mockPrisma.$queryRaw).toHaveBeenCalled();
  });

  it("updates existing cache row with poly on partial hit", async () => {
    mockPrisma.geocoderCache.findUnique.mockResolvedValue({
      place_name: "cambridge, uk",
      display_name: "Cambridge, Cambridgeshire, England",
      lat: 52.205337,
      lon: 0.121817,
      country_code: "GB",
      poly: null,
    });

    const { geocodeToPolygon } = await import("../geocoder");
    await geocodeToPolygon("Cambridge, UK", mockPrisma);

    expect(mockPrisma.geocoderCache.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { place_name: "cambridge, uk" },
        data: { poly: MOCK_POLY },
      }),
    );
  });

  it("throws structured IntentError when Nominatim returns empty array", async () => {
    mockNominatimResponse([]);
    const { geocodeToPolygon } = await import("../geocoder");

    await expect(
      geocodeToPolygon("nowhere real", mockPrisma),
    ).rejects.toMatchObject({
      error: "geocode_failed",
      missing: expect.arrayContaining(["coordinates"]),
    });
  });
});

// ── geocodeToCoordinates ──────────────────────────────────────────────────────

describe("geocodeToCoordinates", () => {
  it("returns { lat, lon, display_name, country_code }", async () => {
    mockNominatimResponse();
    const { geocodeToCoordinates } = await import("../geocoder");
    const result = await geocodeToCoordinates("Cambridge, UK", mockPrisma);

    expect(result).toMatchObject({
      lat: expect.any(Number),
      lon: expect.any(Number),
      display_name: expect.any(String),
      country_code: "GB",
    });
  });

  it("lat and lon are numbers, not strings", async () => {
    mockNominatimResponse();
    const { geocodeToCoordinates } = await import("../geocoder");
    const { lat, lon } = await geocodeToCoordinates(
      "Cambridge, UK",
      mockPrisma,
    );

    expect(typeof lat).toBe("number");
    expect(typeof lon).toBe("number");
  });

  it("country_code is uppercased", async () => {
    mockNominatimResponse([{ ...mockHit, country_code: "gb" }]);
    const { geocodeToCoordinates } = await import("../geocoder");
    const { country_code } = await geocodeToCoordinates(
      "Cambridge, UK",
      mockPrisma,
    );

    expect(country_code).toBe("GB");
  });

  it("skips Nominatim on cache hit", async () => {
    mockPrisma.geocoderCache.findUnique.mockResolvedValue({
      place_name: "cambridge, uk",
      display_name: "Cambridge, Cambridgeshire, England",
      lat: 52.205337,
      lon: 0.121817,
      country_code: "GB",
      poly: null,
    });

    const { geocodeToCoordinates } = await import("../geocoder");
    await geocodeToCoordinates("Cambridge, UK", mockPrisma);

    expect(mockedAxios.get).not.toHaveBeenCalled();
  });

  it("returns cached values on cache hit", async () => {
    mockPrisma.geocoderCache.findUnique.mockResolvedValue({
      place_name: "cambridge, uk",
      display_name: "Cambridge, Cambridgeshire, England",
      lat: 52.205337,
      lon: 0.121817,
      country_code: "GB",
      poly: null,
    });

    const { geocodeToCoordinates } = await import("../geocoder");
    const result = await geocodeToCoordinates("Cambridge, UK", mockPrisma);

    expect(result.lat).toBe(52.205337);
    expect(result.display_name).toBe("Cambridge, Cambridgeshire, England");
  });

  it("writes cache row with poly: null on cold miss", async () => {
    mockNominatimResponse();
    const { geocodeToCoordinates } = await import("../geocoder");
    await geocodeToCoordinates("Cambridge, UK", mockPrisma);

    expect(mockPrisma.geocoderCache.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          place_name: "cambridge, uk",
          poly: null,
        }),
      }),
    );
  });

  it("throws structured IntentError when Nominatim returns empty array", async () => {
    mockNominatimResponse([]);
    const { geocodeToCoordinates } = await import("../geocoder");

    await expect(
      geocodeToCoordinates("nowhere real", mockPrisma),
    ).rejects.toMatchObject({
      error: "geocode_failed",
      missing: expect.arrayContaining(["coordinates"]),
    });
  });
});
