import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";
import express from "express";
import request from "supertest";
import type { Router } from "express";

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    crimeResult: {
      findMany: vi.fn(),
    },
  },
}));

vi.mock("../db", () => ({ prisma: mockPrisma }));

let exportRouter: Router;
beforeAll(async () => {
  ({ exportRouter } = await import("../export"));
});

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/query", exportRouter);
  return app;
}

const sampleRows = [
  {
    id: "r1",
    query_id: "q1",
    category: "burglary",
    month: "2024-01",
    latitude: 52.2,
    longitude: 0.1,
    street: "High Street",
    outcome_category: null,
    outcome_date: null,
    location_type: null,
    context: null,
    persistent_id: null,
  },
  {
    id: "r2",
    query_id: "q1",
    category: "burglary",
    month: "2024-01",
    latitude: 52.3,
    longitude: 0.2,
    street: "Mill Road",
    outcome_category: null,
    outcome_date: null,
    location_type: null,
    context: null,
    persistent_id: null,
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.crimeResult.findMany.mockResolvedValue(sampleRows);
});

describe("GET /query/:id/export", () => {
  it("returns 400 for unsupported format", async () => {
    const app = buildApp();
    const res = await request(app).get("/query/q1/export?format=xml");
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("unsupported_format");
  });

  it("returns 400 when format is missing", async () => {
    const app = buildApp();
    const res = await request(app).get("/query/q1/export");
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("unsupported_format");
  });

  it("returns 404 when no results exist for the query ID", async () => {
    mockPrisma.crimeResult.findMany.mockResolvedValue([]);
    const app = buildApp();
    const res = await request(app).get("/query/nonexistent/export?format=csv");
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("not_found");
  });

  it("returns CSV with correct Content-Type header", async () => {
    const app = buildApp();
    const res = await request(app).get("/query/q1/export?format=csv");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/csv");
  });

  it("returns CSV with Content-Disposition attachment header", async () => {
    const app = buildApp();
    const res = await request(app).get("/query/q1/export?format=csv");
    expect(res.headers["content-disposition"]).toContain("attachment");
    expect(res.headers["content-disposition"]).toContain(".csv");
  });

  it("returns CSV with a header row", async () => {
    const app = buildApp();
    const res = await request(app).get("/query/q1/export?format=csv");
    const lines = res.text.trim().split("\n");
    const headers = lines[0].split(",");
    expect(headers).toContain("id");
    expect(headers).toContain("category");
    expect(headers).toContain("latitude");
    expect(headers).toContain("longitude");
  });

  it("CSV row count matches result count", async () => {
    const app = buildApp();
    const res = await request(app).get("/query/q1/export?format=csv");
    const lines = res.text.trim().split("\n");
    // header row + 2 data rows
    expect(lines).toHaveLength(3);
  });

  it("returns GeoJSON with correct Content-Type header", async () => {
    const app = buildApp();
    const res = await request(app).get("/query/q1/export?format=geojson");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("geo+json");
  });

  it("returns valid GeoJSON FeatureCollection", async () => {
    const app = buildApp();
    const res = await request(app).get("/query/q1/export?format=geojson");
    expect(res.body.type).toBe("FeatureCollection");
    expect(Array.isArray(res.body.features)).toBe(true);
    expect(res.body.features).toHaveLength(2);
  });

  it("GeoJSON features have Point geometry with coordinates in [lon, lat] order", async () => {
    const app = buildApp();
    const res = await request(app).get("/query/q1/export?format=geojson");
    const feature = res.body.features[0];
    expect(feature.type).toBe("Feature");
    expect(feature.geometry.type).toBe("Point");
    expect(feature.geometry.coordinates).toEqual([0.1, 52.2]);
  });

  it("GeoJSON features have properties excluding latitude and longitude", async () => {
    const app = buildApp();
    const res = await request(app).get("/query/q1/export?format=geojson");
    const props = res.body.features[0].properties;
    expect(props).not.toHaveProperty("latitude");
    expect(props).not.toHaveProperty("longitude");
    expect(props).toHaveProperty("category");
    expect(props).toHaveProperty("month");
  });
});
