import { describe, it, expect, vi, beforeEach } from "vitest";
import { parseIntent, deriveVizHint, expandDateRange } from "../intent";

const { mockCreate } = vi.hoisted(() => ({
  mockCreate: vi.fn(),
}));

vi.mock("openai", () => {
  function MockOpenAI() {
    return { chat: { completions: { create: mockCreate } } };
  }
  return { default: MockOpenAI };
});

function makeLLMResponse(content: string) {
  return {
    choices: [{ message: { content } }],
  };
}

function validPlan(overrides = {}) {
  return JSON.stringify({
    category: "burglary",
    temporal: "last month",
    location: "Cambridge, UK",
    ...overrides,
  });
}

beforeEach(() => {
  mockCreate.mockReset();
});

// ---------------------------------------------------------------------------
// parseIntent
// ---------------------------------------------------------------------------

describe("parseIntent", () => {
  it("returns an UnresolvedQueryPlan with category, temporal, location", async () => {
    mockCreate.mockResolvedValue(makeLLMResponse(validPlan()));
    const plan = await parseIntent("burglaries in Cambridge last month");
    expect(plan).toMatchObject({
      category: "burglary",
      temporal: expect.any(String),
      location: expect.any(String),
    });
  });

  it("does NOT return date_from on the plan", async () => {
    mockCreate.mockResolvedValue(makeLLMResponse(validPlan()));
    const plan = await parseIntent("burglaries in Cambridge last month");
    expect(plan).not.toHaveProperty("date_from");
  });

  it("does NOT return date_to on the plan", async () => {
    mockCreate.mockResolvedValue(makeLLMResponse(validPlan()));
    const plan = await parseIntent("burglaries in Cambridge last month");
    expect(plan).not.toHaveProperty("date_to");
  });

  it("viz_hint is NOT present on the returned plan", async () => {
    mockCreate.mockResolvedValue(makeLLMResponse(validPlan()));
    const plan = await parseIntent("burglaries in Cambridge last month");
    expect(plan).not.toHaveProperty("viz_hint");
  });

  it("poly is NOT present on the returned plan", async () => {
    mockCreate.mockResolvedValue(makeLLMResponse(validPlan()));
    const plan = await parseIntent("burglaries in Cambridge last month");
    expect(plan).not.toHaveProperty("poly");
  });

  it("location is a place name, never a coordinate string", async () => {
    mockCreate.mockResolvedValue(
      makeLLMResponse(validPlan({ location: "Cambridge, UK" })),
    );
    const plan = await parseIntent("burglaries in Cambridge last month");
    expect(typeof plan.location).toBe("string");
    expect(plan.location).not.toMatch(/^-?\d+\.\d+,\s*-?\d+\.\d+$/);
  });

  it("returns temporal field as a non-empty string", async () => {
    mockCreate.mockResolvedValue(
      makeLLMResponse(validPlan({ temporal: "last month" })),
    );
    const plan = await parseIntent("burglaries in Cambridge last month");
    expect(typeof plan.temporal).toBe("string");
    expect(plan.temporal.length).toBeGreaterThan(0);
  });

  it("passes through 'last month' temporal expression unchanged", async () => {
    mockCreate.mockResolvedValue(
      makeLLMResponse(validPlan({ temporal: "last month" })),
    );
    const plan = await parseIntent("burglaries in Cambridge last month");
    expect(plan.temporal).toBe("last month");
  });

  it("passes through 'last 3 months' temporal expression unchanged", async () => {
    mockCreate.mockResolvedValue(
      makeLLMResponse(validPlan({ temporal: "last 3 months" })),
    );
    const plan = await parseIntent(
      "crimes in Cambridge over the last 3 months",
    );
    expect(plan.temporal).toBe("last 3 months");
  });

  it("passes through 'last year' temporal expression unchanged", async () => {
    mockCreate.mockResolvedValue(
      makeLLMResponse(validPlan({ temporal: "last year" })),
    );
    const plan = await parseIntent("crimes in Cambridge over the last year");
    expect(plan.temporal).toBe("last year");
  });

  it("passes through 'January 2024' temporal expression unchanged", async () => {
    mockCreate.mockResolvedValue(
      makeLLMResponse(validPlan({ temporal: "January 2024" })),
    );
    const plan = await parseIntent("burglaries in Cambridge in January 2024");
    expect(plan.temporal).toBe("January 2024");
  });

  it("passes through 'unspecified' when no date mentioned", async () => {
    mockCreate.mockResolvedValue(
      makeLLMResponse(validPlan({ temporal: "unspecified" })),
    );
    const plan = await parseIntent("burglaries in Cambridge");
    expect(plan.temporal).toBe("unspecified");
  });

  it("defaults location to 'Cambridge, UK' when no location given", async () => {
    mockCreate.mockResolvedValue(
      makeLLMResponse(validPlan({ location: "Cambridge, UK" })),
    );
    const plan = await parseIntent("show me burglaries last month");
    expect(plan.location).toBe("Cambridge, UK");
  });

  it("strips markdown fences before parsing JSON", async () => {
    const fenced = "```json\n" + validPlan() + "\n```";
    mockCreate.mockResolvedValue(makeLLMResponse(fenced));
    const plan = await parseIntent("burglaries in Cambridge last month");
    expect(plan.category).toBe("burglary");
  });

  it("throws structured IntentError with missing: ['location'] when location absent", async () => {
    mockCreate.mockResolvedValue(
      makeLLMResponse(
        JSON.stringify({
          category: "burglary",
          temporal: "last month",
        }),
      ),
    );
    await expect(parseIntent("burglaries last month")).rejects.toMatchObject({
      error: expect.stringMatching(/incomplete_intent|invalid_intent/),
      missing: expect.arrayContaining(["location"]),
    });
  });

  it("throws structured IntentError with missing: ['category'] when category absent", async () => {
    mockCreate.mockResolvedValue(
      makeLLMResponse(
        JSON.stringify({
          temporal: "last month",
          location: "Cambridge, UK",
        }),
      ),
    );
    await expect(parseIntent("something in Cambridge")).rejects.toMatchObject({
      error: expect.stringMatching(/incomplete_intent|invalid_intent/),
      missing: expect.arrayContaining(["category"]),
    });
  });

  it("throws structured IntentError with missing: ['temporal'] when temporal absent", async () => {
    mockCreate.mockResolvedValue(
      makeLLMResponse(
        JSON.stringify({
          category: "burglary",
          location: "Cambridge, UK",
        }),
      ),
    );
    await expect(parseIntent("burglaries in Cambridge")).rejects.toMatchObject({
      error: expect.stringMatching(/incomplete_intent|invalid_intent/),
      missing: expect.arrayContaining(["temporal"]),
    });
  });

  it("includes all missing field names when multiple fields fail", async () => {
    mockCreate.mockResolvedValue(
      makeLLMResponse(JSON.stringify({ temporal: "last month" })),
    );
    await expect(parseIntent("something")).rejects.toMatchObject({
      missing: expect.arrayContaining(["location", "category"]),
    });
  });

  it("populates 'understood' with successfully parsed fields even when others fail", async () => {
    mockCreate.mockResolvedValue(
      makeLLMResponse(
        JSON.stringify({
          category: "burglary",
          temporal: "last month",
        }),
      ),
    );
    await expect(parseIntent("something")).rejects.toMatchObject({
      understood: expect.objectContaining({ category: "burglary" }),
    });
  });

  it("throws on malformed JSON response from LLM", async () => {
    mockCreate.mockResolvedValue(makeLLMResponse("not valid json {{{"));
    await expect(parseIntent("burglaries in Cambridge")).rejects.toThrow();
  });

  it("throws 'Query text must not be empty' on blank input", async () => {
    await expect(parseIntent("")).rejects.toThrow(
      "Query text must not be empty",
    );
  });
});

// ---------------------------------------------------------------------------
// deriveVizHint — receives a resolved QueryPlan, unchanged by Phase D
// ---------------------------------------------------------------------------

describe("deriveVizHint", () => {
  const basePlan = {
    category: "burglary" as const,
    date_from: "2024-01",
    date_to: "2024-01",
    location: "Cambridge, UK",
  };

  it("returns 'map' for single-month single-location query", () => {
    expect(deriveVizHint(basePlan, "burglaries in Cambridge")).toBe("map");
  });

  it("returns 'bar' when date_from !== date_to", () => {
    expect(
      deriveVizHint({ ...basePlan, date_to: "2024-03" }, "crimes in Cambridge"),
    ).toBe("bar");
  });

  it("returns 'table' when raw text contains 'list'", () => {
    expect(deriveVizHint(basePlan, "list crimes in Cambridge")).toBe("table");
  });

  it("returns 'table' when raw text contains 'show me'", () => {
    expect(deriveVizHint(basePlan, "show me crimes in Cambridge")).toBe(
      "table",
    );
  });

  it("returns 'table' when raw text contains 'details'", () => {
    expect(deriveVizHint(basePlan, "crime details in Cambridge")).toBe("table");
  });

  it("returns 'map' as default when no rule matches", () => {
    expect(deriveVizHint(basePlan, "crimes in Cambridge")).toBe("map");
  });

  it("returns 'dashboard' when intent is 'weather'", () => {
    expect(deriveVizHint(basePlan, "weather in London", "weather")).toBe(
      "dashboard",
    );
  });

  it("returns 'dashboard' when plan.category starts with 'weather'", () => {
    expect(
      deriveVizHint(
        { ...basePlan, category: "weather" as const },
        "weather in Bury",
      ),
    ).toBe("dashboard");
  });
});

// ---------------------------------------------------------------------------
// expandDateRange — pure function, unchanged by Phase D
// ---------------------------------------------------------------------------

describe("expandDateRange", () => {
  it("same month returns array with one entry", () => {
    expect(expandDateRange("2024-01", "2024-01")).toEqual(["2024-01"]);
  });

  it("two adjacent months returns both in order", () => {
    expect(expandDateRange("2024-01", "2024-02")).toEqual([
      "2024-01",
      "2024-02",
    ]);
  });

  it("3-month range returns all three months", () => {
    expect(expandDateRange("2024-01", "2024-03")).toEqual([
      "2024-01",
      "2024-02",
      "2024-03",
    ]);
  });

  it("12-month range returns 12 entries", () => {
    expect(expandDateRange("2023-01", "2023-12")).toHaveLength(12);
  });

  it("throws when date_to is earlier than date_from", () => {
    expect(() => expandDateRange("2024-03", "2024-01")).toThrow();
  });
});
