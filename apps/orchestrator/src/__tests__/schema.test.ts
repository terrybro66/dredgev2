import { describe, it, expect, vi, beforeEach } from "vitest";

const mockPrisma = {
  $queryRaw: vi.fn(),
  $executeRawUnsafe: vi.fn(),
  schemaVersion: { create: vi.fn() },
} as any;

describe("getCurrentColumns", () => {
  it("queries information_schema for the given table name", async () => {
    mockPrisma.$queryRaw.mockResolvedValue([
      { column_name: "foo" },
      { column_name: "bar" },
    ]);

    const { getCurrentColumns } = await import("../schema");
    const cols = await getCurrentColumns(mockPrisma, "my_table");

    expect(mockPrisma.$queryRaw).toHaveBeenCalled();
    expect(cols).toEqual(["foo", "bar"]);
  });
});

describe("inferPostgresType", () => {
  // import once at top of suite
  let inferPostgresType: (v: unknown) => string;
  beforeEach(async () => {
    ({ inferPostgresType } = await import("../schema"));
  });

  it('infers "text" for string values', () => {
    expect(inferPostgresType("hello")).toBe("text");
  });
  it('infers "integer" for whole number values', () => {
    expect(inferPostgresType(42)).toBe("integer");
  });
  it('infers "double precision" for decimal values', () => {
    expect(inferPostgresType(3.14)).toBe("double precision");
  });
  it('infers "boolean" for boolean values', () => {
    expect(inferPostgresType(true)).toBe("boolean");
  });
  it('infers "jsonb" for object values', () => {
    expect(inferPostgresType({ foo: "bar" })).toBe("jsonb");
  });
  it('infers "jsonb" for array values', () => {
    expect(inferPostgresType([1, 2, 3])).toBe("jsonb");
  });
  it('infers "text" as safe default for null', () => {
    expect(inferPostgresType(null)).toBe("text");
    expect(inferPostgresType(undefined)).toBe("text");
  });
});
