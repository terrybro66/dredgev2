import { describe, it, expect } from "vitest";
import {
  DomainConfigV2,
  FieldDef,
  Capability,
  TemplateType,
  VizHint,
} from "../index";

// ── Minimal valid config factory ──────────────────────────────────────────────

function minimal(): DomainConfigV2 {
  return {
    identity: {
      name: "test-domain",
      displayName: "Test Domain",
      description: "A test domain",
      countries: ["gb"],
      intents: ["test"],
    },
    source: {
      type: "rest",
      endpoint: "https://example.com/api",
    },
    template: {
      type: "places",
      capabilities: { has_coordinates: true },
    },
    fields: {
      lat: { source: "latitude", type: "number", role: "location_lat" },
      lon: { source: "longitude", type: "number", role: "location_lon" },
    },
    time: { type: "static" },
    recovery: [],
    storage: {
      storeResults: true,
      tableName: "query_results",
      prismaModel: "queryResult",
      extrasStrategy: "retain_unmapped",
    },
    visualisation: {
      default: "map",
      rules: [],
    },
  };
}

// ── identity ──────────────────────────────────────────────────────────────────

describe("DomainConfigV2 — identity", () => {
  it("accepts all required identity fields", () => {
    const c = minimal();
    expect(c.identity.name).toBe("test-domain");
    expect(c.identity.displayName).toBe("Test Domain");
    expect(c.identity.countries).toEqual(["gb"]);
    expect(c.identity.intents).toEqual(["test"]);
  });

  it("countries can be empty (global domain)", () => {
    const c: DomainConfigV2 = {
      ...minimal(),
      identity: { ...minimal().identity, countries: [] },
    };
    expect(c.identity.countries).toHaveLength(0);
  });
});

// ── source ────────────────────────────────────────────────────────────────────

describe("DomainConfigV2 — source", () => {
  it("accepts rest type with endpoint", () => {
    expect(minimal().source.type).toBe("rest");
    expect(minimal().source.endpoint).toMatch(/^https/);
  });

  it("accepts optional method, queryParams, apiKeyEnv", () => {
    const c: DomainConfigV2 = {
      ...minimal(),
      source: {
        type: "rest",
        endpoint: "https://example.com/{YYYY-MM}",
        method: "GET",
        queryParams: { lat: "{lat}", lon: "{lon}" },
        apiKeyEnv: "MY_API_KEY",
      },
    };
    expect(c.source.queryParams?.lat).toBe("{lat}");
    expect(c.source.apiKeyEnv).toBe("MY_API_KEY");
  });

  it("accepts all four source types", () => {
    const types: DomainConfigV2["source"]["type"][] = [
      "rest",
      "csv",
      "xlsx",
      "scrape",
    ];
    for (const type of types) {
      const c: DomainConfigV2 = {
        ...minimal(),
        source: { type, endpoint: "https://x.com" },
      };
      expect(c.source.type).toBe(type);
    }
  });
});

// ── template ──────────────────────────────────────────────────────────────────

describe("DomainConfigV2 — template", () => {
  it("accepts all six template types", () => {
    const types: TemplateType[] = [
      "incidents",
      "places",
      "forecasts",
      "boundaries",
      "listings",
      "regulations",
    ];
    for (const type of types) {
      const c: DomainConfigV2 = {
        ...minimal(),
        template: { type, capabilities: {} },
      };
      expect(c.template.type).toBe(type);
    }
  });

  it("capabilities can be partial", () => {
    const c: DomainConfigV2 = {
      ...minimal(),
      template: {
        type: "incidents",
        capabilities: { has_coordinates: true, has_time_series: true },
      },
    };
    expect(c.template.capabilities.has_coordinates).toBe(true);
    expect(c.template.capabilities.has_polygon).toBeUndefined();
  });
});

// ── fields / FieldDef ─────────────────────────────────────────────────────────

describe("FieldDef", () => {
  it("accepts minimal definition", () => {
    const f: FieldDef = {
      source: "latitude",
      type: "number",
      role: "location_lat",
    };
    expect(f.source).toBe("latitude");
  });

  it("accepts dot-path sources", () => {
    const f: FieldDef = {
      source: "location.latitude",
      type: "number",
      role: "location_lat",
    };
    expect(f.source).toContain(".");
  });

  it("accepts all role values", () => {
    const roles: FieldDef["role"][] = [
      "time",
      "metric",
      "dimension",
      "location_lat",
      "location_lon",
      "label",
      "extra",
    ];
    for (const role of roles) {
      const f: FieldDef = { source: "x", type: "string", role };
      expect(f.role).toBe(role);
    }
  });

  it("accepts all type values", () => {
    const types: FieldDef["type"][] = [
      "time",
      "number",
      "string",
      "enum",
      "boolean",
    ];
    for (const t of types) {
      const f: FieldDef = { source: "x", type: t, role: "extra" };
      expect(f.type).toBe(t);
    }
  });

  it("accepts optional format and resolution for time fields", () => {
    const f: FieldDef = {
      source: "month",
      type: "time",
      role: "time",
      format: "YYYY-MM",
      resolution: "month",
    };
    expect(f.format).toBe("YYYY-MM");
    expect(f.resolution).toBe("month");
  });

  it("accepts normalise and transform for enum fields", () => {
    const f: FieldDef = {
      source: "category",
      type: "enum",
      role: "dimension",
      normalise: true,
      transform: "humanise_category",
    };
    expect(f.normalise).toBe(true);
    expect(f.transform).toBe("humanise_category");
  });
});

// ── time ──────────────────────────────────────────────────────────────────────

describe("DomainConfigV2 — time", () => {
  it("accepts static type with no other fields", () => {
    expect(minimal().time.type).toBe("static");
  });

  it("accepts time_series with availability clamping", () => {
    const c: DomainConfigV2 = {
      ...minimal(),
      time: {
        type: "time_series",
        resolution: "month",
        availability: { source: "crime-uk", strategy: "clamp" },
        defaultRange: "6_months",
      },
    };
    expect(c.time.availability?.strategy).toBe("clamp");
    expect(c.time.resolution).toBe("month");
  });

  it("accepts nearest availability strategy", () => {
    const c: DomainConfigV2 = {
      ...minimal(),
      time: {
        type: "time_series",
        availability: { source: "x", strategy: "nearest" },
      },
    };
    expect(c.time.availability?.strategy).toBe("nearest");
  });

  it("accepts realtime type", () => {
    const c: DomainConfigV2 = { ...minimal(), time: { type: "realtime" } };
    expect(c.time.type).toBe("realtime");
  });
});

// ── recovery ──────────────────────────────────────────────────────────────────

describe("DomainConfigV2 — recovery", () => {
  it("accepts empty array", () => {
    expect(minimal().recovery).toHaveLength(0);
  });

  it("accepts shift_time strategy", () => {
    const c: DomainConfigV2 = {
      ...minimal(),
      recovery: [
        {
          strategy: "shift_time",
          trigger: "empty",
          direction: "backward",
          step: "1_month",
          maxAttempts: 3,
        },
      ],
    };
    expect(c.recovery[0].strategy).toBe("shift_time");
    expect(c.recovery[0].direction).toBe("backward");
  });

  it("accepts expand_spatial strategy", () => {
    const c: DomainConfigV2 = {
      ...minimal(),
      recovery: [
        {
          strategy: "expand_spatial",
          trigger: "low_results",
          threshold: 5,
          factor: 1.5,
          maxRadius: "50km",
        },
      ],
    };
    expect(c.recovery[0].strategy).toBe("expand_spatial");
    expect(c.recovery[0].maxRadius).toBe("50km");
  });

  it("accepts relax_filter strategy", () => {
    const c: DomainConfigV2 = {
      ...minimal(),
      recovery: [
        { strategy: "relax_filter", trigger: "empty", field: "category" },
      ],
    };
    expect(c.recovery[0].strategy).toBe("relax_filter");
  });

  it("accepts none strategy", () => {
    const c: DomainConfigV2 = {
      ...minimal(),
      recovery: [{ strategy: "none", trigger: "empty" }],
    };
    expect(c.recovery[0].strategy).toBe("none");
  });

  it("first trigger wins — multiple strategies in order", () => {
    const c: DomainConfigV2 = {
      ...minimal(),
      recovery: [
        {
          strategy: "shift_time",
          trigger: "empty",
          direction: "backward",
          step: "1_month",
          maxAttempts: 3,
        },
        { strategy: "expand_spatial", trigger: "low_results", factor: 2 },
      ],
    };
    expect(c.recovery).toHaveLength(2);
    expect(c.recovery[0].strategy).toBe("shift_time");
    expect(c.recovery[1].strategy).toBe("expand_spatial");
  });
});

// ── storage ───────────────────────────────────────────────────────────────────

describe("DomainConfigV2 — storage", () => {
  it("defaults to query_results / queryResult", () => {
    const s = minimal().storage;
    expect(s.tableName).toBe("query_results");
    expect(s.prismaModel).toBe("queryResult");
  });

  it("accepts discard extrasStrategy", () => {
    const c: DomainConfigV2 = {
      ...minimal(),
      storage: { ...minimal().storage, extrasStrategy: "discard" },
    };
    expect(c.storage.extrasStrategy).toBe("discard");
  });
});

// ── visualisation ─────────────────────────────────────────────────────────────

describe("DomainConfigV2 — visualisation", () => {
  it("accepts default viz hint", () => {
    expect(minimal().visualisation.default).toBe("map");
  });

  it("accepts all VizHint values as default", () => {
    const hints: VizHint[] = ["map", "bar", "table", "heatmap", "dashboard"];
    for (const hint of hints) {
      const c: DomainConfigV2 = {
        ...minimal(),
        visualisation: { default: hint, rules: [] },
      };
      expect(c.visualisation.default).toBe(hint);
    }
  });

  it("accepts rules with condition and view", () => {
    const c: DomainConfigV2 = {
      ...minimal(),
      visualisation: {
        default: "map",
        rules: [
          { condition: "multi_month", view: "chart" },
          { condition: "has_category", view: "bar" },
          { condition: "single_location", view: "map" },
        ],
      },
    };
    expect(c.visualisation.rules).toHaveLength(3);
    expect(c.visualisation.rules[0].condition).toBe("multi_month");
  });
});

// ── relationships ─────────────────────────────────────────────────────────────

describe("DomainConfigV2 — relationships", () => {
  it("is optional", () => {
    expect(minimal().relationships).toBeUndefined();
  });

  it("accepts suggests array", () => {
    const c: DomainConfigV2 = {
      ...minimal(),
      relationships: {
        suggests: [
          { domain: "flood-risk-gb", reason: "nearby hazard" },
          { domain: "crime-uk", reason: "area context" },
        ],
      },
    };
    expect(c.relationships?.suggests).toHaveLength(2);
    expect(c.relationships?.suggests[0].domain).toBe("flood-risk-gb");
  });
});

// ── Capability type ───────────────────────────────────────────────────────────

describe("Capability", () => {
  it("accepts all seven capability keys", () => {
    const caps: Capability[] = [
      "has_coordinates",
      "has_time_series",
      "has_category",
      "has_polygon",
      "has_schedule",
      "has_regulatory_reference",
      "has_training_requirement",
    ];
    expect(caps).toHaveLength(7);
    for (const c of caps) {
      expect(typeof c).toBe("string");
    }
  });
});

// ── DomainAdapter.config compatibility ───────────────────────────────────────

describe("DomainAdapter.config compatibility", () => {
  it("DomainConfigV2 can be assigned to adapter.config without casting", () => {
    const config = minimal();
    const adapter = {
      config,
      fetchData: async () => [],
      flattenRow: (r: unknown) => r as Record<string, unknown>,
      storeResults: async () => {},
    };
    expect(adapter.config.identity.name).toBe("test-domain");
  });
});
