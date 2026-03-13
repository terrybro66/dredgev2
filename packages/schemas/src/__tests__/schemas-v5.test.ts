import { describe, it, expect } from "vitest";

import {
  FollowUpSchema,
  FallbackInfoSchema,
  ResultContextSchema,
} from "@dredge/schemas";

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const validQueryPlan = {
  category: "burglary",
  date_from: "2024-01",
  date_to: "2024-01",
  location: "Cambridge, UK",
};

// A fully-formed ExecuteBody (the `query` field of a FollowUp chip)
const validExecuteBody = {
  plan: validQueryPlan,
  poly: "52.0,0.0:52.1,0.1:52.2,0.0",
  viz_hint: "map" as const,
  resolved_location: "Cambridge, Cambridgeshire, England",
  country_code: "GB",
  intent: "crime",
  months: ["2024-01"],
};

const validFollowUp = {
  label: "See last 6 months",
  query: validExecuteBody,
};

const validFallbackInfo = {
  field: "date" as const,
  original: "2026-03",
  used: "2025-10",
  explanation: "No data for March 2026 — showing October 2025 instead",
};

const validResultContext = {
  status: "exact" as const,
  followUps: [],
  confidence: "high" as const,
};

// ---------------------------------------------------------------------------
// FollowUpSchema
// ---------------------------------------------------------------------------

describe("FollowUpSchema", () => {
  it("valid object with label and a fully-formed query passes", () => {
    expect(() => FollowUpSchema.parse(validFollowUp)).not.toThrow();
  });

  it("missing label throws a Zod error", () => {
    const { label: _label, ...rest } = validFollowUp;
    expect(() => FollowUpSchema.parse(rest)).toThrow();
  });

  it("missing query throws a Zod error", () => {
    const { query: _query, ...rest } = validFollowUp;
    expect(() => FollowUpSchema.parse(rest)).toThrow();
  });

  it("query with an unknown extra field passes (strip behaviour)", () => {
    expect(() =>
      FollowUpSchema.parse({
        ...validFollowUp,
        query: { ...validExecuteBody, undocumented_field: "surprise" },
      }),
    ).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// FallbackInfoSchema
// ---------------------------------------------------------------------------

describe("FallbackInfoSchema", () => {
  it('field: "date" is valid', () => {
    expect(() =>
      FallbackInfoSchema.parse({ ...validFallbackInfo, field: "date" }),
    ).not.toThrow();
  });

  it('field: "location" is valid', () => {
    expect(() =>
      FallbackInfoSchema.parse({ ...validFallbackInfo, field: "location" }),
    ).not.toThrow();
  });

  it('field: "category" is valid', () => {
    expect(() =>
      FallbackInfoSchema.parse({ ...validFallbackInfo, field: "category" }),
    ).not.toThrow();
  });

  it('field: "radius" is valid', () => {
    expect(() =>
      FallbackInfoSchema.parse({ ...validFallbackInfo, field: "radius" }),
    ).not.toThrow();
  });

  it('field: "unknown" throws a Zod error', () => {
    expect(() =>
      FallbackInfoSchema.parse({ ...validFallbackInfo, field: "unknown" }),
    ).toThrow();
  });

  it("all four string fields present — passes", () => {
    const result = FallbackInfoSchema.parse(validFallbackInfo);
    expect(result.original).toBe("2026-03");
    expect(result.used).toBe("2025-10");
    expect(result.explanation).toBeTypeOf("string");
  });

  it("missing original — throws", () => {
    const { original: _o, ...rest } = validFallbackInfo;
    expect(() => FallbackInfoSchema.parse(rest)).toThrow();
  });

  it("missing used — throws", () => {
    const { used: _u, ...rest } = validFallbackInfo;
    expect(() => FallbackInfoSchema.parse(rest)).toThrow();
  });

  it("missing explanation — throws", () => {
    const { explanation: _e, ...rest } = validFallbackInfo;
    expect(() => FallbackInfoSchema.parse(rest)).toThrow();
  });

  it("missing field — throws", () => {
    const { field: _f, ...rest } = validFallbackInfo;
    expect(() => FallbackInfoSchema.parse(rest)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// ResultContextSchema
// ---------------------------------------------------------------------------

describe("ResultContextSchema", () => {
  it('status: "exact" with no reason and empty followUps — passes', () => {
    const result = ResultContextSchema.parse(validResultContext);
    expect(result.status).toBe("exact");
    expect(result.followUps).toHaveLength(0);
    expect(result.reason).toBeUndefined();
  });

  it('status: "fallback" with a valid fallback object — passes', () => {
    expect(() =>
      ResultContextSchema.parse({
        ...validResultContext,
        status: "fallback",
        fallback: validFallbackInfo,
        confidence: "medium",
      }),
    ).not.toThrow();
  });

  it('status: "empty" with a reason string — passes', () => {
    const result = ResultContextSchema.parse({
      ...validResultContext,
      status: "empty",
      reason: "No crimes recorded in this area for the selected period",
      confidence: "low",
    });
    expect(result.status).toBe("empty");
    expect(result.reason).toBe(
      "No crimes recorded in this area for the selected period",
    );
  });

  it('confidence: "high" passes; confidence: "unknown" throws', () => {
    expect(() =>
      ResultContextSchema.parse({ ...validResultContext, confidence: "high" }),
    ).not.toThrow();

    expect(() =>
      ResultContextSchema.parse({
        ...validResultContext,
        confidence: "unknown",
      }),
    ).toThrow();
  });

  it("followUps containing an invalid chip — throws", () => {
    expect(() =>
      ResultContextSchema.parse({
        ...validResultContext,
        followUps: [{ label: "Missing query field" }],
      }),
    ).toThrow();
  });

  it("fallback present but with invalid field value — throws", () => {
    expect(() =>
      ResultContextSchema.parse({
        ...validResultContext,
        status: "fallback",
        fallback: { ...validFallbackInfo, field: "postcode" },
      }),
    ).toThrow();
  });

  it("reason field is truly optional — absent passes, present passes", () => {
    expect(() =>
      ResultContextSchema.parse({ ...validResultContext }),
    ).not.toThrow();

    expect(() =>
      ResultContextSchema.parse({ ...validResultContext, reason: "Some reason" }),
    ).not.toThrow();
  });

  it("fallback field is truly optional — absent passes, present passes", () => {
    expect(() =>
      ResultContextSchema.parse({ ...validResultContext }),
    ).not.toThrow();

    expect(() =>
      ResultContextSchema.parse({
        ...validResultContext,
        status: "fallback",
        fallback: validFallbackInfo,
      }),
    ).not.toThrow();
  });
});