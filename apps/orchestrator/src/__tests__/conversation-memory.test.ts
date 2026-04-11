/**
 * conversation-memory.test.ts — Phase C.8
 *
 * Tests for the ConversationMemory Redis store.
 * Redis is mocked — no live connection required.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock Redis ────────────────────────────────────────────────────────────────

const store = new Map<string, string>();
const hashes = new Map<string, Map<string, string>>();

const mockRedis = {
  get: vi.fn(async (k: string) => store.get(k) ?? null),
  set: vi.fn(async (k: string, v: string) => { store.set(k, v); return "OK"; }),
  expire: vi.fn(async () => 1),
  hset: vi.fn(async (k: string, field: string, v: string) => {
    if (!hashes.has(k)) hashes.set(k, new Map());
    hashes.get(k)!.set(field, v);
    return 1;
  }),
  hget: vi.fn(async (k: string, field: string) => hashes.get(k)?.get(field) ?? null),
  hdel: vi.fn(async (k: string, field: string) => {
    hashes.get(k)?.delete(field);
    return 1;
  }),
  del: vi.fn(async (k: string) => { hashes.delete(k); return 1; }),
};

vi.mock("../redis", () => ({ getRedisClient: () => mockRedis }));

// ── Import SUT after mock ─────────────────────────────────────────────────────

import {
  getQueryContext,
  setQueryContext,
  updateQueryContext,
  emptyContext,
  storeResultHandle,
  getResultHandle,
  deleteResultHandle,
  clearResultHandles,
  getUserProfile,
  setUserProfile,
  emptyProfile,
  loadMemory,
  createEphemeralHandle,
  pushResultHandle,
} from "../conversation-memory";
import type { QueryContext, ResultHandle, UserProfile } from "../types/connected";
import { RESULT_STACK_MAX, MAX_EPHEMERAL_ROWS } from "../types/connected";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const SESSION = "sess-abc";
const USER    = "user-xyz";

const baseContext: QueryContext = {
  location: { lat: 51.5, lon: -0.1, display_name: "London, UK", country_code: "GB" },
  active_plan: {
    category: "crime statistics",
    date_from: "2025-01",
    date_to: "2025-01",
    location: "London, UK",
  },
  result_stack: [],
  active_filters: { category: "burglary" },
};

const baseProfile: UserProfile = {
  user_attributes: { age: "35", residency: "UK" },
  location_history: [
    { lat: 51.5, lon: -0.1, display_name: "London, UK", country_code: "GB" },
  ],
};

const handle: ResultHandle = {
  id:           "qr_1",
  type:         "crime_incident",
  domain:       "crime-uk",
  capabilities: ["has_coordinates"],
  ephemeral:    false,
  rowCount:     42,
  data:         null,
};

beforeEach(() => {
  store.clear();
  hashes.clear();
  vi.clearAllMocks();
});

// ── QueryContext ──────────────────────────────────────────────────────────────

describe("QueryContext", () => {
  it("returns null when no context is stored", async () => {
    expect(await getQueryContext(SESSION)).toBeNull();
  });

  it("round-trips a QueryContext", async () => {
    await setQueryContext(SESSION, baseContext);
    const loaded = await getQueryContext(SESSION);
    expect(loaded).toMatchObject(baseContext);
  });

  it("sets TTL on write", async () => {
    await setQueryContext(SESSION, baseContext);
    expect(mockRedis.set).toHaveBeenCalledWith(
      expect.stringContaining(SESSION),
      expect.any(String),
      "EX",
      expect.any(Number),
    );
  });

  it("updateQueryContext merges partial update", async () => {
    await setQueryContext(SESSION, baseContext);
    await updateQueryContext(SESSION, { active_filters: { category: "robbery" } });
    const loaded = await getQueryContext(SESSION);
    expect(loaded?.active_filters.category).toBe("robbery");
    expect(loaded?.location).toEqual(baseContext.location);
  });

  it("updateQueryContext on missing key uses empty defaults", async () => {
    await updateQueryContext(SESSION, { active_filters: { category: "robbery" } });
    const loaded = await getQueryContext(SESSION);
    expect(loaded?.active_filters.category).toBe("robbery");
    expect(loaded?.result_stack).toEqual([]);
  });

  it("result_stack is capped at RESULT_STACK_MAX", async () => {
    const overflowContext: QueryContext = {
      ...baseContext,
      result_stack: Array.from({ length: RESULT_STACK_MAX + 3 }, (_, i) => ({
        ...handle,
        id: `qr_${i}`,
      })),
    };
    await setQueryContext(SESSION, overflowContext);
    const loaded = await getQueryContext(SESSION);
    expect(loaded?.result_stack.length).toBe(RESULT_STACK_MAX);
  });

  it("active_filters are capped at 20 pairs", async () => {
    const manyFilters = Object.fromEntries(
      Array.from({ length: 25 }, (_, i) => [`key${i}`, `val${i}`]),
    );
    await setQueryContext(SESSION, { ...baseContext, active_filters: manyFilters });
    const loaded = await getQueryContext(SESSION);
    expect(Object.keys(loaded!.active_filters).length).toBe(20);
  });
});

// ── ResultHandle storage ──────────────────────────────────────────────────────

describe("ResultHandle storage", () => {
  it("stores and retrieves a handle", async () => {
    await storeResultHandle(SESSION, handle);
    const loaded = await getResultHandle(SESSION, handle.id);
    expect(loaded).toMatchObject(handle);
  });

  it("returns null for missing handle", async () => {
    expect(await getResultHandle(SESSION, "nonexistent")).toBeNull();
  });

  it("deleteResultHandle removes a single handle", async () => {
    await storeResultHandle(SESSION, handle);
    await deleteResultHandle(SESSION, handle.id);
    expect(await getResultHandle(SESSION, handle.id)).toBeNull();
  });

  it("clearResultHandles removes all handles for the session", async () => {
    await storeResultHandle(SESSION, handle);
    await storeResultHandle(SESSION, { ...handle, id: "qr_2" });
    await clearResultHandles(SESSION);
    expect(await getResultHandle(SESSION, handle.id)).toBeNull();
    expect(await getResultHandle(SESSION, "qr_2")).toBeNull();
  });

  it("sets TTL on the handles hash", async () => {
    await storeResultHandle(SESSION, handle);
    expect(mockRedis.expire).toHaveBeenCalledWith(
      expect.stringContaining(SESSION),
      expect.any(Number),
    );
  });
});

// ── UserProfile ───────────────────────────────────────────────────────────────

describe("UserProfile", () => {
  it("returns null when no profile is stored", async () => {
    expect(await getUserProfile(USER)).toBeNull();
  });

  it("round-trips a UserProfile", async () => {
    await setUserProfile(USER, baseProfile);
    const loaded = await getUserProfile(USER);
    expect(loaded).toMatchObject(baseProfile);
  });

  it("refreshes TTL on read", async () => {
    await setUserProfile(USER, baseProfile);
    vi.clearAllMocks();
    await getUserProfile(USER);
    expect(mockRedis.expire).toHaveBeenCalled();
  });

  it("user_attributes are capped at 50 pairs", async () => {
    const manyAttrs = Object.fromEntries(
      Array.from({ length: 55 }, (_, i) => [`attr${i}`, `val${i}`]),
    );
    await setUserProfile(USER, { ...baseProfile, user_attributes: manyAttrs });
    const loaded = await getUserProfile(USER);
    expect(Object.keys(loaded!.user_attributes).length).toBe(50);
  });

  it("location_history is capped at 10 entries", async () => {
    const loc = { lat: 51, lon: 0, display_name: "UK", country_code: "GB" };
    const manyLocs = Array.from({ length: 15 }, () => loc);
    await setUserProfile(USER, { ...baseProfile, location_history: manyLocs });
    const loaded = await getUserProfile(USER);
    expect(loaded!.location_history.length).toBe(10);
  });
});

// ── loadMemory ────────────────────────────────────────────────────────────────

describe("loadMemory", () => {
  it("returns empty defaults when nothing is stored", async () => {
    const mem = await loadMemory(SESSION, USER);
    expect(mem.context).toEqual(emptyContext());
    expect(mem.profile).toEqual(emptyProfile());
  });

  it("returns stored context and profile together", async () => {
    await setQueryContext(SESSION, baseContext);
    await setUserProfile(USER, baseProfile);
    const mem = await loadMemory(SESSION, USER);
    expect(mem.context).toMatchObject(baseContext);
    expect(mem.profile).toMatchObject(baseProfile);
  });

  it("returns empty profile when userId is not provided", async () => {
    await setQueryContext(SESSION, baseContext);
    const mem = await loadMemory(SESSION);
    expect(mem.context).toMatchObject(baseContext);
    expect(mem.profile).toEqual(emptyProfile());
  });
});

// ── createEphemeralHandle — C.9 ───────────────────────────────────────────────

describe("createEphemeralHandle", () => {
  const rows = Array.from({ length: 5 }, (_, i) => ({
    lat: 51 + i * 0.01,
    lon: -0.1,
    description: `Row ${i}`,
  }));

  it("creates a handle with ephemeral: true", () => {
    const h = createEphemeralHandle(rows, "cinema-listings");
    expect(h.ephemeral).toBe(true);
  });

  it("id starts with 'ephemeral_'", () => {
    const h = createEphemeralHandle(rows, "cinema-listings");
    expect(h.id).toMatch(/^ephemeral_/);
  });

  it("sets domain and rowCount correctly", () => {
    const h = createEphemeralHandle(rows, "cinema-listings");
    expect(h.domain).toBe("cinema-listings");
    expect(h.rowCount).toBe(rows.length);
  });

  it("data contains the rows", () => {
    const h = createEphemeralHandle(rows, "cinema-listings");
    expect(h.data).toHaveLength(rows.length);
  });

  it("caps data at MAX_EPHEMERAL_ROWS", () => {
    const bigRows = Array.from({ length: MAX_EPHEMERAL_ROWS + 20 }, (_, i) => ({
      id: i,
    }));
    const h = createEphemeralHandle(bigRows, "test-domain");
    expect(h.rowCount).toBe(MAX_EPHEMERAL_ROWS);
    expect(h.data!.length).toBe(MAX_EPHEMERAL_ROWS);
  });

  it("infers capabilities from rows (has_coordinates for lat/lon rows)", () => {
    const h = createEphemeralHandle(rows, "cinema-listings");
    expect(h.capabilities).toContain("has_coordinates");
  });

  it("produces unique ids on each call", () => {
    const ids = new Set(Array.from({ length: 5 }, () =>
      createEphemeralHandle(rows, "test").id,
    ));
    expect(ids.size).toBe(5);
  });
});

// ── pushResultHandle — C.9 ────────────────────────────────────────────────────

describe("pushResultHandle", () => {
  const makeHandle = (id: string, ephemeral = false): ResultHandle => ({
    id,
    type:         "test",
    domain:       "test-domain",
    capabilities: [],
    ephemeral,
    rowCount:     1,
    data:         ephemeral ? [{ id }] : null,
  });

  it("adds handle to result_stack (newest first)", async () => {
    const h = makeHandle("h1");
    await pushResultHandle(SESSION, h);
    const ctx = await getQueryContext(SESSION);
    expect(ctx?.result_stack[0].id).toBe("h1");
  });

  it("newer handles appear before older ones", async () => {
    await pushResultHandle(SESSION, makeHandle("h1"));
    await pushResultHandle(SESSION, makeHandle("h2"));
    const ctx = await getQueryContext(SESSION);
    expect(ctx?.result_stack[0].id).toBe("h2");
    expect(ctx?.result_stack[1].id).toBe("h1");
  });

  it("evicts oldest handle when stack exceeds RESULT_STACK_MAX", async () => {
    for (let i = 1; i <= RESULT_STACK_MAX + 1; i++) {
      await pushResultHandle(SESSION, makeHandle(`h${i}`));
    }
    const ctx = await getQueryContext(SESSION);
    expect(ctx?.result_stack.length).toBe(RESULT_STACK_MAX);
    // oldest (h1) should be gone
    const ids = ctx!.result_stack.map((h) => h.id);
    expect(ids).not.toContain("h1");
  });

  it("deletes evicted ephemeral handle from Redis hash", async () => {
    const ephemeral = makeHandle("eph1", true);
    await pushResultHandle(SESSION, ephemeral);
    // Fill stack to force eviction of eph1
    for (let i = 2; i <= RESULT_STACK_MAX + 1; i++) {
      await pushResultHandle(SESSION, makeHandle(`h${i}`));
    }
    // eph1 should be removed from the handles hash
    expect(await getResultHandle(SESSION, "eph1")).toBeNull();
  });

  it("stores ephemeral handle data in Redis hash", async () => {
    const ephemeral = makeHandle("eph2", true);
    await pushResultHandle(SESSION, ephemeral);
    const stored = await getResultHandle(SESSION, "eph2");
    expect(stored).not.toBeNull();
    expect(stored?.id).toBe("eph2");
  });

  it("strips data from stack entries in context (keeps context small)", async () => {
    const ephemeral = makeHandle("eph3", true);
    await pushResultHandle(SESSION, ephemeral);
    const ctx = await getQueryContext(SESSION);
    const entry = ctx?.result_stack.find((h) => h.id === "eph3");
    expect(entry?.data).toBeNull();
  });
});

// ── A2: Redis failure logging ─────────────────────────────────────────────────

describe("Redis failure logging (A2)", () => {
  const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

  beforeEach(() => {
    warnSpy.mockClear();
    errorSpy.mockClear();
    mockRedis.get.mockResolvedValue(null);
    mockRedis.set.mockResolvedValue("OK");
  });

  it("emits redis_read_error when getQueryContext Redis call throws", async () => {
    mockRedis.get.mockRejectedValueOnce(new Error("ECONNRESET"));
    await getQueryContext("session-fail");
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('"event":"redis_read_error"'),
    );
    const logged = JSON.parse(warnSpy.mock.calls[0][0] as string);
    expect(logged.key).toBe("QueryContext");
    expect(logged.error).toContain("ECONNRESET");
  });

  it("emits redis_write_error when setQueryContext Redis call throws", async () => {
    mockRedis.set.mockRejectedValueOnce(new Error("READONLY"));
    await setQueryContext("session-fail", emptyContext());
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('"event":"redis_write_error"'),
    );
    const logged = JSON.parse(warnSpy.mock.calls[0][0] as string);
    expect(logged.key).toBe("QueryContext");
    expect(logged.error).toContain("READONLY");
  });

  it("emits session_payload_too_large when QueryContext exceeds size limit", async () => {
    // Build a context that exceeds 64 KB
    const bigFilters: Record<string, string> = {};
    for (let i = 0; i < 20; i++) {
      bigFilters[`key_${i}`] = "x".repeat(2_000);
    }
    const bigCtx = { ...emptyContext(), active_filters: bigFilters };
    // Force the size check to fail by passing an oversized serialised context directly
    // We'll do this by mocking Buffer.byteLength to return over the limit
    const origByteLength = Buffer.byteLength.bind(Buffer);
    vi.spyOn(Buffer, "byteLength").mockImplementationOnce(() => 65 * 1024);
    await setQueryContext("session-big", bigCtx);
    vi.restoreAllMocks();
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('"event":"session_payload_too_large"'),
    );
  });

  it("emits redis_read_error when getUserProfile Redis call throws", async () => {
    mockRedis.get.mockRejectedValueOnce(new Error("ETIMEDOUT"));
    await getUserProfile("user-fail");
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('"event":"redis_read_error"'),
    );
    const logged = JSON.parse(warnSpy.mock.calls[0][0] as string);
    expect(logged.key).toBe("UserProfile");
  });

  it("emits redis_write_error when setUserProfile Redis call throws", async () => {
    mockRedis.set.mockRejectedValueOnce(new Error("OOM"));
    await setUserProfile("user-fail", emptyProfile());
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('"event":"redis_write_error"'),
    );
    const logged = JSON.parse(warnSpy.mock.calls[0][0] as string);
    expect(logged.key).toBe("UserProfile");
  });
});
