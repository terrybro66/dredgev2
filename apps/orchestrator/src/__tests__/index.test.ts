import { describe, it, expect } from "vitest";
import express from "express";
import request from "supertest";

describe("GET /health", () => {
  it("returns 200", async () => {
    // TODO: build app, GET /health, assert status 200
  });

  it("body contains status: ok", async () => {
    // TODO: assert res.body.status === "ok"
  });

  it("body contains a timestamp field", async () => {
    // TODO: assert res.body.timestamp is defined
  });

  it("timestamp is a valid ISO 8601 string", async () => {
    // TODO: assert new Date(res.body.timestamp).toISOString() === res.body.timestamp
  });
});
