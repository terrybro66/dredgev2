import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@dredge/database");

describe("storeResults", () => {
  it("calls prisma.$transaction with the correct number of create operations", async () => { /* TODO */ });
  it("latitude is stored as a float, not a string", async () => { /* TODO */ });
  it("longitude is stored as a float, not a string", async () => { /* TODO */ });
  it("raw field contains the full original crime object", async () => { /* TODO */ });
  it("only writes columns that currently exist in the schema", async () => { /* TODO */ });
  it("a column not in the schema is silently dropped", async () => { /* TODO */ });
  it("a new column added by schema evolution in the same request is written correctly", async () => { /* TODO */ });
  it("unknown top-level fields are included in the flattened row", async () => { /* TODO */ });
  it("does not call prisma.$transaction when crimes array is empty", async () => { /* TODO */ });
});
