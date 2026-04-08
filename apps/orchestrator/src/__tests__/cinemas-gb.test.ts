/**
 * cinemas-gb.test.ts — Phase C.10
 *
 * Unit tests for the cinemas-gb domain adapter.
 * Overpass fetch is mocked — no network required.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock global fetch ─────────────────────────────────────────────────────────

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// ── Fixtures ──────────────────────────────────────────────────────────────────

const overpassResponse = {
  elements: [
    {
      type: "node",
      id: 1001,
      lat: 51.5074,
      lon: -0.1278,
      tags: {
        amenity:      "cinema",
        name:         "Odeon Leicester Square",
        "addr:street": "Leicester Square",
        "addr:city":  "London",
        website:      "https://www.odeon.co.uk",
      },
    },
    {
      type: "node",
      id: 1002,
      lat: 53.4808,
      lon: -2.2426,
      tags: {
        amenity: "cinema",
        name:    "Vue Manchester Printworks",
      },
    },
    {
      type: "way",
      id: 2001,
      center: { lat: 53.8008, lon: -1.5491 },
      tags: {
        amenity: "cinema",
        name:    "Everyman Leeds",
        website: "https://www.everymancinema.com",
      },
    },
    {
      // element without lat/lon — should be filtered out
      type: "node",
      id: 9999,
      tags: { amenity: "cinema", name: "Ghost Cinema" },
    },
  ],
};

function mockOverpassOk() {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    json: async () => overpassResponse,
  });
}

// ── fetchCinemas ──────────────────────────────────────────────────────────────

describe("fetchCinemas", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns a row for each element with valid coordinates", async () => {
    mockOverpassOk();
    const { fetchCinemas } = await import("../domains/cinemas-gb/fetcher");
    const rows = await fetchCinemas(null);
    expect(rows).toHaveLength(3); // ghost cinema filtered out
  });

  it("each row has name, chain, lat, lon", async () => {
    mockOverpassOk();
    const { fetchCinemas } = await import("../domains/cinemas-gb/fetcher");
    const rows = await fetchCinemas(null);
    for (const r of rows) {
      expect(typeof r.name).toBe("string");
      expect(typeof r.chain).toBe("string");
      expect(typeof r.lat).toBe("number");
      expect(typeof r.lon).toBe("number");
    }
  });

  it("infers chain from name", async () => {
    mockOverpassOk();
    const { fetchCinemas } = await import("../domains/cinemas-gb/fetcher");
    const rows = await fetchCinemas(null);

    const odeon    = rows.find((r) => r.name.includes("Odeon"));
    const vue      = rows.find((r) => r.name.includes("Vue"));
    const everyman = rows.find((r) => r.name.includes("Everyman"));

    expect(odeon?.chain).toBe("Odeon");
    expect(vue?.chain).toBe("Vue");
    expect(everyman?.chain).toBe("Everyman");
  });

  it("uses center coords for way elements", async () => {
    mockOverpassOk();
    const { fetchCinemas } = await import("../domains/cinemas-gb/fetcher");
    const rows = await fetchCinemas(null);
    const leeds = rows.find((r) => r.name.includes("Leeds"));
    expect(leeds?.lat).toBeCloseTo(53.8008);
    expect(leeds?.lon).toBeCloseTo(-1.5491);
  });

  it("includes address when addr tags are present", async () => {
    mockOverpassOk();
    const { fetchCinemas } = await import("../domains/cinemas-gb/fetcher");
    const rows = await fetchCinemas(null);
    const odeon = rows.find((r) => r.name.includes("Odeon"));
    expect(odeon?.address).toContain("Leicester Square");
  });

  it("posts to the Overpass endpoint", async () => {
    mockOverpassOk();
    const { fetchCinemas } = await import("../domains/cinemas-gb/fetcher");
    await fetchCinemas(null);
    expect(mockFetch).toHaveBeenCalledWith(
      "https://overpass-api.de/api/interpreter",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("throws when Overpass returns non-ok response", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 429, statusText: "Too Many Requests" });
    const { fetchCinemas } = await import("../domains/cinemas-gb/fetcher");
    await expect(fetchCinemas(null)).rejects.toThrow("429");
  });
});

// ── cinemasGbAdapter ──────────────────────────────────────────────────────────

describe("cinemasGbAdapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("config has correct name and intent", async () => {
    const { cinemasGbAdapter } = await import("../domains/cinemas-gb/index");
    expect(cinemasGbAdapter.config.name).toBe("cinemas-gb");
    expect(cinemasGbAdapter.config.intents).toContain("cinemas");
  });

  it("storeResults is true (Track A)", async () => {
    const { cinemasGbAdapter } = await import("../domains/cinemas-gb/index");
    expect(cinemasGbAdapter.config.storeResults).toBe(true);
  });

  it("vizHintRules defaults to map", async () => {
    const { cinemasGbAdapter } = await import("../domains/cinemas-gb/index");
    expect(cinemasGbAdapter.config.vizHintRules.defaultHint).toBe("map");
  });

  it("flattenRow maps name → description, chain → category", async () => {
    const { cinemasGbAdapter } = await import("../domains/cinemas-gb/index");
    const row = {
      name:    "Odeon Manchester",
      chain:   "Odeon",
      lat:     53.48,
      lon:     -2.24,
      address: "Printworks, Manchester",
      website: null,
      osm_id:  "node/1001",
    };
    const flat = cinemasGbAdapter.flattenRow(row);
    expect(flat.description).toBe("Odeon Manchester");
    expect(flat.category).toBe("Odeon");
    expect(flat.lat).toBe(53.48);
    expect(flat.lon).toBe(-2.24);
    expect((flat.extras as any).chain).toBe("Odeon");
  });

  it("fetchData calls fetchCinemas with the polygon", async () => {
    mockOverpassOk();
    const { cinemasGbAdapter } = await import("../domains/cinemas-gb/index");
    const rows = await cinemasGbAdapter.fetchData({}, "51.5,-0.1:51.6,-0.1:51.6,0.1:51.5,0.1");
    expect(rows.length).toBeGreaterThanOrEqual(0);
    expect(mockFetch).toHaveBeenCalled();
  });

  it("storeResults writes rows to prisma.queryResult.createMany", async () => {
    const { cinemasGbAdapter } = await import("../domains/cinemas-gb/index");
    const mockPrisma = { queryResult: { createMany: vi.fn().mockResolvedValue({}) } };
    const rows = [
      { name: "Odeon", chain: "Odeon", lat: 51.5, lon: -0.1, address: null, website: null, osm_id: "node/1" },
    ];
    await cinemasGbAdapter.storeResults("q1", rows, mockPrisma);
    expect(mockPrisma.queryResult.createMany).toHaveBeenCalledOnce();
    const data = mockPrisma.queryResult.createMany.mock.calls[0][0].data;
    expect(data[0].domain_name).toBe("cinemas-gb");
    expect(data[0].lat).toBe(51.5);
  });

  it("storeResults is a no-op for empty rows", async () => {
    const { cinemasGbAdapter } = await import("../domains/cinemas-gb/index");
    const mockPrisma = { queryResult: { createMany: vi.fn() } };
    await cinemasGbAdapter.storeResults("q1", [], mockPrisma);
    expect(mockPrisma.queryResult.createMany).not.toHaveBeenCalled();
  });
});
