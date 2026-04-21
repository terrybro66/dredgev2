import type { DomainConfigV2 } from "@dredge/schemas";

export function makeConfig(
  overrides: {
    name?: string;
    intents?: string[];
    countries?: string[];
    storeResults?: boolean;
    prismaModel?: string;
    tableName?: string;
    endpoint?: string;
    defaultHint?: "map" | "bar" | "table" | "heatmap" | "dashboard";
    temporality?: "time_series" | "static" | "realtime";
    cacheTtlHours?: number | null;
    defaultOrderBy?: Record<string, "asc" | "desc">;
    spatialAggregation?: boolean;
    rateLimit?: { requestsPerMinute: number };
    sourceLabel?: string;
  } = {},
): DomainConfigV2 {
  return {
    identity: {
      name: overrides.name ?? "test-domain",
      displayName: overrides.name ?? "test-domain",
      description: "test",
      countries: overrides.countries ?? [],
      intents: overrides.intents ?? ["test"],
      sourceLabel: overrides.sourceLabel,
    },
    source: {
      type: "rest",
      endpoint: overrides.endpoint ?? "https://example.com",
    },
    template: {
      type: "listings",
      capabilities: {},
      spatialAggregation: overrides.spatialAggregation,
    },
    fields: {},
    time: { type: overrides.temporality ?? "static" },
    recovery: [],
    storage: {
      storeResults: overrides.storeResults ?? true,
      tableName: overrides.tableName ?? "query_results",
      prismaModel: overrides.prismaModel ?? "queryResult",
      extrasStrategy: "retain_unmapped",
      defaultOrderBy: overrides.defaultOrderBy,
    },
    visualisation: { default: overrides.defaultHint ?? "table", rules: [] },
    ...(overrides.cacheTtlHours != null && {
      cache: { ttlHours: overrides.cacheTtlHours },
    }),
    ...(overrides.rateLimit && { rateLimit: overrides.rateLimit }),
  };
}
