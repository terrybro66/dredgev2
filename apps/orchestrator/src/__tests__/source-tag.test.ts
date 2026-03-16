import { describe, it, expect } from "vitest";

describe("tagRows", () => {
  it("adds sourceTag to each row", async () => {
    const { tagRows } = await import("../enrichment/source-tag");
    const rows = [{ name: "Alice" }, { name: "Bob" }];
    const tagged = tagRows(rows, "https://example.com/data.csv");
    expect(tagged[0]).toMatchObject({
      name: "Alice",
      _sourceTag: "https://example.com/data.csv",
    });
    expect(tagged[1]).toMatchObject({
      name: "Bob",
      _sourceTag: "https://example.com/data.csv",
    });
  });

  it("does not mutate the original rows", async () => {
    const { tagRows } = await import("../enrichment/source-tag");
    const rows = [{ name: "Alice" }];
    const tagged = tagRows(rows, "https://example.com/data.csv");
    expect(rows[0]).not.toHaveProperty("_sourceTag");
    expect(tagged[0]).toHaveProperty("_sourceTag");
  });

  it("returns empty array for empty input", async () => {
    const { tagRows } = await import("../enrichment/source-tag");
    expect(tagRows([], "https://example.com")).toEqual([]);
  });

  it("preserves all existing fields on the row", async () => {
    const { tagRows } = await import("../enrichment/source-tag");
    const rows = [{ id: 1, category: "burglary", month: "2024-01" }];
    const tagged = tagRows(rows, "source-a");
    expect(tagged[0]).toMatchObject({
      id: 1,
      category: "burglary",
      month: "2024-01",
      _sourceTag: "source-a",
    });
  });
});
