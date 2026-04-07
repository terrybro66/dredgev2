import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  parseIntent,
  deriveVizHint,
  expandDateRange,
} from "../intent";

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
    date_from: "2024-01",
    date_to: "2024-01",
    location: "Cambridge, UK",
    ...overrides,
  });
}

// helper — last full calendar month as YYYY-MM
function lastMonth() {
  const d = new Date();
  d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function threeMonthsAgo() {
  const d = new Date();
  d.setMonth(d.getMonth() - 3);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function twelveMonthsAgo() {
  const d = new Date();
  d.setMonth(d.getMonth() - 12);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

beforeEach(() => {
  mockCreate.mockReset();
});

// ---------------------------------------------------------------------------
// parseIntent
// ---------------------------------------------------------------------------

describe("parseIntent", () => {
  it("returns a valid QueryPlan with category, date_from, date_to, location", async () => {
    mockCreate.mockResolvedValue(makeLLMResponse(validPlan()));
    const plan = await parseIntent("burglaries in Cambridge in January 2024");
    expect(plan).toMatchObject({
      category: "burglary",
      date_from: "2024-01",
      date_to: "2024-01",
      location: expect.any(String),
    });
  });

  it("viz_hint is NOT present on the returned plan", async () => {
    mockCreate.mockResolvedValue(makeLLMResponse(validPlan()));
    const plan = await parseIntent("burglaries in Cambridge in January 2024");
    expect(plan).not.toHaveProperty("viz_hint");
  });

  it("poly is NOT present on the returned plan", async () => {
    mockCreate.mockResolvedValue(makeLLMResponse(validPlan()));
    const plan = await parseIntent("burglaries in Cambridge in January 2024");
    expect(plan).not.toHaveProperty("poly");
  });

  it("location is a place name, never a coordinate string", async () => {
    mockCreate.mockResolvedValue(
      makeLLMResponse(validPlan({ location: "Cambridge, UK" })),
    );
    const plan = await parseIntent("burglaries in Cambridge in January 2024");
    expect(typeof plan.location).toBe("string");
    expect(plan.location).not.toMatch(/^-?\d+\.\d+,\s*-?\d+\.\d+$/);
  });

  it("defaults category to all-crime when not mentioned", async () => {
    mockCreate.mockResolvedValue(
      makeLLMResponse(validPlan({ category: "all-crime" })),
    );
    const plan = await parseIntent("what's happening in Cambridge");
    expect(plan.category).toBe("all-crime");
  });

  it("resolves 'last month' to correct date_from and date_to", async () => {
    const lm = lastMonth();
    mockCreate.mockResolvedValue(
      makeLLMResponse(validPlan({ date_from: lm, date_to: lm })),
    );
    const plan = await parseIntent("crimes in Cambridge last month");
    expect(plan.date_from).toBe(lm);
    expect(plan.date_to).toBe(lm);
  });

  it("resolves 'last 3 months' to correct date_from and date_to", async () => {
    const from = threeMonthsAgo();
    const to = lastMonth();
    mockCreate.mockResolvedValue(
      makeLLMResponse(validPlan({ date_from: from, date_to: to })),
    );
    const plan = await parseIntent(
      "crimes in Cambridge over the last 3 months",
    );
    expect(plan.date_from).toBe(from);
    expect(plan.date_to).toBe(to);
  });

  it("resolves 'last year' to a 12-month range", async () => {
    const from = twelveMonthsAgo();
    const to = lastMonth();
    mockCreate.mockResolvedValue(
      makeLLMResponse(validPlan({ date_from: from, date_to: to })),
    );
    const plan = await parseIntent("crimes in Cambridge over the last year");
    expect(plan.date_from).toBe(from);
    expect(plan.date_to).toBe(to);
  });

  it("resolves single month 'January 2024' to identical date_from and date_to", async () => {
    mockCreate.mockResolvedValue(makeLLMResponse(validPlan()));
    const plan = await parseIntent("burglaries in Cambridge in January 2024");
    expect(plan.date_from).toBe(plan.date_to);
  });

  it("defaults both date fields to last full month when no date mentioned", async () => {
    const lm = lastMonth();
    mockCreate.mockResolvedValue(
      makeLLMResponse(validPlan({ date_from: lm, date_to: lm })),
    );
    const plan = await parseIntent("burglaries in Cambridge");
    expect(plan.date_from).toBe(lm);
    expect(plan.date_to).toBe(lm);
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
    const plan = await parseIntent("burglaries in Cambridge in January 2024");
    expect(plan.category).toBe("burglary");
  });

  it("throws structured IntentError with missing: ['location'] when location field absent", async () => {
    mockCreate.mockResolvedValue(
      makeLLMResponse(
        JSON.stringify({
          category: "burglary",
          date_from: "2024-01",
          date_to: "2024-01",
        }),
      ),
    );
    await expect(
      parseIntent("burglaries in January 2024"),
    ).rejects.toMatchObject({
      error: expect.stringMatching(/incomplete_intent|invalid_intent/),
      missing: expect.arrayContaining(["location"]),
    });
  });

  it("throws structured IntentError with missing: ['category'] when category field absent", async () => {
    mockCreate.mockResolvedValue(
      makeLLMResponse(
        JSON.stringify({
          date_from: "2024-01",
          date_to: "2024-01",
          location: "Cambridge, UK",
        }),
      ),
    );
    await expect(parseIntent("something in Cambridge")).rejects.toMatchObject({
      error: expect.stringMatching(/incomplete_intent|invalid_intent/),
      missing: expect.arrayContaining(["category"]),
    });
  });

  it("includes all missing field names when multiple fields fail", async () => {
    mockCreate.mockResolvedValue(
      makeLLMResponse(JSON.stringify({ date_from: "2024-01" })),
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
          date_from: "2024-01",
          date_to: "2024-01",
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
// deriveVizHint
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

  it("returns 'bar' when category is all-crime and range > 1 month", () => {
    expect(
      deriveVizHint(
        { ...basePlan, category: "all-crime" as const, date_to: "2024-03" },
        "all crimes in Cambridge",
      ),
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
    expect(
      deriveVizHint(basePlan, "weather in London", "weather"),
    ).toBe("dashboard");
  });

  it("returns 'dashboard' when plan.category is 'weather' (classifier absent)", () => {
    expect(
      deriveVizHint(
        { ...basePlan, category: "weather" as const },
        "weather in Bury",
      ),
    ).toBe("dashboard");
  });
});

// ---------------------------------------------------------------------------
// expandDateRange
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

  it("3-month range returns all three months in ascending order", () => {
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
