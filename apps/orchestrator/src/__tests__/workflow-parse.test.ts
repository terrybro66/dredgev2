/**
 * workflow-parse.test.ts — Phase D.15
 *
 * Tests that POST /query/parse includes suggested_workflow when the query
 * text matches a workflow trigger intent, and omits it otherwise.
 */

import { describe, it, expect, vi } from "vitest";

vi.mock("../db", () => ({ prisma: {} }));
vi.mock("../redis", () => ({
  getRedisClient: vi.fn(() => null),
  checkRedisHealth: vi.fn(async () => false),
}));
vi.mock("../semantic/classifier", () => ({ classifyIntent: null }));
vi.mock("../session", () => ({
  setUserLocation: vi.fn(),
  getUserLocation: vi.fn(async () => null),
}));
vi.mock("../geocoder", () => ({
  geocodeToPolygon: vi.fn(async (location: string) => ({
    poly: "51.0 -0.5 51.5 0.1 51.0 -0.5",
    lat: 51.2,
    lon: -0.1,
    display_name: location,
    country_code: "GB",
  })),
}));
vi.mock("../intent", () => ({
  parseIntent: vi.fn(async (_text: string) => ({
    category: "transport",
    location: "London",
    date_from: "2025-01",
    date_to: "2025-01",
    temporal: "2025-01",
  })),
  deriveVizHint: vi.fn(() => "table"),
  expandDateRange: vi.fn(() => ["2025-01"]),
}));

vi.mock("../temporal-resolver", () => ({
  defaultResolveTemporalRange: vi.fn(() => ({ date_from: "2025-01", date_to: "2025-01" })),
  resolveTemporalRangeForCrime: vi.fn(async () => ({ date_from: "2025-01", date_to: "2025-01" })),
}));

vi.mock("../insight", () => ({
  generateInsight: vi.fn(async () => null),
}));

vi.mock("../domains/registry", () => ({
  getDomainForQuery: vi.fn().mockReturnValue(undefined),
  getDomainByName: vi.fn().mockReturnValue(undefined),
  loadDomains: vi.fn(),
  getAllAdapters: () => [],
}));

vi.mock("../curated-registry", () => ({
  findCuratedSource: vi.fn().mockReturnValue(null),
  resolveLocationSlug: vi.fn(),
}));

vi.mock("../agent/shadow-adapter", () => ({
  shadowAdapter: { isEnabled: () => false, recover: vi.fn() },
}));

vi.mock("../agent/domain-discovery", () => ({
  domainDiscovery: { isEnabled: () => false },
}));

vi.mock("../followups", () => ({ generateFollowUps: vi.fn() }));
vi.mock("../execution-model", () => ({ createSnapshot: vi.fn() }));
vi.mock("../rateLimiter", () => ({ acquire: vi.fn() }));

import express from "express";
import request from "supertest";
import { queryRouter } from "../query";

const app = express();
app.use(express.json());
app.use("/query", queryRouter);

describe("POST /query/parse — suggested_workflow", () => {
  it("includes suggested_workflow for a reachable-area intent", async () => {
    const res = await request(app)
      .post("/query/parse")
      .send({ text: "how far can i travel from London in 30 minutes" });

    expect(res.status).toBe(200);
    expect(res.body.suggested_workflow).toBeDefined();
    expect(res.body.suggested_workflow.workflow_id).toBe("reachable-area");
  });

  it("suggested_workflow includes workflow_name, description, input_schema", async () => {
    const res = await request(app)
      .post("/query/parse")
      .send({ text: "how far can i travel from Bristol" });

    const wf = res.body.suggested_workflow;
    expect(typeof wf.workflow_name).toBe("string");
    expect(typeof wf.description).toBe("string");
    expect(Array.isArray(wf.input_schema)).toBe(true);
    expect(wf.input_schema.length).toBeGreaterThan(0);
  });

  it("input_schema fields include origin, transport_mode, time_budget_minutes", async () => {
    const res = await request(app)
      .post("/query/parse")
      .send({ text: "within 30 minutes of Edinburgh" });

    const fields = res.body.suggested_workflow.input_schema.map(
      (f: { field: string }) => f.field,
    );
    expect(fields).toContain("origin");
    expect(fields).toContain("transport_mode");
    expect(fields).toContain("time_budget_minutes");
  });

  it("omits suggested_workflow for a plain data query", async () => {
    const res = await request(app)
      .post("/query/parse")
      .send({ text: "crime in Manchester" });

    expect(res.body.suggested_workflow).toBeUndefined();
  });

  it("includes suggested_workflow for itinerary intent", async () => {
    const res = await request(app)
      .post("/query/parse")
      .send({ text: "plan a day out in Bristol" });

    expect(res.body.suggested_workflow).toBeDefined();
    expect(res.body.suggested_workflow.workflow_id).toBe("itinerary");
  });
});
