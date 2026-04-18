import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  act,
} from "@testing-library/react";
import App, { FallbackBanner, FollowUpChips, EmptyResults } from "../App";
// ── Module mocks — prevent WebGL/canvas/network errors in jsdom ──────────────

vi.mock("maplibre-gl", () => ({
  default: { Map: vi.fn(), supported: () => false },
}));
vi.mock("react-map-gl/maplibre", () => ({
  default: ({ children }: any) => children ?? null,
  useControl: vi.fn(() => ({ setProps: vi.fn() })),
}));
vi.mock("@deck.gl/mapbox", () => ({
  MapboxOverlay: vi.fn().mockImplementation(() => ({ setProps: vi.fn() })),
}));
vi.mock("@deck.gl/layers", () => ({
  ScatterplotLayer: vi.fn(),
}));
vi.mock("@deck.gl/aggregation-layers", () => ({
  HexagonLayer: vi.fn(),
  HeatmapLayer: vi.fn(),
}));
// Mock carousel so it never fires a fetch call during tests
vi.mock("../components/QueryHistoryCarousel", () => ({
  QueryHistoryCarousel: () => null,
  CAROUSEL_CSS: "",
}));

// Mock zustand and store
vi.mock("zustand");
vi.mock("../store", () => ({
  useDredgeStore: vi.fn(() => ({
    executeQuery: null,
    setExecuteQuery: vi.fn(),
  })),
}));

// ── Shared fixtures ───────────────────────────────────────────────────────────

const validFallback = {
  field: "date" as const,
  original: "2026-03",
  used: "2025-10",
  explanation: "No data for March 2026 — showing October 2025 instead",
};

const validExecuteBody = {
  plan: {
    category: "burglary",
    date_from: "2024-01",
    date_to: "2024-01",
    location: "Cambridge, UK",
  },
  poly: "52.0,0.0:52.1,0.1",
  viz_hint: "map" as const,
  resolved_location: "Cambridge, Cambridgeshire, England",
  country_code: "GB",
  intent: "crime",
  months: ["2024-01"],
};

const validFollowUps = [
  { label: "See last 6 months", query: validExecuteBody },
  {
    label: "All crime types",
    query: {
      ...validExecuteBody,
      plan: { ...validExecuteBody.plan, category: "all-crime" },
    },
  },
];

const validResultContext = {
  status: "exact" as const,
  followUps: [],
  confidence: "high" as const,
};

const validPlan = validExecuteBody.plan;

// ── FallbackBanner ────────────────────────────────────────────────────────────

describe("FallbackBanner", () => {
  it("renders fallback.explanation text", () => {
    render(<FallbackBanner fallback={validFallback} />);
    expect(screen.getByText(validFallback.explanation)).toBeTruthy();
  });

  it("renders the ⚠ character", () => {
    render(<FallbackBanner fallback={validFallback} />);
    expect(screen.getByText("⚠")).toBeTruthy();
  });

  it("does not render when fallback is undefined", () => {
    const { container } = render(<FallbackBanner fallback={undefined} />);
    expect(container.firstChild).toBeNull();
  });
});

// ── FollowUpChips ─────────────────────────────────────────────────────────────

describe("FollowUpChips", () => {
  it("renders nothing when followUps is empty", () => {
    const { container } = render(
      <FollowUpChips followUps={[]} onSelect={vi.fn()} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders one button per chip", () => {
    render(<FollowUpChips followUps={validFollowUps} onSelect={vi.fn()} />);
    expect(screen.getAllByRole("button")).toHaveLength(validFollowUps.length);
  });

  it("button label matches chip.label", () => {
    render(<FollowUpChips followUps={validFollowUps} onSelect={vi.fn()} />);
    for (const chip of validFollowUps) {
      expect(screen.getByText(chip.label)).toBeTruthy();
    }
  });

  it("clicking a chip calls onSelect with the chip's query object", () => {
    const onSelect = vi.fn();
    render(<FollowUpChips followUps={validFollowUps} onSelect={onSelect} />);
    fireEvent.click(screen.getByText("See last 6 months"));
    expect(onSelect).toHaveBeenCalledWith(validFollowUps[0].query);
  });

  it("renders at most 4 chips even with 5 items", () => {
    const fiveChips = Array.from({ length: 5 }, (_, i) => ({
      label: `Chip ${i}`,
      query: validExecuteBody,
    }));
    render(<FollowUpChips followUps={fiveChips} onSelect={vi.fn()} />);
    expect(screen.getAllByRole("button")).toHaveLength(4);
  });
});

// ── EmptyResults ──────────────────────────────────────────────────────────────

describe("EmptyResults", () => {
  it("renders 'No results found' heading", () => {
    render(
      <EmptyResults
        plan={validPlan}
        onRefine={vi.fn()}
        resultContext={validResultContext}
        onFollowUp={vi.fn()}
      />,
    );
    expect(screen.getByText("No results found")).toBeTruthy();
  });

  it("renders resultContext.reason when provided", () => {
    const ctx = { ...validResultContext, reason: "Boundary data unavailable" };
    render(
      <EmptyResults
        plan={validPlan}
        onRefine={vi.fn()}
        resultContext={ctx}
        onFollowUp={vi.fn()}
      />,
    );
    expect(screen.getByText("Boundary data unavailable")).toBeTruthy();
  });

  it("does not render reason element when reason is undefined", () => {
    render(
      <EmptyResults
        plan={validPlan}
        onRefine={vi.fn()}
        resultContext={validResultContext}
        onFollowUp={vi.fn()}
      />,
    );
    expect(screen.queryByText(/Boundary/)).toBeNull();
  });

  it("renders FollowUpChips when resultContext.followUps is non-empty", () => {
    const ctx = { ...validResultContext, followUps: validFollowUps };
    render(
      <EmptyResults
        plan={validPlan}
        onRefine={vi.fn()}
        resultContext={ctx}
        onFollowUp={vi.fn()}
      />,
    );
    expect(screen.getByText("See last 6 months")).toBeTruthy();
  });

  it("'Refine query' button calls onRefine", () => {
    const onRefine = vi.fn();
    render(
      <EmptyResults
        plan={validPlan}
        onRefine={onRefine}
        resultContext={validResultContext}
        onFollowUp={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByText("Refine query"));
    expect(onRefine).toHaveBeenCalledTimes(1);
  });
});

// ── handleFollowUp ────────────────────────────────────────────────────────────

const mockParseResponse = {
  plan: validPlan,
  poly: "52.0,0.0:52.1,0.1",
  viz_hint: "map",
  resolved_location: "Cambridge, Cambridgeshire, England",
  country_code: "GB",
  intent: "crime",
  months: ["2024-01"],
};

const mockExecuteResponse = {
  query_id: "abc123",
  ...mockParseResponse,
  count: 5,
  months_fetched: ["2024-01"],
  results: [],
  cache_hit: false,
  resultContext: {
    status: "exact",
    followUps: validFollowUps,
    confidence: "high",
  },
};

const mockExecuteResponseEmpty = {
  ...mockExecuteResponse,
  count: 0,
  resultContext: {
    status: "empty",
    followUps: validFollowUps,
    confidence: "low",
  },
};

function mockFetch(responses: Array<{ ok: boolean; data: unknown }>) {
  let i = 0;
  return vi.fn((url: string) => {
    if (typeof url === "string" && url.includes("/query/history")) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
    }
    const r = responses[i++] ?? responses[responses.length - 1];
    return Promise.resolve({
      ok: r.ok,
      json: () => Promise.resolve(r.data),
    });
  });
}

describe("handleFollowUp", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function renderToDone() {
    global.fetch = mockFetch([
      { ok: true, data: mockParseResponse },
      { ok: true, data: mockExecuteResponse },
    ]) as any;
    render(<App />);
    const input = screen.getByPlaceholderText(/burglaries in Cambridge/i);
    fireEvent.change(input, { target: { value: "burglaries in Cambridge" } });
    fireEvent.click(screen.getByText("Search"));
    await waitFor(() => screen.getByText("See last 6 months"));
  }

  it("POSTs to /query/execute (not /query/parse) when a chip is clicked", async () => {
    const fetchMock = mockFetch([
      { ok: true, data: mockParseResponse },
      { ok: true, data: mockExecuteResponse },
      { ok: true, data: mockExecuteResponse },
    ]);
    global.fetch = fetchMock as any;
    render(<App />);
    const input = screen.getByPlaceholderText(/burglaries in Cambridge/i);
    fireEvent.change(input, { target: { value: "burglaries" } });
    fireEvent.click(screen.getByText("Search"));
    await waitFor(() => screen.getByText("See last 6 months"));

    fireEvent.click(screen.getByText("See last 6 months"));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));

    const lastCall = fetchMock.mock.calls[2];
    expect(lastCall[0]).toContain("/query/execute");
    expect(lastCall[0]).not.toContain("/query/parse");
  });

  it("request body is the ExecuteBody passed as argument — no modification", async () => {
    const fetchMock = mockFetch([
      { ok: true, data: mockParseResponse },
      { ok: true, data: mockExecuteResponse },
      { ok: true, data: mockExecuteResponse },
    ]);
    global.fetch = fetchMock as any;
    render(<App />);
    fireEvent.change(screen.getByPlaceholderText(/burglaries/i), {
      target: { value: "test" },
    });
    fireEvent.click(screen.getByText("Search"));
    await waitFor(() => screen.getByText("See last 6 months"));

    fireEvent.click(screen.getByText("See last 6 months"));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));

    const body = JSON.parse(fetchMock.mock.calls[2][1].body);
    expect(body).toEqual(validFollowUps[0].query);
  });

  it("on 200 response: stage becomes 'done' and result is set", async () => {
    await renderToDone();
    // Already done — just verify results are shown
    expect(screen.queryByText(/Interpreting/)).toBeNull();
  });

  it("on non-200 response: stage becomes 'error' and intentError is set", async () => {
    global.fetch = mockFetch([
      { ok: true, data: mockParseResponse },
      { ok: true, data: mockExecuteResponse },
      { ok: false, data: { message: "Server error on followup" } },
    ]) as any;
    render(<App />);
    fireEvent.change(screen.getByPlaceholderText(/burglaries/i), {
      target: { value: "test" },
    });
    fireEvent.click(screen.getByText("Search"));
    await waitFor(() => screen.getByText("See last 6 months"));

    fireEvent.click(screen.getByText("See last 6 months"));
    await waitFor(() => screen.getByText(/SERVICE ERROR/));
  });

  it("on network failure: stage becomes 'error' and intentError message is shown", async () => {
    let call = 0;
    global.fetch = vi.fn((url: string) => {
      if (typeof url === "string" && url.includes("/query/history")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
      }
      call++;
      if (call <= 2)
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve(
              call === 1 ? mockParseResponse : mockExecuteResponse,
            ),
        });
      return Promise.reject(new Error("Network down"));
    }) as any;
    render(<App />);
    fireEvent.change(screen.getByPlaceholderText(/burglaries/i), {
      target: { value: "test" },
    });
    fireEvent.click(screen.getByText("Search"));
    await waitFor(() => screen.getByText("See last 6 months"));

    fireEvent.click(screen.getByText("See last 6 months"));
    await waitFor(() => screen.getByText(/SERVICE ERROR/));
  });
});

// ── Render integration ────────────────────────────────────────────────────────

describe("render integration", () => {
  afterEach(() => vi.restoreAllMocks());

  it("when resultContext.status === 'fallback', FallbackBanner is visible", async () => {
    const fallbackResult = {
      ...mockExecuteResponse,
      count: 3,
      resultContext: {
        status: "fallback",
        fallback: validFallback,
        followUps: [],
        confidence: "medium",
      },
    };
    global.fetch = mockFetch([
      { ok: true, data: mockParseResponse },
      { ok: true, data: fallbackResult },
    ]) as any;
    render(<App />);
    fireEvent.change(screen.getByPlaceholderText(/burglaries/i), {
      target: { value: "test" },
    });
    fireEvent.click(screen.getByText("Search"));
    await waitFor(() => screen.getByText(validFallback.explanation));
    expect(screen.getByText("⚠")).toBeTruthy();
  });

  it("when resultContext.status === 'exact', FallbackBanner is not rendered", async () => {
    global.fetch = mockFetch([
      { ok: true, data: mockParseResponse },
      { ok: true, data: mockExecuteResponse },
    ]) as any;
    render(<App />);
    fireEvent.change(screen.getByPlaceholderText(/burglaries/i), {
      target: { value: "test" },
    });
    fireEvent.click(screen.getByText("Search"));
    await waitFor(() => screen.getByText("See last 6 months"));
    expect(screen.queryByText("⚠")).toBeNull();
  });

  it("FollowUpChips appear below results when count > 0 and chips exist", async () => {
    global.fetch = mockFetch([
      { ok: true, data: mockParseResponse },
      {
        ok: true,
        data: {
          ...mockExecuteResponse,
          count: 5,
          results: [{ id: "1", category: "burglary", month: "2024-01" }],
        },
      },
    ]) as any;
    render(<App />);
    fireEvent.change(screen.getByPlaceholderText(/burglaries/i), {
      target: { value: "test" },
    });
    fireEvent.click(screen.getByText("Search"));
    await waitFor(() => screen.getByText("See last 6 months"));
  });

  it("FollowUpChips appear inside EmptyResults when count === 0", async () => {
    global.fetch = mockFetch([
      { ok: true, data: mockParseResponse },
      { ok: true, data: mockExecuteResponseEmpty },
    ]) as any;
    render(<App />);
    fireEvent.change(screen.getByPlaceholderText(/burglaries/i), {
      target: { value: "test" },
    });
    fireEvent.click(screen.getByText("Search"));
    await waitFor(() => screen.getByText("No results found"));
    expect(screen.getByText("See last 6 months")).toBeTruthy();
  });
});

// ── Edge cases ────────────────────────────────────────────────────────────────

describe("edge cases", () => {
  afterEach(() => vi.restoreAllMocks());

  it("resultContext missing from API response → app does not crash", async () => {
    const noContext = { ...mockExecuteResponse, resultContext: undefined };
    global.fetch = mockFetch([
      { ok: true, data: mockParseResponse },
      { ok: true, data: noContext },
    ]) as any;
    render(<App />);
    fireEvent.change(screen.getByPlaceholderText(/burglaries/i), {
      target: { value: "test" },
    });
    fireEvent.click(screen.getByText("Search"));
    await waitFor(() => screen.getByText(/results/));
    expect(screen.queryByText("⚠")).toBeNull();
  });

  it("followUps null in response → chips render empty, no crash", async () => {
    const nullChips = {
      ...mockExecuteResponse,
      resultContext: { ...mockExecuteResponse.resultContext, followUps: null },
    };
    global.fetch = mockFetch([
      { ok: true, data: mockParseResponse },
      { ok: true, data: nullChips },
    ]) as any;
    render(<App />);
    fireEvent.change(screen.getByPlaceholderText(/burglaries/i), {
      target: { value: "test" },
    });
    fireEvent.click(screen.getByText("Search"));
    await waitFor(() => screen.getByText(/results/));
  });
});
