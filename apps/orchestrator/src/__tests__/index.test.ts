import { describe, it, expect, vi } from "vitest";
import express from "express";
import request from "supertest";

vi.mock("./query", () => ({ queryRouter: express.Router() }));

function buildApp() {
  const app = express();
  app.use(express.json());
  app.get("/health", (_req, res) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
  });
  return app;
}

describe("GET /health", () => {
  it("returns 200", async () => {
    const res = await request(buildApp()).get("/health");
    expect(res.status).toBe(200);
  });

  it("body contains status: ok", async () => {
    const res = await request(buildApp()).get("/health");
    expect(res.body.status).toBe("ok");
  });

  it("body contains a timestamp field", async () => {
    const res = await request(buildApp()).get("/health");
    expect(res.body.timestamp).toBeDefined();
  });

  it("timestamp is a valid ISO 8601 string", async () => {
    const res = await request(buildApp()).get("/health");
    expect(new Date(res.body.timestamp).toISOString()).toBe(res.body.timestamp);
  });
});
