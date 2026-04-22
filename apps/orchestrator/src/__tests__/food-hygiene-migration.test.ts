import { describe, it, expect, vi, beforeEach } from "vitest";
import type { DomainConfigV2 } from "@dredge/schemas";

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock("../domains/food-hygiene-gb/fetcher", () => ({
  fetchFoodEstablishments: vi.fn(),
  fetchFoodEstablishmentsByCoord: vi.fn(),
}));

vi.mock("../db", () => ({
  prisma: {
    dataSource: { findMany: vi.fn().mockResolvedValue([]) },
  },
}));

import { fetchFoodEstablishments, fetchFoodEstablishmentsByCoord } from "../domains/food-hygiene-gb/fetcher";
import { foodHygieneGbAdapter } from "../domains/food-hygiene-gb/index";

const mockFetch = vi.mocked(fetchFoodEstablishments);
const mockFetchByCoord = vi.mocked(fetchFoodEstablishmentsByCoord);

// ── FoodEstablishment fixture (shape returned by fetcher after FSA transform) ─
// The fetcher transforms raw FSA API response into FoodEstablishment objects.
// flattenRow maps FoodEstablishment fields → canonical pipeline fields.

const rawRow = {
  name: "The Crown Pub",
  businessType: "Pub/bar/nightclub",
  address: "12 High Street, Birmingham",
  postCode: "B1 1AA",
  localAuthority: "Birmingham City Council",
  rating: "5",
  ratingDate: "2023-06-15",
  lat: 52.4862,
  lon: -1.8998,
};

// ── 1. Config shape ───────────────────────────────────────────────────────────

describe("food-hygiene-gb — config shape", () => {
  it("adapter config is a DomainConfigV2 shape (has identity section)", () => {
    const config = foodHygieneGbAdapter.config as unknown as DomainConfigV2;
    expect(config.identity.name).toBe("food-hygiene-gb");
    expect(config.identity.intents).toContain("food hygiene");
    expect(config.identity.countries).toContain("GB");
  });

  it("template type is listings", () => {
    const config = foodHygieneGbAdapter.config as unknown as DomainConfigV2;
    expect(config.template.type).toBe("listings");
  });

  it("has_coordinates capability is true", () => {
    const config = foodHygieneGbAdapter.config as unknown as DomainConfigV2;
    expect(config.template.capabilities.has_coordinates).toBe(true);
  });

  it("has_category capability is true", () => {
    const config = foodHygieneGbAdapter.config as unknown as DomainConfigV2;
    expect(config.template.capabilities.has_category).toBe(true);
  });

  it("storage points to query_results / queryResult", () => {
    const config = foodHygieneGbAdapter.config as unknown as DomainConfigV2;
    expect(config.storage.tableName).toBe("query_results");
    expect(config.storage.prismaModel).toBe("queryResult");
  });

  it("visualisation default is table", () => {
    const config = foodHygieneGbAdapter.config as unknown as DomainConfigV2;
    expect(config.visualisation.default).toBe("table");
  });

  it("source endpoint points to FSA ratings API", () => {
    const config = foodHygieneGbAdapter.config as unknown as DomainConfigV2;
    expect(config.source.endpoint).toContain("ratings.food.gov.uk");
  });

  it("exposes name via identity.name", () => {
    expect(foodHygieneGbAdapter.config.identity.name).toBe("food-hygiene-gb");
  });

  it("exposes default viz hint via visualisation.default", () => {
    expect(foodHygieneGbAdapter.config.visualisation.default).toBe("table");
  });
});

// ── 2. flattenRow — field mapping ─────────────────────────────────────────────

describe("food-hygiene-gb — flattenRow", () => {
  it("maps BusinessName to description", () => {
    const row = foodHygieneGbAdapter.flattenRow(rawRow);
    expect(row.description).toBe("The Crown Pub");
  });

  it("maps BusinessType to category", () => {
    const row = foodHygieneGbAdapter.flattenRow(rawRow);
    expect(row.category).toBe("Pub/bar/nightclub");
  });

  it("maps lat to lat as a number", () => {
    const row = foodHygieneGbAdapter.flattenRow(rawRow);
    expect(row.lat).toBe(52.4862);
    expect(typeof row.lat).toBe("number");
  });

  it("maps lon to lon as a number", () => {
    const row = foodHygieneGbAdapter.flattenRow(rawRow);
    expect(row.lon).toBe(-1.8998);
    expect(typeof row.lon).toBe("number");
  });

  it("maps address to location", () => {
    const row = foodHygieneGbAdapter.flattenRow(rawRow);
    expect(typeof row.location).toBe("string");
    expect((row.location as string).length).toBeGreaterThan(0);
  });

  it("maps rating to value field", () => {
    const row = foodHygieneGbAdapter.flattenRow(rawRow);
    expect(row.value).toBe("5");
  });

  it("retains postCode in extras", () => {
    const row = foodHygieneGbAdapter.flattenRow(rawRow);
    const extras = row.extras as Record<string, unknown>;
    expect(extras?.postCode ?? extras?.PostCode).toBeTruthy();
  });

  it("returns null for lat/lon when coordinates are missing", () => {
    const rowNoGeo = { ...rawRow, lat: null, lon: null };
    const row = foodHygieneGbAdapter.flattenRow(rowNoGeo);
    expect(row.lat).toBeNull();
    expect(row.lon).toBeNull();
  });
});

// ── 3. fetchData ──────────────────────────────────────────────────────────────

describe("food-hygiene-gb — fetchData", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockResolvedValue([]);
    mockFetchByCoord.mockResolvedValue([]);
  });

  it("falls back to fetchFoodEstablishments by name when poly is empty", async () => {
    await foodHygieneGbAdapter.fetchData(
      { location: "Birmingham, West Midlands" },
      "",
    );
    expect(mockFetch).toHaveBeenCalledWith("Birmingham");
    expect(mockFetchByCoord).not.toHaveBeenCalled();
  });

  it("strips county/country suffix from location before calling fetcher", async () => {
    await foodHygieneGbAdapter.fetchData(
      { location: "Leeds, West Yorkshire, England" },
      "",
    );
    expect(mockFetch).toHaveBeenCalledWith("Leeds");
  });

  it("uses fetchFoodEstablishmentsByCoord when a valid poly centroid is available", async () => {
    // poly centroid "lat,lon" format
    await foodHygieneGbAdapter.fetchData(
      { location: "Manchester" },
      "53.4808,-2.2426",
    );
    expect(mockFetchByCoord).toHaveBeenCalledWith(53.4808, -2.2426);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("returns canonical rows (flattenRow applied)", async () => {
    mockFetch.mockResolvedValue([rawRow]);
    const rows = (await foodHygieneGbAdapter.fetchData(
      { location: "Birmingham" },
      "",
    )) as Record<string, unknown>[];
    expect(rows[0].description).toBe("The Crown Pub");
    expect(rows[0].lat).toBe(52.4862);
  });

  it("returns empty array when fetcher returns nothing", async () => {
    const rows = await foodHygieneGbAdapter.fetchData({ location: "Nowhere" }, "");
    expect(rows).toEqual([]);
  });
});

// ── 4. storeResults ───────────────────────────────────────────────────────────

describe("food-hygiene-gb — storeResults", () => {
  it("writes to queryResult (query_results table), not a domain-specific table", async () => {
    const prismaMock = {
      queryResult: { createMany: vi.fn().mockResolvedValue({ count: 1 }) },
    };
    const rows = [foodHygieneGbAdapter.flattenRow(rawRow)];
    await foodHygieneGbAdapter.storeResults("query-abc", rows, prismaMock);
    expect(prismaMock.queryResult.createMany).toHaveBeenCalledOnce();
  });

  it("stores domain_name as food-hygiene-gb", async () => {
    const prismaMock = {
      queryResult: { createMany: vi.fn().mockResolvedValue({ count: 1 }) },
    };
    const rows = [foodHygieneGbAdapter.flattenRow(rawRow)];
    await foodHygieneGbAdapter.storeResults("query-abc", rows, prismaMock);
    const { data } = prismaMock.queryResult.createMany.mock.calls[0][0];
    expect(data[0].domain_name).toBe("food-hygiene-gb");
  });

  it("stores lat and lon as numbers", async () => {
    const prismaMock = {
      queryResult: { createMany: vi.fn().mockResolvedValue({ count: 1 }) },
    };
    const rows = [foodHygieneGbAdapter.flattenRow(rawRow)];
    await foodHygieneGbAdapter.storeResults("query-abc", rows, prismaMock);
    const { data } = prismaMock.queryResult.createMany.mock.calls[0][0];
    expect(typeof data[0].lat).toBe("number");
    expect(typeof data[0].lon).toBe("number");
  });

  it("skips createMany when rows is empty", async () => {
    const prismaMock = {
      queryResult: { createMany: vi.fn() },
    };
    await foodHygieneGbAdapter.storeResults("query-abc", [], prismaMock);
    expect(prismaMock.queryResult.createMany).not.toHaveBeenCalled();
  });
});

// ── 5. Parity — canonical fields match old flattenRow output ─────────────────

describe("food-hygiene-gb — parity with old adapter", () => {
  it("canonical row has all fields the old adapter produced", () => {
    const row = foodHygieneGbAdapter.flattenRow(rawRow);
    // Old adapter produced: description, category, location, lat, lon, extras
    expect(row).toHaveProperty("description");
    expect(row).toHaveProperty("category");
    expect(row).toHaveProperty("location");
    expect(row).toHaveProperty("lat");
    expect(row).toHaveProperty("lon");
    expect(row).toHaveProperty("extras");
  });

  it("rating is mapped to the value field (not buried in extras)", () => {
    const row = foodHygieneGbAdapter.flattenRow(rawRow);
    // rating is now a first-class mapped field — accessible directly as value
    expect(row.value).toBe("5");
  });
});
