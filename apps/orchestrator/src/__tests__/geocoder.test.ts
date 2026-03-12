import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Mocked } from "vitest";
import axios from "axios";
import { prisma } from "../db";

vi.mock("axios");
const mockedAxios = axios as Mocked<typeof axios>;

const mockHit = {
  display_name: "Cambridge, Cambridgeshire, England",
  boundingbox: ["52.1", "52.3", "0.0", "0.3"],
  lat: "52.2",
  lon: "0.1",
};

function mockNominatimResponse(hits: unknown[] = [mockHit]) {
  (axios.get as ReturnType<typeof vi.fn>).mockResolvedValue({ data: hits });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("geocodeToPolygon", () => {
  it("calls Nominatim with correct q parameter", async () => {
    mockNominatimResponse();
    const { geocodeToPolygon } = await import("../geocoder");
    await geocodeToPolygon("Cambridge, UK", prisma);
    expect(axios.get).toHaveBeenCalledWith(
      expect.stringContaining("nominatim"),
      expect.objectContaining({
        params: expect.objectContaining({ q: "Cambridge, UK" }),
      }),
    );
  });

  it("calls Nominatim with format: json and limit: 1", async () => {
    mockNominatimResponse();
    const { geocodeToPolygon } = await import("../geocoder");
    await geocodeToPolygon("Cambridge, UK", prisma);
    expect(axios.get).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        params: expect.objectContaining({ format: "json", limit: 1 }),
      }),
    );
  });

  it("sets User-Agent: dredge/1.0 header", async () => {
    mockNominatimResponse();
    const { geocodeToPolygon } = await import("../geocoder");
    await geocodeToPolygon("Cambridge, UK", prisma);
    expect(axios.get).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({ "User-Agent": "dredge/1.0" }),
      }),
    );
  });

  it("returns { poly, display_name } object", async () => {
    mockNominatimResponse();
    const { geocodeToPolygon } = await import("../geocoder");
    const result = await geocodeToPolygon("Cambridge, UK", prisma);
    expect(result).toHaveProperty("poly");
    expect(result).toHaveProperty(
      "display_name",
      "Cambridge, Cambridgeshire, England",
    );
  });

  it("returned poly has exactly 4 points for a bounding box", async () => {
    mockNominatimResponse();
    const { geocodeToPolygon } = await import("../geocoder");
    const { poly } = await geocodeToPolygon("Cambridge, UK", prisma);
    expect(poly.split(":")).toHaveLength(4);
  });

  it("all coordinate values in poly are numeric", async () => {
    mockNominatimResponse();
    const { geocodeToPolygon } = await import("../geocoder");
    const { poly } = await geocodeToPolygon("Cambridge, UK", prisma);
    const values = poly.split(":").flatMap((point) => point.split(","));
    values.forEach((v) => expect(Number(v)).not.toBeNaN());
  });

  it("north/south and east/west values are in correct positions", async () => {
    mockNominatimResponse();
    const { geocodeToPolygon } = await import("../geocoder");
    const { poly } = await geocodeToPolygon("Cambridge, UK", prisma);
    // poly: north,west : north,east : south,east : south,west
    const [[n1, w], [n2, e], [s1, e2], [s2, w2]] = poly
      .split(":")
      .map((p) => p.split(",").map(Number));
    expect(n1).toBe(n2); // north consistent
    expect(s1).toBe(s2); // south consistent
    expect(e).toBe(e2); // east consistent
    expect(w).toBe(w2); // west consistent
    expect(n1).toBeGreaterThan(s1); // north > south
    expect(e).toBeGreaterThan(w); // east > west
  });

  it("throws structured IntentError when result array is empty", async () => {
    mockNominatimResponse([]);
    const { geocodeToPolygon } = await import("../geocoder");
    await expect(
      geocodeToPolygon("nowhere real", prisma),
    ).rejects.toMatchObject({
      error: "geocode_failed",
      missing: expect.arrayContaining(["coordinates"]),
    });
  });
});

describe("geocodeToCoordinates", () => {
  it("returns valid { lat, lon, display_name } object", async () => {
    mockNominatimResponse();
    const { geocodeToCoordinates } = await import("../geocoder");
    const result = await geocodeToCoordinates("Cambridge, UK");
    expect(result).toMatchObject({
      lat: expect.any(Number),
      lon: expect.any(Number),
      display_name: expect.any(String),
    });
  });

  it("lat and lon are numbers, not strings", async () => {
    mockNominatimResponse();
    const { geocodeToCoordinates } = await import("../geocoder");
    const { lat, lon } = await geocodeToCoordinates("Cambridge, UK");
    expect(typeof lat).toBe("number");
    expect(typeof lon).toBe("number");
  });

  it("throws structured IntentError when result array is empty", async () => {
    mockNominatimResponse([]);
    const { geocodeToCoordinates } = await import("../geocoder");
    await expect(geocodeToCoordinates("nowhere real")).rejects.toMatchObject({
      error: "geocode_failed",
      missing: expect.arrayContaining(["coordinates"]),
    });
  });
});
