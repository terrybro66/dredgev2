import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock("../session", () => ({
  getUserLocation: vi.fn(),
  setUserLocation: vi.fn(),
}));

vi.mock("../intent", () => ({
  parseIntent: vi.fn(),
  deriveVizHint: vi.fn().mockReturnValue("bar"),
  expandDateRange: vi.fn().mockReturnValue(["2024-03"]),
}));

vi.mock("../geocoder", () => ({
  geocodeToPolygon: vi.fn(),
}));

vi.mock("../semantic/classifier", () => ({
  classifyIntent: null,
}));

vi.mock("../temporal-resolver", () => ({
  defaultResolveTemporalRange: vi.fn(() => ({ date_from: "2024-03", date_to: "2024-03" })),
  resolveTemporalRangeForCrime: vi.fn(async () => ({ date_from: "2024-03", date_to: "2024-03" })),
}));

vi.mock("../insight", () => ({
  generateInsight: vi.fn(async () => null),
}));

vi.mock("../db", () => ({ prisma: {} }));
vi.mock("../rateLimiter", () => ({ acquire: vi.fn() }));
vi.mock("../followups", () => ({ generateFollowUps: vi.fn() }));
vi.mock("../agent/shadow-adapter", () => ({
  shadowAdapter: { isEnabled: () => false, recover: vi.fn() },
}));
vi.mock("../agent/domain-discovery", () => ({
  domainDiscovery: { isEnabled: () => false },
}));
vi.mock("../execution-model", () => ({ createSnapshot: vi.fn() }));
vi.mock("../curated-registry", () => ({
  findCuratedSource: vi.fn().mockReturnValue(null),
  resolveLocationSlug: vi.fn(),
}));
vi.mock("../providers/rest-provider", () => ({ createRestProvider: vi.fn() }));
vi.mock("../enrichment/source-tag", () => ({ tagRows: vi.fn() }));
vi.mock("../domains/registry", () => ({
  getDomainForQuery: vi.fn().mockReturnValue(undefined),
  loadDomains: vi.fn(),
  getAllAdapters: () => [],
}));

import express from "express";
import request from "supertest";
import { queryRouter } from "../query";
import { getUserLocation, setUserLocation } from "../session";
import { parseIntent } from "../intent";
import { geocodeToPolygon } from "../geocoder";

const app = express();
app.use(express.json());
app.use("/query", queryRouter);

const basePlan = {
  category: "crime",
  date_from: "2024-03",
  date_to: "2024-03",
  location: "London, UK",
  temporal: "2024-03",
};

const londonGeocode = {
  lat: 51.5074,
  lon: -0.1278,
  display_name: "London, UK",
  country_code: "gb",
  poly: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  (geocodeToPolygon as ReturnType<typeof vi.fn>).mockResolvedValue(
    londonGeocode,
  );
});

describe("POST /query/parse — near-me session substitution", () => {
  it("substitutes stored location when query contains 'near me'", async () => {
    (parseIntent as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...basePlan,
      location: "near me",
    });
    (getUserLocation as ReturnType<typeof vi.fn>).mockResolvedValue({
      lat: 51.5074,
      lon: -0.1278,
      display_name: "London, UK",
      country_code: "gb",
    });

    const res = await request(app)
      .post("/query/parse")
      .set("x-session-id", "sess-abc")
      .send({ text: "crime near me last month" });

    expect(res.status).toBe(200);
    expect(geocodeToPolygon).toHaveBeenCalledWith(
      "London, UK",
      expect.anything(),
    );
  });

  it("uses LLM location as-is when no session location is stored", async () => {
    (parseIntent as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...basePlan,
      location: "near me",
    });
    (getUserLocation as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const res = await request(app)
      .post("/query/parse")
      .set("x-session-id", "sess-abc")
      .send({ text: "crime near me last month" });

    expect(res.status).toBe(200);
    // Falls through to geocode whatever the LLM returned
    expect(geocodeToPolygon).toHaveBeenCalledWith("near me", expect.anything());
  });

  it("stores location after resolving a real place name", async () => {
    (parseIntent as ReturnType<typeof vi.fn>).mockResolvedValue(basePlan);

    await request(app)
      .post("/query/parse")
      .set("x-session-id", "sess-abc")
      .send({ text: "crime in London last month" });

    expect(setUserLocation).toHaveBeenCalledWith("sess-abc", {
      lat: londonGeocode.lat,
      lon: londonGeocode.lon,
      display_name: londonGeocode.display_name,
      country_code: londonGeocode.country_code,
    });
  });

  it("does not store location when query contains 'near me'", async () => {
    (parseIntent as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...basePlan,
      location: "near me",
    });
    (getUserLocation as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    await request(app)
      .post("/query/parse")
      .set("x-session-id", "sess-abc")
      .send({ text: "crime near me last month" });

    expect(setUserLocation).not.toHaveBeenCalled();
  });

  it("works without x-session-id header — no session reads or writes", async () => {
    (parseIntent as ReturnType<typeof vi.fn>).mockResolvedValue(basePlan);

    const res = await request(app)
      .post("/query/parse")
      .send({ text: "crime in Manchester last month" });

    expect(res.status).toBe(200);
    expect(getUserLocation).not.toHaveBeenCalled();
    expect(setUserLocation).not.toHaveBeenCalled();
  });
});
