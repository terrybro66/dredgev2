/**
 * cinema-showtimes.test.ts — Phase C.11
 *
 * Tests for:
 *   1. generateChips() on a cinemas-gb handle → "What's on here?" chip
 *   2. /query/chip endpoint for fetch_domain: cinema-showtimes
 *   3. fetchShowtimes() unit test (mocked SerpAPI + scrape)
 */

import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";
import express from "express";
import request from "supertest";
import type { Router } from "express";

// ── Hoist mocks ───────────────────────────────────────────────────────────────

const { mockResolveUrlForQuery } = vi.hoisted(() => ({
  mockResolveUrlForQuery: vi.fn(),
}));
const { mockGetCachedScrapeUrl, mockSetCachedScrapeUrl } = vi.hoisted(() => ({
  mockGetCachedScrapeUrl: vi.fn(),
  mockSetCachedScrapeUrl: vi.fn(),
}));
const { mockScrapeProviderCreate } = vi.hoisted(() => ({
  mockScrapeProviderCreate: vi.fn(),
}));
const { mockCreateEphemeralHandle, mockPushResultHandle } = vi.hoisted(() => ({
  mockCreateEphemeralHandle: vi.fn(),
  mockPushResultHandle:      vi.fn(),
}));

vi.mock("../agent/search/serp", () => ({
  resolveUrlForQuery: mockResolveUrlForQuery,
  searchWithSerp:     vi.fn().mockResolvedValue([]),
}));
vi.mock("../agent/search/scrape-url-cache", () => ({
  getCachedScrapeUrl: mockGetCachedScrapeUrl,
  setCachedScrapeUrl: mockSetCachedScrapeUrl,
}));
vi.mock("../providers/scrape-provider", () => ({
  createScrapeProvider: mockScrapeProviderCreate,
}));
vi.mock("../conversation-memory", () => ({
  createEphemeralHandle: mockCreateEphemeralHandle,
  pushResultHandle:      mockPushResultHandle,
  loadMemory:            vi.fn().mockResolvedValue({
    context: { location: null, active_plan: null, result_stack: [], active_filters: {} },
    profile: { user_attributes: {}, location_history: [] },
  }),
  emptyContext: vi.fn().mockReturnValue({
    location: null, active_plan: null, result_stack: [], active_filters: {},
  }),
  emptyProfile: vi.fn().mockReturnValue({
    user_attributes: {}, location_history: [],
  }),
}));

// ── Capability-inference tests (no HTTP) ──────────────────────────────────────

import { generateChips } from "../capability-inference";
import type { ResultHandle } from "../types/connected";

describe("generateChips — cinemas-gb domain chip", () => {
  const cinemaHandle: ResultHandle = {
    id:           "qr_cinema_1",
    type:         "cinema_venue",
    domain:       "cinemas-gb",
    capabilities: ["has_coordinates"],
    ephemeral:    false,
    rowCount:     12,
    data:         null,
  };

  it("generates a 'What's on here?' chip for cinemas-gb domain", () => {
    const chips = generateChips(cinemaHandle);
    const showtimeChip = chips.find(
      (c) => c.action === "fetch_domain" && c.args.domain === "cinema-showtimes",
    );
    expect(showtimeChip).toBeDefined();
    expect(showtimeChip!.label).toMatch(/what.s on/i);
  });

  it("showtime chip carries the handle ref", () => {
    const chips = generateChips(cinemaHandle);
    const showtimeChip = chips.find((c) => c.args.domain === "cinema-showtimes");
    expect(showtimeChip?.args.ref).toBe("qr_cinema_1");
  });

  it("non-cinema domain does NOT get a showtime chip", () => {
    const crimeHandle: ResultHandle = {
      ...cinemaHandle,
      id:     "qr_crime_1",
      domain: "crime-uk",
    };
    const chips = generateChips(crimeHandle);
    expect(chips.find((c) => c.args.domain === "cinema-showtimes")).toBeUndefined();
  });
});

// ── /query/chip endpoint ──────────────────────────────────────────────────────

let queryRouter: Router;

beforeAll(async () => {
  ({ queryRouter } = await import("../query"));
});

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/query", queryRouter);
  return app;
}

const SHOWTIME_ROWS = [
  { title: "Dune: Part Two", showtime: "19:30", certificate: "12A" },
  { title: "The Substance",  showtime: "21:00", certificate: "18" },
];

const FAKE_HANDLE = {
  id:           "ephemeral_abc",
  type:         "cinema-showtimes",
  domain:       "cinema-showtimes",
  capabilities: [],
  ephemeral:    true,
  rowCount:     2,
  data:         SHOWTIME_ROWS,
};

describe("POST /query/chip — fetch_domain: cinema-showtimes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetCachedScrapeUrl.mockResolvedValue(null);
    mockSetCachedScrapeUrl.mockResolvedValue(undefined);
    mockResolveUrlForQuery.mockResolvedValue("https://www.odeon.co.uk/cinemas/leicester-square/");
    mockScrapeProviderCreate.mockReturnValue({
      fetchRows: vi.fn().mockResolvedValue(SHOWTIME_ROWS),
    });
    mockCreateEphemeralHandle.mockReturnValue(FAKE_HANDLE);
    mockPushResultHandle.mockResolvedValue(undefined);
  });

  it("returns 200 with rows and handle on success", async () => {
    const app = buildApp();
    const res = await request(app)
      .post("/query/chip")
      .send({ action: "fetch_domain", args: { domain: "cinema-showtimes", cinemaName: "Odeon Leicester Square" } });

    expect(res.status).toBe(200);
    expect(res.body.type).toBe("ephemeral");
    expect(res.body.viz_hint).toBe("table");
    expect(Array.isArray(res.body.rows)).toBe(true);
  });

  it("returns 400 when cinemaName is missing", async () => {
    const app = buildApp();
    const res = await request(app)
      .post("/query/chip")
      .send({ action: "fetch_domain", args: { domain: "cinema-showtimes" } });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("missing_cinema_name");
  });

  it("calls resolveUrlForQuery on cache miss", async () => {
    const app = buildApp();
    await request(app)
      .post("/query/chip")
      .send({ action: "fetch_domain", args: { domain: "cinema-showtimes", cinemaName: "Odeon Leicester Square" } });

    expect(mockResolveUrlForQuery).toHaveBeenCalledWith(
      expect.stringContaining("Odeon Leicester Square"),
      expect.any(Array),
    );
  });

  it("skips resolveUrlForQuery on cache hit", async () => {
    mockGetCachedScrapeUrl.mockResolvedValue({
      url: "https://www.odeon.co.uk/cached/",
      extractionPrompt: "Find all movies...",
    });

    const app = buildApp();
    await request(app)
      .post("/query/chip")
      .send({ action: "fetch_domain", args: { domain: "cinema-showtimes", cinemaName: "Odeon Leicester Square" } });

    expect(mockResolveUrlForQuery).not.toHaveBeenCalled();
  });

  it("calls pushResultHandle when sessionId is provided", async () => {
    const app = buildApp();
    await request(app)
      .post("/query/chip")
      .send({
        action:    "fetch_domain",
        args:      { domain: "cinema-showtimes", cinemaName: "Odeon Leicester Square" },
        sessionId: "sess-123",
      });

    expect(mockPushResultHandle).toHaveBeenCalledWith("sess-123", FAKE_HANDLE);
  });

  it("returns 400 for unsupported chip action", async () => {
    const app = buildApp();
    const res = await request(app)
      .post("/query/chip")
      .send({ action: "overlay_spatial", args: {} });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("unsupported_chip_action");
  });

  it("returns 400 for validation error (missing action)", async () => {
    const app = buildApp();
    const res = await request(app)
      .post("/query/chip")
      .send({ args: { domain: "cinema-showtimes" } });

    expect(res.status).toBe(400);
  });
});
