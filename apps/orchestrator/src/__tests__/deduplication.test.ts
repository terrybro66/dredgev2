import { describe, it, expect } from "vitest";

describe("deduplicateRows", () => {
  it("returns all rows when there are no duplicates", async () => {
    const { deduplicateRows } = await import("../enrichment/deduplication");
    const rows = [
      { _sourceTag: "a", id: "1", month: "2024-01" },
      { _sourceTag: "b", id: "2", month: "2024-01" },
    ];
    const result = deduplicateRows(rows, ["id", "month"]);
    expect(result).toHaveLength(2);
  });

  it("deduplicates rows with the same stable key fields", async () => {
    const { deduplicateRows } = await import("../enrichment/deduplication");
    const rows = [
      { _sourceTag: "a", id: "1", month: "2024-01", extra: "from-a" },
      { _sourceTag: "b", id: "1", month: "2024-01", extra: "from-b" },
    ];
    const result = deduplicateRows(rows, ["id", "month"]);
    expect(result).toHaveLength(1);
  });

  it("keeps the first occurrence when deduplicating", async () => {
    const { deduplicateRows } = await import("../enrichment/deduplication");
    const rows = [
      { _sourceTag: "a", id: "1", value: "first" },
      { _sourceTag: "b", id: "1", value: "second" },
    ];
    const result = deduplicateRows(rows, ["id"]);
    expect(result[0]).toMatchObject({ value: "first", _sourceTag: "a" });
  });

  it("returns all rows when no key fields are specified", async () => {
    const { deduplicateRows } = await import("../enrichment/deduplication");
    const rows = [{ id: "1" }, { id: "1" }];
    const result = deduplicateRows(rows, []);
    expect(result).toHaveLength(2);
  });

  it("handles rows missing one of the key fields", async () => {
    const { deduplicateRows } = await import("../enrichment/deduplication");
    const rows = [
      { _sourceTag: "a", id: "1" },
      { _sourceTag: "b" }, // missing id
    ];
    const result = deduplicateRows(rows, ["id"]);
    expect(result).toHaveLength(2);
  });
});
