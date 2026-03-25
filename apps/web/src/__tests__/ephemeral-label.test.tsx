/**
 * Block 3.12 — Frontend ephemeral label
 *
 * Tests that ResultRenderer shows a "Live data · not saved" label
 * when the execute response has cache_hit: false and ephemeral: true
 * (or storeResults: false inferred from the response).
 *
 * Run:
 *   pnpm vitest run src/__tests__/ephemeral-label.test.tsx --reporter=verbose
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ResultRenderer } from "../components/ResultRenderer";

// ── Mock heavy deps ───────────────────────────────────────────────────────────

vi.mock("react-map-gl/maplibre", () => ({
  default: ({ children }: any) => <div data-testid="map">{children}</div>,
  useControl: () => null,
}));
vi.mock("maplibre-gl", () => ({ default: {} }));
vi.mock("@deck.gl/mapbox", () => ({ MapboxOverlay: class {} }));
vi.mock("@deck.gl/layers", () => ({ ScatterplotLayer: class {} }));
vi.mock("@deck.gl/aggregation-layers", () => ({
  HexagonLayer: class {},
  HeatmapLayer: class {},
}));

// ── Fixtures ──────────────────────────────────────────────────────────────────

const baseResult = {
  query_id: "q-cinema-1",
  plan: {
    category: "cinema-listings",
    date_from: "2025-06",
    date_to: "2025-06",
    location: "Bristol, UK",
  },
  poly: "51.4,-2.6:51.5,-2.6:51.5,-2.5:51.4,-2.5",
  viz_hint: "table" as const,
  resolved_location: "Bristol, City of Bristol, England",
  count: 3,
  months_fetched: ["2025-06"],
  results: [
    { title: "Dune Part Two", showtime: "2025-06-01T19:30:00Z" },
    { title: "Gladiator II", showtime: "2025-06-01T21:00:00Z" },
    { title: "Inside Out 2", showtime: "2025-06-02T14:00:00Z" },
  ],
  cache_hit: false,
  ephemeral: true,
  aggregated: false,
  resultContext: {
    status: "exact" as const,
    followUps: [],
    confidence: "high" as const,
  },
};

const cachedResult = {
  ...baseResult,
  cache_hit: true,
  ephemeral: false,
};

const persistentLiveResult = {
  ...baseResult,
  cache_hit: false,
  ephemeral: false,
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("ResultRenderer — ephemeral label", () => {
  it("shows 'Live data' label when ephemeral is true", () => {
    render(<ResultRenderer result={baseResult} />);
    expect(screen.getByText(/live data/i)).toBeTruthy();
  });

  it("shows 'not saved' text when ephemeral is true", () => {
    render(<ResultRenderer result={baseResult} />);
    expect(screen.getByText(/not saved/i)).toBeTruthy();
  });

  it("does NOT show ephemeral label when cache_hit is true", () => {
    render(<ResultRenderer result={cachedResult} />);
    expect(screen.queryByText(/live data/i)).toBeNull();
  });

  it("does NOT show ephemeral label when ephemeral is false", () => {
    render(<ResultRenderer result={persistentLiveResult} />);
    expect(screen.queryByText(/live data/i)).toBeNull();
  });

  it("shows 'cached' badge when cache_hit is true", () => {
    render(<ResultRenderer result={cachedResult} />);
    expect(screen.getByText(/cached/i)).toBeTruthy();
  });

  it("does NOT show 'cached' badge for ephemeral results", () => {
    render(<ResultRenderer result={baseResult} />);
    expect(screen.queryByText(/cached/i)).toBeNull();
  });

  it("ephemeral label and cached badge are mutually exclusive", () => {
    const { unmount } = render(<ResultRenderer result={baseResult} />);
    expect(screen.queryByText(/live data/i)).toBeTruthy();
    expect(screen.queryByText(/cached/i)).toBeNull();
    unmount();

    render(<ResultRenderer result={cachedResult} />);
    expect(screen.queryByText(/live data/i)).toBeNull();
    expect(screen.queryByText(/cached/i)).toBeTruthy();
  });

  it("renders results correctly regardless of ephemeral flag", () => {
    render(<ResultRenderer result={baseResult} />);
    // count should still be displayed
    expect(screen.getByText("3")).toBeTruthy();
  });
});
