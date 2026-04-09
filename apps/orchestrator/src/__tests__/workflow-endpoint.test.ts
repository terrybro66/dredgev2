/**
 * workflow-endpoint.test.ts — Phase D.12
 *
 * Tests for:
 *   POST /query/chip   — calculate_travel returns workflow_input_required
 *   POST /query/workflow — executes a named workflow, returns workflow_result
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock heavy infrastructure ─────────────────────────────────────────────────

vi.mock("../db", () => ({ prisma: {} }));
vi.mock("../redis", () => ({
  getRedisClient: vi.fn(() => null),
  checkRedisHealth: vi.fn(async () => false),
}));
vi.mock("../geocoder", () => ({ geocodeToPolygon: vi.fn() }));
vi.mock("../intent", () => ({
  parseIntent: vi.fn(),
  deriveVizHint: vi.fn(() => "table"),
  expandDateRange: vi.fn(() => []),
}));
vi.mock("../semantic/classifier", () => ({ classifyIntent: null }));
vi.mock("../agent/shadow-adapter", () => ({
  shadowAdapter: { isEnabled: () => false, recover: vi.fn() },
}));
vi.mock("../agent/domain-discovery", () => ({
  domainDiscovery: { isEnabled: () => false, run: vi.fn() },
}));
vi.mock("../rateLimiter", () => ({ acquire: vi.fn(async () => {}) }));
vi.mock("../session", () => ({
  setUserLocation: vi.fn(),
  getUserLocation: vi.fn(async () => null),
}));
vi.mock("../conversation-memory", () => ({
  updateQueryContext: vi.fn(),
  createEphemeralHandle: vi.fn((rows, domain) => ({
    id: `ephemeral_test`,
    type: domain,
    domain,
    capabilities: [],
    ephemeral: true,
    rowCount: rows.length,
    data: rows,
  })),
  pushResultHandle: vi.fn(),
}));

import express from "express";
import request from "supertest";
import { queryRouter } from "../query";

const app = express();
app.use(express.json());
app.use("/query", queryRouter);

// ── POST /chip — calculate_travel ────────────────────────────────────────────

describe("POST /query/chip — calculate_travel", () => {
  it("returns workflow_input_required with reachable-area schema", async () => {
    const res = await request(app)
      .post("/query/chip")
      .send({ action: "calculate_travel", args: { ref: "qr_123" } });

    expect(res.status).toBe(200);
    expect(res.body.type).toBe("workflow_input_required");
    expect(res.body.workflow_id).toBe("reachable-area");
    expect(res.body.workflow_name).toBe("Reachable Area");
  });

  it("returned input_schema has origin, transport_mode, time_budget_minutes", async () => {
    const res = await request(app)
      .post("/query/chip")
      .send({ action: "calculate_travel", args: {} });

    const fields = (res.body.input_schema as Array<{ field: string }>).map(
      (f) => f.field,
    );
    expect(fields).toContain("origin");
    expect(fields).toContain("transport_mode");
    expect(fields).toContain("time_budget_minutes");
  });
});

// ── POST /workflow ────────────────────────────────────────────────────────────

describe("POST /query/workflow", () => {
  it("returns 404 for unknown workflow_id", async () => {
    const res = await request(app)
      .post("/query/workflow")
      .send({ workflow_id: "does-not-exist", inputs: {} });

    expect(res.status).toBe(404);
    expect(res.body.error).toBe("workflow_not_found");
  });

  it("returns 400 for missing workflow_id", async () => {
    const res = await request(app).post("/query/workflow").send({ inputs: {} });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("validation_error");
  });

  it("returns workflow_result type for reachable-area", async () => {
    const res = await request(app)
      .post("/query/workflow")
      .send({
        workflow_id: "reachable-area",
        inputs: {
          origin: "London",
          transport_mode: "walking",
          time_budget_minutes: 30,
        },
      });

    expect(res.status).toBe(200);
    expect(res.body.type).toBe("workflow_result");
    expect(res.body.result.workflow_id).toBe("reachable-area");
  });

  it("reachable-area result status is partial (virtual domains)", async () => {
    const res = await request(app)
      .post("/query/workflow")
      .send({
        workflow_id: "reachable-area",
        inputs: {
          origin: "London",
          transport_mode: "walking",
          time_budget_minutes: 30,
        },
      });

    // geocoder and transport are virtual — all steps will be not_implemented
    expect(res.body.result.status).toBe("partial");
  });

  it("step_results includes geocode-origin and compute-isochrone", async () => {
    const res = await request(app)
      .post("/query/workflow")
      .send({
        workflow_id: "reachable-area",
        inputs: {
          origin: "London",
          transport_mode: "walking",
          time_budget_minutes: 30,
        },
      });

    const stepIds = res.body.result.step_results.map(
      (s: { step_id: string }) => s.step_id,
    );
    expect(stepIds).toContain("geocode-origin");
    expect(stepIds).toContain("compute-isochrone");
  });

  it("returns workflow_result for cross-domain-overlay", async () => {
    const res = await request(app)
      .post("/query/workflow")
      .send({
        workflow_id: "cross-domain-overlay",
        inputs: {
          location: "Bristol",
          domain_a: "flood-risk",
          domain_b: "crime-uk",
        },
      });

    expect(res.status).toBe(200);
    expect(res.body.type).toBe("workflow_result");
  });
});
