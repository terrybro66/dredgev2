import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { searchCatalogue } from "../agent/search/catalogue";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeCkanDataset(overrides: {
  title?: string;
  notes?: string;
  resourceUrl?: string;
  resourceFormat?: string;
}) {
  return {
    title: overrides.title ?? "Test dataset",
    notes: overrides.notes ?? "",
    resources: [
      {
        url: overrides.resourceUrl ?? "https://example.com/data.csv",
        format: overrides.resourceFormat ?? "CSV",
      },
    ],
  };
}

function mockCkan(datasets: object[]) {
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ result: { results: datasets } }),
  } as any);
}

beforeEach(() => {
  vi.resetAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ── Relevance filtering ───────────────────────────────────────────────────────

describe("searchCatalogue — relevance filtering", () => {
  it("returns results whose title contains an intent keyword", async () => {
    mockCkan([
      makeCkanDataset({
        title: "Cinema listings for UK venues",
        resourceUrl: "https://example.com/cinemas.csv",
      }),
    ]);
    const results = await searchCatalogue("cinema listings", "GB");
    expect(results).toHaveLength(1);
    expect(results[0].url).toBe("https://example.com/cinemas.csv");
  });

  it("returns results whose description contains an intent keyword", async () => {
    mockCkan([
      makeCkanDataset({
        title: "Local authority data",
        notes: "This dataset contains cinema and theatre listing information.",
        resourceUrl: "https://example.com/venues.csv",
      }),
    ]);
    const results = await searchCatalogue("cinema listings", "GB");
    expect(results).toHaveLength(1);
  });

  it("filters out datasets with no intent keyword in title or description", async () => {
    mockCkan([
      makeCkanDataset({
        title: "Veterinary practices in Sunderland",
        notes: "Local authority veterinary service locations.",
        resourceUrl: "http://www.sunderland.gov.uk/localpublicdata/vets",
      }),
    ]);
    const results = await searchCatalogue("cinema listings", "GB");
    expect(results).toHaveLength(0);
  });

  it("filters the vets URL specifically from a cinema listings search", async () => {
    mockCkan([
      makeCkanDataset({
        title: "Veterinary practices",
        notes: "Vet surgeries near you.",
        resourceUrl: "http://www.sunderland.gov.uk/localpublicdata/vets",
      }),
      makeCkanDataset({
        title: "Cinema venues and film listings",
        notes: "UK cinema locations with showtimes.",
        resourceUrl: "https://example.com/cinemas.json",
        resourceFormat: "JSON",
      }),
    ]);
    const results = await searchCatalogue("cinema listings", "GB");
    expect(results).toHaveLength(1);
    expect(results[0].url).toBe("https://example.com/cinemas.json");
  });

  it("is case-insensitive in keyword matching", async () => {
    mockCkan([
      makeCkanDataset({
        title: "CINEMA LISTINGS DATA",
        resourceUrl: "https://example.com/cinemas.csv",
      }),
    ]);
    const results = await searchCatalogue("cinema listings", "GB");
    expect(results).toHaveLength(1);
  });

  it("matches multi-word intents — all words don't need to be present, any keyword suffices", async () => {
    mockCkan([
      makeCkanDataset({
        title: "Flood warning zones",
        resourceUrl: "https://example.com/floods.csv",
      }),
      makeCkanDataset({
        title: "Rainfall data",
        notes: "Flood risk assessment data.",
        resourceUrl: "https://example.com/rainfall.csv",
      }),
      makeCkanDataset({
        title: "Road accidents",
        resourceUrl: "https://example.com/accidents.csv",
      }),
    ]);
    const results = await searchCatalogue("flood risk", "GB");
    // Both flood datasets match — road accidents does not
    expect(results).toHaveLength(2);
    expect(results.map((r) => r.url)).not.toContain(
      "https://example.com/accidents.csv",
    );
  });

  it("returns empty array when all catalogue results are irrelevant", async () => {
    mockCkan([
      makeCkanDataset({ title: "Planning applications 2019" }),
      makeCkanDataset({ title: "Council tax bands" }),
      makeCkanDataset({ title: "Dog fouling complaints" }),
    ]);
    const results = await searchCatalogue("cinema listings", "GB");
    expect(results).toHaveLength(0);
  });

  it("still filters stale datapress.com URLs even if title is relevant", async () => {
    mockCkan([
      makeCkanDataset({
        title: "Cinema listings archive",
        resourceUrl: "https://old.datapress.com/cinemas.csv",
      }),
    ]);
    const results = await searchCatalogue("cinema listings", "GB");
    expect(results).toHaveLength(0);
  });

  it("preserves existing stale-URL filters alongside relevance filter", async () => {
    mockCkan([
      makeCkanDataset({
        title: "Cinema listings",
        resourceUrl: "https://example.com/cinemas.csv#",
      }),
      makeCkanDataset({
        title: "Cinema listings",
        resourceUrl: "N/A",
      }),
      makeCkanDataset({
        title: "Cinema listings",
        resourceUrl: "https://example.com/real.csv",
      }),
    ]);
    const results = await searchCatalogue("cinema listings", "GB");
    expect(results).toHaveLength(1);
    expect(results[0].url).toBe("https://example.com/real.csv");
  });
});
