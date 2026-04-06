import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";

vi.mock("@tanstack/react-query", () => ({
  useQuery: vi.fn(),
}));

vi.mock("../store", () => ({
  useDredgeStore: vi.fn(),
}));

import { useQuery } from "@tanstack/react-query";
import { useDredgeStore } from "../store";
import { QueryHistoryCarousel } from "../components/QueryHistoryCarousel";

const mockUseQuery = vi.mocked(useQuery);
const mockUseDredgeStore = vi.mocked(useDredgeStore);

const sampleEntry = {
  query_id: "q1",
  text: "burglaries in Cambridge",
  category: "burglary",
  date_from: "2024-01",
  date_to: "2024-01",
  resolved_location: "Cambridge, England",
  poly: "52.0,0.0:52.1,0.1",
  country_code: "GB",
  domain: "crime-uk",
  intent: "crime",
  viz_hint: "map",
  createdAt: "2024-01-15T10:00:00Z",
  result_count: 42,
  cache_hit: false,
};

const mockExecuteQuery = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  mockUseDredgeStore.mockImplementation((selector: any) =>
    selector({ executeQuery: mockExecuteQuery, setExecuteQuery: vi.fn() }),
  );
});

describe("QueryHistoryCarousel", () => {
  it("renders nothing when entries is empty", () => {
    mockUseQuery.mockReturnValue({ data: [] } as any);
    const { container } = render(<QueryHistoryCarousel />);
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when data is undefined", () => {
    mockUseQuery.mockReturnValue({ data: undefined } as any);
    const { container } = render(<QueryHistoryCarousel />);
    expect(container.firstChild).toBeNull();
  });

  it("renders a card for each entry", () => {
    mockUseQuery.mockReturnValue({
      data: [sampleEntry, { ...sampleEntry, query_id: "q2" }],
    } as any);
    render(<QueryHistoryCarousel />);
    expect(screen.getAllByRole("button")).toHaveLength(2);
  });

  it("limits display to 10 cards even with more entries", () => {
    const entries = Array.from({ length: 15 }, (_, i) => ({
      ...sampleEntry,
      query_id: `q${i}`,
    }));
    mockUseQuery.mockReturnValue({ data: entries } as any);
    render(<QueryHistoryCarousel />);
    expect(screen.getAllByRole("button")).toHaveLength(10);
  });

  it("shows the resolved_location on the card", () => {
    mockUseQuery.mockReturnValue({ data: [sampleEntry] } as any);
    render(<QueryHistoryCarousel />);
    expect(screen.getByText("Cambridge, England")).toBeInTheDocument();
  });

  it("shows the result count when non-null", () => {
    mockUseQuery.mockReturnValue({ data: [sampleEntry] } as any);
    render(<QueryHistoryCarousel />);
    expect(screen.getByText("42")).toBeInTheDocument();
  });

  it("does not show result count when null", () => {
    mockUseQuery.mockReturnValue({
      data: [{ ...sampleEntry, result_count: null }],
    } as any);
    render(<QueryHistoryCarousel />);
    expect(screen.queryByText("42")).toBeNull();
  });

  it("shows the viz icon for the hint type", () => {
    mockUseQuery.mockReturnValue({ data: [sampleEntry] } as any);
    render(<QueryHistoryCarousel />);
    expect(screen.getByText("◎")).toBeInTheDocument();
  });

  it("clicking a card calls executeQuery with the correct payload", () => {
    mockUseQuery.mockReturnValue({ data: [sampleEntry] } as any);
    render(<QueryHistoryCarousel />);
    fireEvent.click(screen.getByRole("button"));
    expect(mockExecuteQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        intent: "crime",
        resolved_location: "Cambridge, England",
        country_code: "GB",
        poly: "52.0,0.0:52.1,0.1",
      }),
    );
  });

  it("does not crash when executeQuery is null", () => {
    mockUseDredgeStore.mockImplementation((selector: any) =>
      selector({ executeQuery: null, setExecuteQuery: vi.fn() }),
    );
    mockUseQuery.mockReturnValue({ data: [sampleEntry] } as any);
    render(<QueryHistoryCarousel />);
    expect(() => fireEvent.click(screen.getByRole("button"))).not.toThrow();
  });

  it("shows a single month when date_from equals date_to", () => {
    mockUseQuery.mockReturnValue({ data: [sampleEntry] } as any);
    render(<QueryHistoryCarousel />);
    expect(screen.queryByText(/–/)).toBeNull();
  });

  it("shows a date range when date_from differs from date_to", () => {
    const rangeEntry = {
      ...sampleEntry,
      date_from: "2024-01",
      date_to: "2024-06",
    };
    mockUseQuery.mockReturnValue({ data: [rangeEntry] } as any);
    render(<QueryHistoryCarousel />);
    expect(screen.getByText(/–/)).toBeInTheDocument();
  });

  it("falls back to entry.text when resolved_location is null", () => {
    const noLocation = { ...sampleEntry, resolved_location: null };
    mockUseQuery.mockReturnValue({ data: [noLocation] } as any);
    render(<QueryHistoryCarousel />);
    expect(screen.getByText("burglaries in Cambridge")).toBeInTheDocument();
  });
});
