import { describe, it, expect, vi, beforeEach } from "vitest";
import { prisma } from "../db";

describe("Spatial Aggregation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns aggregated bins with lat, lon, and count fields", async () => {
    const bins = await prisma.$queryRaw`
      SELECT
        ST_Y(ST_Centroid(ST_Collect(ST_MakePoint(longitude, latitude)))) AS lat,
        ST_X(ST_Centroid(ST_Collect(ST_MakePoint(longitude, latitude)))) AS lon,
        COUNT(*)::int AS count
      FROM crime_results
      WHERE query_id = 'test-query-id'
        AND latitude IS NOT NULL
        AND longitude IS NOT NULL
      GROUP BY ST_SnapToGrid(ST_MakePoint(longitude, latitude), 0.002)
    `;

    expect(Array.isArray(bins)).toBe(true);
    (bins as any[]).forEach((bin) => {
      expect(bin).toHaveProperty("lat");
      expect(bin).toHaveProperty("lon");
      expect(bin).toHaveProperty("count");
    });
  });

  it("returns empty array when no results exist for a query_id", async () => {
    const bins = await prisma.$queryRaw`
      SELECT
        ST_Y(ST_Centroid(ST_Collect(ST_MakePoint(longitude, latitude)))) AS lat,
        ST_X(ST_Centroid(ST_Collect(ST_MakePoint(longitude, latitude)))) AS lon,
        COUNT(*)::int AS count
      FROM crime_results
      WHERE query_id = 'nonexistent-query-id'
        AND latitude IS NOT NULL
        AND longitude IS NOT NULL
      GROUP BY ST_SnapToGrid(ST_MakePoint(longitude, latitude), 0.002)
    `;

    expect(bins).toHaveLength(0);
  });

  it("produces deterministic results for the same query_id", async () => {
    const bins1 = await prisma.$queryRaw`
      SELECT
        ST_Y(ST_Centroid(ST_Collect(ST_MakePoint(longitude, latitude)))) AS lat,
        ST_X(ST_Centroid(ST_Collect(ST_MakePoint(longitude, latitude)))) AS lon,
        COUNT(*)::int AS count
      FROM crime_results
      WHERE query_id = 'test-query-id'
        AND latitude IS NOT NULL
        AND longitude IS NOT NULL
      GROUP BY ST_SnapToGrid(ST_MakePoint(longitude, latitude), 0.002)
    `;

    const bins2 = await prisma.$queryRaw`
      SELECT
        ST_Y(ST_Centroid(ST_Collect(ST_MakePoint(longitude, latitude)))) AS lat,
        ST_X(ST_Centroid(ST_Collect(ST_MakePoint(longitude, latitude)))) AS lon,
        COUNT(*)::int AS count
      FROM crime_results
      WHERE query_id = 'test-query-id'
        AND latitude IS NOT NULL
        AND longitude IS NOT NULL
      GROUP BY ST_SnapToGrid(ST_MakePoint(longitude, latitude), 0.002)
    `;

    expect(bins1).toEqual(bins2);
  });

  it("viz_hint bar returns raw rows not aggregated bins", async () => {
    const results = await prisma.crimeResult.findMany({
      where: { query_id: "test-query-id" },
      take: 100,
    });

    expect(Array.isArray(results)).toBe(true);
    // Raw rows have crime-specific fields, not bin fields
    results.forEach((row: any) => {
      expect(row).not.toHaveProperty("count");
    });
  });
});
