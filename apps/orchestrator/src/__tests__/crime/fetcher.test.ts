import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("axios");

describe("fetchCrimesForMonth", () => {
  it("calls correct URL with category slug", async () => { /* TODO */ });
  it("passes date param as the month argument", async () => { /* TODO */ });
  it("passes poly param correctly", async () => { /* TODO */ });
  it("returns array of RawCrime objects", async () => { /* TODO */ });
  it("unknown fields on crime objects are preserved", async () => { /* TODO */ });
  it("handles empty array response without throwing", async () => { /* TODO */ });
  it("throws when polygon exceeds 100 points", async () => { /* TODO */ });
});

describe("fetchCrimes", () => {
  it("calls API once for a single-month range", async () => { /* TODO */ });
  it("calls API three times for a 3-month range", async () => { /* TODO */ });
  it("calls API twelve times for a 12-month range", async () => { /* TODO */ });
  it("merges results from all months into a single array", async () => { /* TODO */ });
  it("calls months sequentially, not in parallel", async () => { /* TODO */ });
  it("returns combined results in month-ascending order", async () => { /* TODO */ });
});
