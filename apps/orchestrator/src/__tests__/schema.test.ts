import { describe, it, expect, vi, beforeEach } from "vitest";

const mockPrisma = {
  $queryRaw: vi.fn(),
  $executeRawUnsafe: vi.fn(),
  schemaVersion: { create: vi.fn() },
} as any;

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.$queryRaw.mockResolvedValue([]);
  mockPrisma.$executeRawUnsafe.mockResolvedValue(undefined);
  mockPrisma.schemaVersion.create.mockResolvedValue({});
});

// ── getCurrentColumns ─────────────────────────────────────────────────────────

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

  it("returns empty array when table has no columns", async () => {
    mockPrisma.$queryRaw.mockResolvedValue([]);
    const { getCurrentColumns } = await import("../schema");
    const cols = await getCurrentColumns(mockPrisma, "empty_table");
    expect(cols).toEqual([]);
  });
});

// ── inferPostgresType ─────────────────────────────────────────────────────────

describe("inferPostgresType", () => {
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

// ── evolveSchema ──────────────────────────────────────────────────────────────

describe("evolveSchema", () => {
  it("returns immediately when no new keys", async () => {
    mockPrisma.$queryRaw.mockResolvedValue([
      { column_name: "id" },
      { column_name: "category" },
    ]);

    const { evolveSchema } = await import("../schema");
    await evolveSchema(
      mockPrisma,
      "crime_results",
      { id: "x", category: "burglary" },
      "query-1",
      "crime-uk",
    );

    expect(mockPrisma.$executeRawUnsafe).not.toHaveBeenCalled();
    expect(mockPrisma.schemaVersion.create).not.toHaveBeenCalled();
  });

  it("calls applySchemaOp once per new key", async () => {
    mockPrisma.$queryRaw.mockResolvedValue([{ column_name: "id" }]);

    const { evolveSchema } = await import("../schema");
    await evolveSchema(
      mockPrisma,
      "crime_results",
      { id: "x", new_field: "hello", another_field: 42 },
      "query-1",
      "crime-uk",
    );

    expect(mockPrisma.$executeRawUnsafe).toHaveBeenCalledTimes(2);
  });

  it("writes one SchemaVersion record per new column", async () => {
    mockPrisma.$queryRaw.mockResolvedValue([{ column_name: "id" }]);

    const { evolveSchema } = await import("../schema");
    await evolveSchema(
      mockPrisma,
      "crime_results",
      { id: "x", wind_speed: 12.4 },
      "query-1",
      "crime-uk",
    );

    expect(mockPrisma.schemaVersion.create).toHaveBeenCalledTimes(1);
    expect(mockPrisma.schemaVersion.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          table_name: "crime_results",
          column_name: "wind_speed",
          column_type: "double precision",
          triggered_by: "query-1",
          domain: "crime-uk",
        }),
      }),
    );
  });

  it("infers correct type for each new key", async () => {
    mockPrisma.$queryRaw.mockResolvedValue([]);

    const { evolveSchema } = await import("../schema");
    await evolveSchema(
      mockPrisma,
      "weather_results",
      {
        label: "sunny",
        temp: 18.5,
        count: 3,
        active: true,
        meta: { source: "api" },
      },
      "query-2",
      "weather",
    );

    const calls = mockPrisma.schemaVersion.create.mock.calls.map(
      (c: any) => c[0].data,
    );
    const byCol = Object.fromEntries(
      calls.map((d: any) => [d.column_name, d.column_type]),
    );

    expect(byCol.label).toBe("text");
    expect(byCol.temp).toBe("double precision");
    expect(byCol.count).toBe("integer");
    expect(byCol.active).toBe("boolean");
    expect(byCol.meta).toBe("jsonb");
  });
});

// ── applySchemaOp ─────────────────────────────────────────────────────────────

describe("applySchemaOp", () => {
  it("executes ALTER TABLE for a valid add_column op", async () => {
    const { applySchemaOp } = await import("../schema");
    await applySchemaOp(
      mockPrisma,
      {
        type: "add_column",
        column: "wind_speed",
        columnType: "double precision",
      },
      "query-1",
      "weather_results",
      "weather",
    );

    expect(mockPrisma.$executeRawUnsafe).toHaveBeenCalledWith(
      expect.stringContaining("ALTER TABLE"),
    );
    expect(mockPrisma.$executeRawUnsafe).toHaveBeenCalledWith(
      expect.stringContaining("wind_speed"),
    );
  });

  it("writes SchemaVersion record with correct fields", async () => {
    const { applySchemaOp } = await import("../schema");
    await applySchemaOp(
      mockPrisma,
      { type: "add_column", column: "humidity", columnType: "integer" },
      "query-2",
      "weather_results",
      "weather",
    );

    expect(mockPrisma.schemaVersion.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          table_name: "weather_results",
          column_name: "humidity",
          column_type: "integer",
          triggered_by: "query-2",
          domain: "weather",
        }),
      }),
    );
  });

  it("returns without executing when op is USE_EXISTING", async () => {
    const { applySchemaOp } = await import("../schema");
    await applySchemaOp(
      mockPrisma,
      { op: "USE_EXISTING" } as any,
      "query-1",
      "crime_results",
      "crime-uk",
    );

    expect(mockPrisma.$executeRawUnsafe).not.toHaveBeenCalled();
    expect(mockPrisma.schemaVersion.create).not.toHaveBeenCalled();
  });

  it("throws on column name with uppercase letters", async () => {
    const { applySchemaOp } = await import("../schema");
    await expect(
      applySchemaOp(
        mockPrisma,
        { type: "add_column", column: "WindSpeed", columnType: "text" },
        "query-1",
        "crime_results",
        "crime-uk",
      ),
    ).rejects.toThrow();
  });

  it("throws on column name starting with a number", async () => {
    const { applySchemaOp } = await import("../schema");
    await expect(
      applySchemaOp(
        mockPrisma,
        { type: "add_column", column: "1speed", columnType: "text" },
        "query-1",
        "crime_results",
        "crime-uk",
      ),
    ).rejects.toThrow();
  });

  it("throws on column name with hyphens", async () => {
    const { applySchemaOp } = await import("../schema");
    await expect(
      applySchemaOp(
        mockPrisma,
        { type: "add_column", column: "wind-speed", columnType: "text" },
        "query-1",
        "crime_results",
        "crime-uk",
      ),
    ).rejects.toThrow();
  });
});
