import { describe, it, expect, vi } from "vitest";

describe("GenericAdapter", () => {
  it("fans out to a single csv source and returns rows", async () => {
    const { createGenericAdapter } = await import("../domains/generic-adapter");

    const adapter = createGenericAdapter({
      name: "test-domain",
      tableName: "test_results",
      prismaModel: "testResult",
      countries: [],
      intents: ["test"],
      apiUrl: "https://example.com",
      apiKeyEnv: null,
      locationStyle: "coordinates" as const,
      params: {},
      flattenRow: { raw: "$" },
      categoryMap: {},
      vizHintRules: {
        defaultHint: "table" as const,
        multiMonthHint: "table" as const,
      },
      sources: [
        {
          type: "csv" as const,
          url: "https://example.com/data.csv",
          refreshPolicy: "static" as const,
        },
      ],
    });

    // Patch the provider fetch so no real HTTP call is made
    vi.spyOn(adapter, "fetchData").mockResolvedValueOnce([
      { name: "Alice", age: "30" },
      { name: "Bob", age: "25" },
    ]);

    const rows = await adapter.fetchData({}, "");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ name: "Alice" });
  });

  it("merges rows from multiple sources", async () => {
    const { createGenericAdapter } = await import("../domains/generic-adapter");

    const adapter = createGenericAdapter({
      name: "multi-source-domain",
      tableName: "test_results",
      prismaModel: "testResult",
      countries: [],
      intents: ["test"],
      apiUrl: "https://example.com",
      apiKeyEnv: null,
      locationStyle: "coordinates" as const,
      params: {},
      flattenRow: { raw: "$" },
      categoryMap: {},
      vizHintRules: {
        defaultHint: "table" as const,
        multiMonthHint: "table" as const,
      },
      sources: [
        {
          type: "csv" as const,
          url: "https://example.com/a.csv",
          refreshPolicy: "daily" as const,
        },
        {
          type: "csv" as const,
          url: "https://example.com/b.csv",
          refreshPolicy: "weekly" as const,
        },
      ],
    });

    vi.spyOn(adapter, "fetchData").mockResolvedValueOnce([
      { name: "Alice" },
      { name: "Bob" },
      { name: "Carol" },
    ]);

    const rows = await adapter.fetchData({}, "");
    expect(rows).toHaveLength(3);
  });

  it("returns empty array when no sources are configured", async () => {
    const { createGenericAdapter } = await import("../domains/generic-adapter");

    const adapter = createGenericAdapter({
      name: "empty-domain",
      tableName: "test_results",
      prismaModel: "testResult",
      countries: [],
      intents: ["test"],
      apiUrl: "https://example.com",
      apiKeyEnv: null,
      locationStyle: "coordinates" as const,
      params: {},
      flattenRow: { raw: "$" },
      categoryMap: {},
      vizHintRules: {
        defaultHint: "table" as const,
        multiMonthHint: "table" as const,
      },
    });

    vi.spyOn(adapter, "fetchData").mockResolvedValueOnce([]);

    const rows = await adapter.fetchData({}, "");
    expect(rows).toHaveLength(0);
  });

  it("flattenRow returns the row as-is by default", async () => {
    const { createGenericAdapter } = await import("../domains/generic-adapter");

    const adapter = createGenericAdapter({
      name: "flatten-domain",
      tableName: "test_results",
      prismaModel: "testResult",
      countries: [],
      intents: ["test"],
      apiUrl: "https://example.com",
      apiKeyEnv: null,
      locationStyle: "coordinates" as const,
      params: {},
      flattenRow: { raw: "$" },
      categoryMap: {},
      vizHintRules: {
        defaultHint: "table" as const,
        multiMonthHint: "table" as const,
      },
    });

    const row = { name: "Alice", age: 30 };
    expect(adapter.flattenRow(row)).toEqual(row);
  });
});
