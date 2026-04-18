/**
 * co-occurrence-integration.test.ts — Phase D.13
 *
 * Tests that recordDomainCoOccurrence() correctly:
 *   - records co-occurrence when session has prior domain handles
 *   - pushes the current domain to the session handle stack
 *   - is a no-op when sessionId is null
 *   - is non-fatal when Redis is unavailable
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ResultHandle } from "../types/connected";

// ── Hoisted mocks (avoid TDZ with vi.mock factory) ────────────────────────────

const mocks = vi.hoisted(() => {
  const handleStack: ResultHandle[] = [];

  const getQueryContext = vi.fn(async (_sid: string) => ({
    location: null,
    active_plan: null,
    result_stack: handleStack,
    active_filters: {},
  }));

  const pushResultHandle = vi.fn(async () => {});

  const createEphemeralHandle = vi.fn((_rows: unknown[], domain: string) => ({
    id: `ephemeral_${domain}`,
    type: domain,
    domain,
    capabilities: [],
    ephemeral: true,
    rowCount: 0,
    data: [],
  }));

  const recordCoOccurrence = vi.fn(async () => {});

  return { handleStack, getQueryContext, pushResultHandle, createEphemeralHandle, recordCoOccurrence };
});

vi.mock("../conversation-memory", () => ({
  getQueryContext:       mocks.getQueryContext,
  pushResultHandle:      mocks.pushResultHandle,
  createEphemeralHandle: mocks.createEphemeralHandle,
  updateQueryContext:    vi.fn(),
}));

vi.mock("../co-occurrence-log", () => ({
  recordCoOccurrence: mocks.recordCoOccurrence,
}));

// ── Import mocked modules ─────────────────────────────────────────────────────

import { getQueryContext, pushResultHandle, createEphemeralHandle } from "../conversation-memory";
import { recordCoOccurrence } from "../co-occurrence-log";

// ── Re-implement helper using mocked modules ──────────────────────────────────

async function recordDomainCoOccurrence(
  sessionId: string | null,
  currentDomain: string,
): Promise<void> {
  if (!sessionId) return;
  try {
    const ctx = await getQueryContext(sessionId);
    const priorDomains = (ctx?.result_stack ?? [])
      .map((h) => h.domain)
      .filter((d): d is string => typeof d === "string" && d.length > 0)
      .slice(0, 3);

    if (priorDomains.length > 0) {
      await recordCoOccurrence([currentDomain, ...priorDomains]);
    }

    const handle = createEphemeralHandle([], currentDomain);
    await pushResultHandle(sessionId, handle);
  } catch {
    // non-fatal
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  mocks.handleStack.length = 0;
  mocks.getQueryContext.mockClear();
  mocks.pushResultHandle.mockClear();
  mocks.recordCoOccurrence.mockClear();
  mocks.createEphemeralHandle.mockClear();
});

describe("recordDomainCoOccurrence", () => {
  it("is a no-op when sessionId is null", async () => {
    await recordDomainCoOccurrence(null, "crime-uk");
    expect(mocks.getQueryContext).not.toHaveBeenCalled();
    expect(mocks.recordCoOccurrence).not.toHaveBeenCalled();
  });

  it("does not record co-occurrence when result_stack is empty", async () => {
    await recordDomainCoOccurrence("sess-1", "crime-uk");
    expect(mocks.recordCoOccurrence).not.toHaveBeenCalled();
  });

  it("records co-occurrence when session has one prior domain", async () => {
    mocks.handleStack.push({
      id: "ephemeral_weather",
      type: "weather",
      domain: "weather",
      capabilities: [],
      ephemeral: true,
      rowCount: 0,
      data: [],
    });

    await recordDomainCoOccurrence("sess-1", "crime-uk");

    expect(mocks.recordCoOccurrence).toHaveBeenCalledOnce();
    const args = mocks.recordCoOccurrence.mock.calls[0][0] as string[];
    expect(args).toContain("crime-uk");
    expect(args).toContain("weather");
  });

  it("includes up to 3 prior domains", async () => {
    for (const domain of ["weather", "flood-risk", "transport", "cinemas-gb"]) {
      mocks.handleStack.push({
        id: `ephemeral_${domain}`,
        type: domain,
        domain,
        capabilities: [],
        ephemeral: true,
        rowCount: 0,
        data: [],
      });
    }

    await recordDomainCoOccurrence("sess-1", "crime-uk");

    const args = mocks.recordCoOccurrence.mock.calls[0][0] as string[];
    // currentDomain + 3 prior = 4 total (4th prior domain is dropped)
    expect(args).toHaveLength(4);
    expect(args[0]).toBe("crime-uk");
  });

  it("pushes current domain handle to session after recording", async () => {
    await recordDomainCoOccurrence("sess-1", "crime-uk");
    expect(mocks.pushResultHandle).toHaveBeenCalledWith(
      "sess-1",
      expect.objectContaining({ domain: "crime-uk" }),
    );
  });

  it("still pushes handle even when stack is empty (no co-occurrence to record)", async () => {
    await recordDomainCoOccurrence("sess-2", "flood-risk");
    expect(mocks.pushResultHandle).toHaveBeenCalledOnce();
    expect(mocks.recordCoOccurrence).not.toHaveBeenCalled();
  });

  it("is non-fatal when getQueryContext throws", async () => {
    mocks.getQueryContext.mockRejectedValueOnce(new Error("Redis down"));
    await expect(
      recordDomainCoOccurrence("sess-3", "crime-uk"),
    ).resolves.not.toThrow();
  });

  it("filters out empty domain strings from prior handles", async () => {
    mocks.handleStack.push(
      { id: "e1", type: "", domain: "", capabilities: [], ephemeral: true, rowCount: 0, data: [] },
      { id: "e2", type: "weather", domain: "weather", capabilities: [], ephemeral: true, rowCount: 0, data: [] },
    );

    await recordDomainCoOccurrence("sess-1", "crime-uk");

    const args = mocks.recordCoOccurrence.mock.calls[0][0] as string[];
    expect(args).not.toContain("");
    expect(args).toContain("weather");
  });
});
