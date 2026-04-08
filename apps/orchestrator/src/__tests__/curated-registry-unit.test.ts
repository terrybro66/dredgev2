/**
 * curated-registry-unit.test.ts
 *
 * Unit tests for resolveLocationSlug and CuratedSource structure.
 * No mocks — imports the real module directly.
 *
 * Run:
 *   pnpm vitest run src/__tests__/curated-registry-unit.test.ts --reporter=verbose
 */

import { describe, it, expect } from "vitest";
import {
  resolveLocationSlug,
  findCuratedSource,
  CURATED_SOURCES,
} from "../curated-registry";

// ── resolveLocationSlug ───────────────────────────────────────────────────────

describe("resolveLocationSlug", () => {
  it("returns the slug when the place name matches a key in the map", () => {
    const slug = resolveLocationSlug("Braehead, Renfrewshire, Scotland", {
      braehead: "braehead",
      glasgow: "glasgow-fort",
    });
    expect(slug).toBe("braehead");
  });

  it("matching is case-insensitive", () => {
    const slug = resolveLocationSlug("BRAEHEAD, Renfrewshire", {
      braehead: "braehead",
    });
    expect(slug).toBe("braehead");
  });

  it("matches on substring — full geocoder display name contains the key", () => {
    const slug = resolveLocationSlug(
      "Glasgow Fort, Glasgow, Scotland, United Kingdom",
      { glasgow: "glasgow-fort" },
    );
    expect(slug).toBe("glasgow-fort");
  });

  it("returns null when no key matches the place name", () => {
    const slug = resolveLocationSlug("Edinburgh, City of Edinburgh, Scotland", {
      braehead: "braehead",
      glasgow: "glasgow-fort",
    });
    expect(slug).toBeNull();
  });

  it("returns null when locationSlugMap is empty", () => {
    const slug = resolveLocationSlug("Bristol, England", {});
    expect(slug).toBeNull();
  });

  it("prefers earlier keys when multiple keys match the same place name", () => {
    const slug = resolveLocationSlug("Glasgow City Centre, Glasgow, Scotland", {
      glasgow: "glasgow-city",
      gla: "gla-airport",
    });
    expect(slug).toBe("glasgow-city");
  });
});

// ── CuratedSource structure ───────────────────────────────────────────────────

describe("CuratedSource — structure", () => {
  it("all sources have intent, type, fieldMap, storeResults, and refreshPolicy", () => {
    for (const source of CURATED_SOURCES) {
      expect(source).toHaveProperty("intent");
      expect(source).toHaveProperty("type");
      expect(source).toHaveProperty("fieldMap");
      expect(source).toHaveProperty("storeResults");
      expect(source).toHaveProperty("refreshPolicy");
    }
  });

  it("non-scrape sources must have a url", () => {
    for (const source of CURATED_SOURCES.filter((s) => s.type !== "scrape")) {
      expect(source.url).toBeTruthy();
    }
  });

  it("scrape sources must have either a url or a searchStrategy", () => {
    for (const source of CURATED_SOURCES.filter((s) => s.type === "scrape")) {
      const hasUrl = Boolean(source.url);
      const hasStrategy = Boolean(source.searchStrategy);
      expect(hasUrl || hasStrategy).toBe(true);
    }
  });

  it("scrape sources with searchStrategy must have an extractionPrompt", () => {
    for (const source of CURATED_SOURCES.filter(
      (s) => s.type === "scrape" && s.searchStrategy,
    )) {
      expect(source.extractionPrompt).toBeTruthy();
    }
  });

  it("findCuratedSource returns a cinema source for GB", () => {
    const result = findCuratedSource("cinema listings", "GB");
    expect(result).not.toBeNull();
    expect(result?.storeResults).toBe(false);
    expect(result?.type).toBe("scrape");
  });

  it("cinema source uses searchStrategy, not a static URL", () => {
    const result = findCuratedSource("cinema listings", "GB");
    expect(result?.searchStrategy).toBeDefined();
    expect(result?.url).toBeUndefined();
  });
});
