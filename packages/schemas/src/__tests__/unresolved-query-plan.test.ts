import { describe, it, expect } from "vitest";
import { UnresolvedQueryPlanSchema, QueryPlanSchema } from "../index";

describe("UnresolvedQueryPlanSchema", () => {
  // ── Valid cases ─────────────────────────────────────────────────────────────

  it("accepts a valid unresolved plan with temporal string", () => {
    const result = UnresolvedQueryPlanSchema.safeParse({
      category: "burglary",
      temporal: "last month",
      location: "Cambridge, UK",
    });
    expect(result.success).toBe(true);
  });

  it("accepts 'unspecified' as temporal", () => {
    const result = UnresolvedQueryPlanSchema.safeParse({
      category: "crime statistics",
      temporal: "unspecified",
      location: "Leeds, UK",
    });
    expect(result.success).toBe(true);
  });

  it("accepts 'last 3 months' as temporal", () => {
    const result = UnresolvedQueryPlanSchema.safeParse({
      category: "burglary",
      temporal: "last 3 months",
      location: "Bristol, UK",
    });
    expect(result.success).toBe(true);
  });

  it("accepts a YYYY-MM passthrough string as temporal", () => {
    const result = UnresolvedQueryPlanSchema.safeParse({
      category: "burglary",
      temporal: "2024-03",
      location: "Manchester, UK",
    });
    expect(result.success).toBe(true);
  });

  it("accepts 'January 2026' as temporal", () => {
    const result = UnresolvedQueryPlanSchema.safeParse({
      category: "weather forecast",
      temporal: "January 2026",
      location: "London, UK",
    });
    expect(result.success).toBe(true);
  });

  // ── Field presence ──────────────────────────────────────────────────────────

  it("rejects when temporal is missing", () => {
    const result = UnresolvedQueryPlanSchema.safeParse({
      category: "burglary",
      location: "Cambridge, UK",
    });
    expect(result.success).toBe(false);
  });

  it("rejects when category is missing", () => {
    const result = UnresolvedQueryPlanSchema.safeParse({
      temporal: "last month",
      location: "Cambridge, UK",
    });
    expect(result.success).toBe(false);
  });

  it("rejects when location is missing", () => {
    const result = UnresolvedQueryPlanSchema.safeParse({
      category: "burglary",
      temporal: "last month",
    });
    expect(result.success).toBe(false);
  });

  // ── Field constraints ───────────────────────────────────────────────────────

  it("rejects when temporal is an empty string", () => {
    const result = UnresolvedQueryPlanSchema.safeParse({
      category: "burglary",
      temporal: "",
      location: "Cambridge, UK",
    });
    expect(result.success).toBe(false);
  });

  it("rejects when category is an empty string", () => {
    const result = UnresolvedQueryPlanSchema.safeParse({
      category: "",
      temporal: "last month",
      location: "Cambridge, UK",
    });
    expect(result.success).toBe(false);
  });

  it("rejects when location is an empty string", () => {
    const result = UnresolvedQueryPlanSchema.safeParse({
      category: "burglary",
      temporal: "last month",
      location: "",
    });
    expect(result.success).toBe(false);
  });

  // ── No date_from / date_to ──────────────────────────────────────────────────

  it("does not include date_from in parsed output", () => {
    const result = UnresolvedQueryPlanSchema.safeParse({
      category: "burglary",
      temporal: "last month",
      location: "Cambridge, UK",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).not.toHaveProperty("date_from");
    }
  });

  it("does not include date_to in parsed output", () => {
    const result = UnresolvedQueryPlanSchema.safeParse({
      category: "burglary",
      temporal: "last month",
      location: "Cambridge, UK",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).not.toHaveProperty("date_to");
    }
  });

  it("strips date_from if passed in (strict shape)", () => {
    // Zod strips unknown keys by default — date_from should not appear in output
    const result = UnresolvedQueryPlanSchema.safeParse({
      category: "burglary",
      temporal: "last month",
      location: "Cambridge, UK",
      date_from: "2024-01",
      date_to: "2024-01",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).not.toHaveProperty("date_from");
      expect(result.data).not.toHaveProperty("date_to");
    }
  });

  // ── Type export ─────────────────────────────────────────────────────────────

  it("inferred type has exactly category, temporal, location", () => {
    // Compile-time shape check via assignment — if the type is wrong this file won't compile
    const plan: import("../index").UnresolvedQueryPlan = {
      category: "burglary",
      temporal: "last month",
      location: "Cambridge, UK",
    };
    expect(plan.temporal).toBe("last month");
  });

  // ── Existing QueryPlanSchema unaffected ─────────────────────────────────────

  it("existing QueryPlanSchema still requires date_from and date_to", () => {
    const result = QueryPlanSchema.safeParse({
      category: "burglary",
      temporal: "last month",
      location: "Cambridge, UK",
    });
    expect(result.success).toBe(false);
  });

  it("existing QueryPlanSchema still accepts a fully resolved plan", () => {
    const result = QueryPlanSchema.safeParse({
      category: "burglary",
      date_from: "2024-01",
      date_to: "2024-01",
      location: "Cambridge, UK",
    });
    expect(result.success).toBe(true);
  });
});
