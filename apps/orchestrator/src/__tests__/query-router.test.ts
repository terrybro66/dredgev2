import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  detectRefinement,
  applyRefinement,
  matchTemplate,
  QueryRouter,
  type RouteResult,
  type TemplateMatch,
} from "../query-router";
import type { ConversationMemory } from "../types/connected";
import type { QueryPlan } from "@dredge/schemas";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makePlan(overrides: Partial<QueryPlan> = {}): QueryPlan {
  return {
    category: "crime",
    date_from: "2025-01",
    date_to: "2025-01",
    location: "London, UK",
    ...overrides,
  };
}

function makeMemory(contextOverrides: Partial<import("../types/connected").QueryContext> = {}): ConversationMemory {
  return {
    context: {
      location: null,
      active_plan: null,
      result_stack: [],
      active_filters: {},
      ...contextOverrides,
    },
    profile: {
      user_attributes: {},
      location_history: [],
    },
  };
}

// ── detectRefinement ──────────────────────────────────────────────────────────

describe("detectRefinement", () => {
  it("returns null when there is no active plan", () => {
    expect(detectRefinement("just burglaries", null)).toBeNull();
  });

  it("detects date_shift", () => {
    expect(detectRefinement("show me the last 6 months", makePlan())).toBe("date_shift");
    expect(detectRefinement("past year", makePlan())).toBe("date_shift");
    expect(detectRefinement("previous 3 weeks", makePlan())).toBe("date_shift");
  });

  it("detects location_shift", () => {
    expect(detectRefinement("in Hackney", makePlan())).toBe("location_shift");
    expect(detectRefinement("near Bristol", makePlan())).toBe("location_shift");
  });

  it("detects category_filter", () => {
    expect(detectRefinement("just burglaries", makePlan())).toBe("category_filter");
    expect(detectRefinement("just comedy", makePlan())).toBe("category_filter");
  });

  it("detects aggregation_change", () => {
    expect(detectRefinement("group by month", makePlan())).toBe("aggregation_change");
    expect(detectRefinement("by week", makePlan())).toBe("aggregation_change");
  });

  it("returns null for unrelated text", () => {
    expect(detectRefinement("hello world", makePlan())).toBeNull();
    expect(detectRefinement("what is the weather", makePlan())).toBeNull();
  });
});

// ── applyRefinement ───────────────────────────────────────────────────────────

describe("applyRefinement", () => {
  describe("date_shift", () => {
    it("shifts date range back 6 months", () => {
      const plan = makePlan({ date_from: "2025-06", date_to: "2025-06" });
      const result = applyRefinement(plan, "date_shift", "last 6 months");
      expect(result).not.toBeNull();
      expect(result!.date_from).toBe("2024-12");
      expect(result!.date_to).toBe("2025-06");
    });

    it("shifts date range back 1 year", () => {
      const plan = makePlan({ date_from: "2025-03", date_to: "2025-03" });
      const result = applyRefinement(plan, "date_shift", "last year");
      expect(result).not.toBeNull();
      expect(result!.date_from).toBe("2024-03");
      expect(result!.date_to).toBe("2025-03");
    });

    it("shifts date range back 3 months", () => {
      const plan = makePlan({ date_from: "2025-04", date_to: "2025-04" });
      const result = applyRefinement(plan, "date_shift", "past 3 months");
      expect(result).not.toBeNull();
      expect(result!.date_from).toBe("2025-01");
      expect(result!.date_to).toBe("2025-04");
    });

    it("handles month rollover correctly", () => {
      const plan = makePlan({ date_from: "2025-02", date_to: "2025-02" });
      const result = applyRefinement(plan, "date_shift", "last 6 months");
      expect(result).not.toBeNull();
      expect(result!.date_from).toBe("2024-08");
      expect(result!.date_to).toBe("2025-02");
    });

    it("returns null for unrecognised date text", () => {
      const result = applyRefinement(makePlan(), "date_shift", "sometime recently");
      expect(result).toBeNull();
    });
  });

  describe("location_shift", () => {
    it("replaces location", () => {
      const plan = makePlan({ location: "London, UK" });
      const result = applyRefinement(plan, "location_shift", "in Hackney");
      expect(result).not.toBeNull();
      expect(result!.location).toBe("Hackney");
    });

    it("extracts location from 'near X'", () => {
      const plan = makePlan({ location: "London, UK" });
      const result = applyRefinement(plan, "location_shift", "near Bristol");
      expect(result!.location).toBe("Bristol");
    });

    it("returns null when no location word found", () => {
      const result = applyRefinement(makePlan(), "location_shift", "somewhere nice");
      expect(result).toBeNull();
    });
  });

  describe("category_filter", () => {
    it("updates category from 'just X'", () => {
      const plan = makePlan({ category: "all-crime" });
      const result = applyRefinement(plan, "category_filter", "just burglaries");
      expect(result).not.toBeNull();
      expect(result!.category).toBe("burglaries");
    });

    it("preserves other plan fields", () => {
      const plan = makePlan({ date_from: "2024-06", date_to: "2024-12" });
      const result = applyRefinement(plan, "category_filter", "just comedy");
      expect(result!.date_from).toBe("2024-06");
      expect(result!.date_to).toBe("2024-12");
      expect(result!.location).toBe(plan.location);
    });
  });

  describe("aggregation_change", () => {
    it("returns the plan unchanged (aggregation is a viz concern, not a plan concern)", () => {
      const plan = makePlan();
      const result = applyRefinement(plan, "aggregation_change", "by month");
      expect(result).toEqual(plan);
    });
  });
});

// ── matchTemplate ─────────────────────────────────────────────────────────────

describe("matchTemplate", () => {
  it("matches reachable-area template", () => {
    const match = matchTemplate("hunting zones within 2 hours of Edinburgh by train");
    expect(match).not.toBeNull();
    expect(match!.name).toBe("reachable-area");
  });

  it("matches itinerary template", () => {
    const match = matchTemplate("plan a day of activities in London");
    expect(match).not.toBeNull();
    expect(match!.name).toBe("itinerary");
  });

  it("matches cross-domain overlay template", () => {
    const match = matchTemplate("cycle routes and crime in Edinburgh");
    expect(match).not.toBeNull();
    expect(match!.name).toBe("cross-domain");
  });

  it("returns null for plain single-domain queries", () => {
    expect(matchTemplate("crime in London last month")).toBeNull();
    expect(matchTemplate("weather in Manchester")).toBeNull();
    expect(matchTemplate("flood warnings near Bristol")).toBeNull();
  });
});

// ── QueryRouter ───────────────────────────────────────────────────────────────

describe("QueryRouter", () => {
  let router: QueryRouter;

  beforeEach(() => {
    router = new QueryRouter();
  });

  it("returns refinement when active_plan exists and query matches a refinement pattern", async () => {
    const memory = makeMemory({
      active_plan: makePlan({ category: "all-crime", location: "London, UK" }),
    });
    const result = await router.route("just burglaries", memory);
    expect(result.type).toBe("refinement");
    if (result.type === "refinement") {
      expect(result.mergedPlan.category).toBe("burglaries");
    }
  });

  it("returns template when query matches a template pattern", async () => {
    const memory = makeMemory();
    const result = await router.route(
      "hunting zones within 2 hours of Edinburgh by train",
      memory,
    );
    expect(result.type).toBe("template");
    if (result.type === "template") {
      expect(result.template.name).toBe("reachable-area");
    }
  });

  it("template takes priority over refinement when both could match", async () => {
    // Active plan exists but query matches a template — template wins
    const memory = makeMemory({
      active_plan: makePlan(),
    });
    const result = await router.route(
      "plan a day of activities in London",
      memory,
    );
    expect(result.type).toBe("template");
  });

  it("returns fresh_query when no active_plan and no template match", async () => {
    const memory = makeMemory();
    const result = await router.route("crime in London last month", memory);
    expect(result.type).toBe("fresh_query");
  });

  it("returns fresh_query when refinement apply returns null (unresolvable merge)", async () => {
    const memory = makeMemory({
      active_plan: makePlan(),
    });
    // "last" matches date_shift but "sometime ago" can't be parsed to a duration
    const result = await router.route("data from sometime ago", memory);
    expect(result.type).toBe("fresh_query");
  });

  it("clears active_plan hint on fresh_query", async () => {
    const memory = makeMemory({ active_plan: makePlan() });
    const result = await router.route("what is the flood risk in York", memory);
    expect(result.type).toBe("fresh_query");
    // fresh_query signals the caller to clear active_plan
    if (result.type === "fresh_query") {
      expect(result.clearActivePlan).toBe(true);
    }
  });
});
