import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

vi.mock("../crime/intent");
vi.mock("../crime/fetcher");
vi.mock("../crime/store");
vi.mock("../geocoder");
vi.mock("../schema");

describe("POST /query/parse", () => {
  it("returns 400 when text field is missing", async () => { /* TODO */ });
  it("returns 400 when text is an empty string", async () => { /* TODO */ });
  it("returns 400 with structured IntentError when parseIntent throws", async () => { /* TODO */ });
  it("structured error includes understood and missing fields", async () => { /* TODO */ });
  it("returns 400 with structured error when geocoder fails", async () => { /* TODO */ });
  it("returns confirmation payload with plan, poly, viz_hint, resolved_location, months", async () => { /* TODO */ });
  it("does not write to the database", async () => { /* TODO */ });
  it("does not call fetchCrimes", async () => { /* TODO */ });
  it("viz_hint is derived, not from LLM", async () => { /* TODO */ });
  it("resolved_location reflects geocoder display_name", async () => { /* TODO */ });
  it("months array is correctly expanded from date range", async () => { /* TODO */ });
});

describe("POST /query/execute", () => {
  it("returns 400 when body is missing required fields", async () => { /* TODO */ });
  it("creates Query record with domain: crime", async () => { /* TODO */ });
  it("stores resolved_location on Query record", async () => { /* TODO */ });
  it("calls fetchCrimes with the poly from the request body", async () => { /* TODO */ });
  it("calls evolveSchema with crime_results and crime when crimes returned", async () => { /* TODO */ });
  it("does not call evolveSchema when crimes array is empty", async () => { /* TODO */ });
  it("response includes query_id, plan, poly, viz_hint, resolved_location, count, months_fetched, results", async () => { /* TODO */ });
  it("caps results at 100 items", async () => { /* TODO */ });
  it("returns 500 when fetchCrimes throws", async () => { /* TODO */ });
  it("returns 500 when storeResults throws", async () => { /* TODO */ });
});

describe("GET /query/:id", () => {
  it("returns 404 for unknown id", async () => { /* TODO */ });
  it("returns query record with results included", async () => { /* TODO */ });
});
