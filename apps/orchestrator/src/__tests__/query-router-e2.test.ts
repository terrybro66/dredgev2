/**
 * query-router-e2.test.ts — Phase E.2
 *
 * Tests for the upgraded QueryRouter.route() with Tier 3 similarity routing:
 *   - returns similarity_route when classifier returns high-confidence domain
 *   - falls through to fresh_query when classifier confidence is below threshold
 *   - falls through to fresh_query when classifier throws
 *   - Tier 1 and Tier 2 still take priority over similarity
 *   - prisma=undefined skips classifier entirely
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { QueryRouter } from "../query-router";
import type { ConversationMemory } from "../types/connected";
import type { QueryPlan } from "@dredge/schemas";

// ── Mock classifier ───────────────────────────────────────────────────────────

const { mockClassifyIntent, mockGenerateEmbedding } = vi.hoisted(() => ({
  mockClassifyIntent: vi.fn(),
  mockGenerateEmbedding: vi.fn(async () => new Array(1536).fill(0.1)),
}));

vi.mock("../semantic/classifier", () => ({
  classifyIntent: mockClassifyIntent,
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeMemory(plan: QueryPlan | null = null): ConversationMemory {
  return {
    context: {
      location: null,
      active_plan: plan,
      result_stack: [],
      active_filters: {},
    },
    profile: { user_attributes: {}, location_history: [] },
  };
}

function makePlan(overrides: Partial<QueryPlan> = {}): QueryPlan {
  return {
    category: "crime",
    date_from: "2025-01",
    date_to: "2025-01",
    location: "London",
    ...overrides,
  };
}

const fakePrisma = {} as any;

// ── Tests ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  mockClassifyIntent.mockClear();
});

describe("QueryRouter.route — Tier 3 similarity routing (E.2)", () => {
  it("returns similarity_route when classifier confidence ≥ 0.65", async () => {
    mockClassifyIntent.mockResolvedValueOnce({
      domain: "crime-uk",
      intent: "crime",
      confidence: 0.82,
    });

    const router = new QueryRouter();
    const result = await router.route(
      "burglaries near me",
      makeMemory(),
      fakePrisma,
    );

    expect(result.type).toBe("similarity_route");
    if (result.type === "similarity_route") {
      expect(result.domain).toBe("crime-uk");
      expect(result.intent).toBe("crime");
      expect(result.confidence).toBeCloseTo(0.82);
    }
  });

  it("returns fresh_query when confidence is below threshold (0.65)", async () => {
    mockClassifyIntent.mockResolvedValueOnce({
      domain: "crime-uk",
      intent: "crime",
      confidence: 0.5,
    });

    const router = new QueryRouter();
    const result = await router.route(
      "something vague",
      makeMemory(),
      fakePrisma,
    );

    expect(result.type).toBe("fresh_query");
  });

  it("returns fresh_query when classifier returns null domain", async () => {
    mockClassifyIntent.mockResolvedValueOnce({
      domain: null,
      intent: "unknown",
      confidence: 0,
    });

    const router = new QueryRouter();
    const result = await router.route(
      "something unrecognised",
      makeMemory(),
      fakePrisma,
    );

    expect(result.type).toBe("fresh_query");
  });

  it("returns fresh_query when classifier throws", async () => {
    mockClassifyIntent.mockRejectedValueOnce(new Error("pgvector unavailable"));

    const router = new QueryRouter();
    const result = await router.route(
      "crime in Leeds",
      makeMemory(),
      fakePrisma,
    );

    expect(result.type).toBe("fresh_query");
  });

  it("skips classifier entirely when prisma is undefined", async () => {
    const router = new QueryRouter();
    const result = await router.route("crime in Leeds", makeMemory());

    expect(result.type).toBe("fresh_query");
    expect(mockClassifyIntent).not.toHaveBeenCalled();
  });

  it("Tier 1 template takes priority over similarity", async () => {
    mockClassifyIntent.mockResolvedValueOnce({
      domain: "transport",
      intent: "transport",
      confidence: 0.9,
    });

    const router = new QueryRouter();
    const result = await router.route(
      "within 30 minutes of London",
      makeMemory(),
      fakePrisma,
    );

    expect(result.type).toBe("template");
    expect(mockClassifyIntent).not.toHaveBeenCalled();
  });

  it("Tier 2 refinement takes priority over similarity", async () => {
    mockClassifyIntent.mockResolvedValueOnce({
      domain: "crime-uk",
      intent: "crime",
      confidence: 0.9,
    });

    const router = new QueryRouter();
    const result = await router.route(
      "just burglaries",
      makeMemory(makePlan()),
      fakePrisma,
    );

    expect(result.type).toBe("refinement");
    expect(mockClassifyIntent).not.toHaveBeenCalled();
  });
});

// ── pattern-store tests ───────────────────────────────────────────────────────

import { recordSuccessfulPattern } from "../semantic/pattern-store";

vi.mock("../semantic/embedding", () => ({
  generateEmbedding: mockGenerateEmbedding,
}));

describe("recordSuccessfulPattern", () => {
  const makeDb = (existingCount = 0) => ({
    $queryRaw: vi.fn(async () => (existingCount > 0 ? [{ id: "exists" }] : [])),
    $executeRawUnsafe: vi.fn(async () => {}),
  });

  it("stores embedding for a new pattern", async () => {
    const db = makeDb(0);
    await recordSuccessfulPattern("crime in Bristol", "crime-uk", db);
    expect(db.$executeRawUnsafe).toHaveBeenCalledTimes(2); // DELETE + INSERT
  });

  it("skips if pattern already exists", async () => {
    const db = makeDb(1);
    await recordSuccessfulPattern("crime in Bristol", "crime-uk", db);
    expect(db.$executeRawUnsafe).not.toHaveBeenCalled();
  });

  it("is a no-op for empty query", async () => {
    const db = makeDb(0);
    await recordSuccessfulPattern("", "crime-uk", db);
    expect(db.$queryRaw).not.toHaveBeenCalled();
  });

  it("is a no-op for empty domain", async () => {
    const db = makeDb(0);
    await recordSuccessfulPattern("crime in Leeds", "", db);
    expect(db.$queryRaw).not.toHaveBeenCalled();
  });

  it("does not throw when db throws", async () => {
    const db = {
      $queryRaw: vi.fn(async () => {
        throw new Error("db down");
      }),
      $executeRawUnsafe: vi.fn(),
    };
    await expect(
      recordSuccessfulPattern("crime in Leeds", "crime-uk", db),
    ).resolves.not.toThrow();
  });
});
