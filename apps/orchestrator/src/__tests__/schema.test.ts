import { describe, it, expect, vi, beforeEach } from "vitest";

const mockPrisma = {
  $queryRaw: vi.fn(),
  $executeRawUnsafe: vi.fn(),
  schemaVersion: { create: vi.fn() },
} as any;

describe("getCurrentColumns", () => {
  it("queries information_schema for the given table name", async () => {
    // TODO
  });
});

describe("inferPostgresType", () => {
  it(infers
