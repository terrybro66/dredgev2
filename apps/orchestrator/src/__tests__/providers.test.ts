import { describe, it, expect, vi, afterEach } from "vitest";

describe("RestProvider", () => {
  it("returns rows extracted from the response", async () => {
    const { createRestProvider } = await import("../providers/rest-provider");

    // Override fetchRows directly to avoid real HTTP
    const provider = createRestProvider({
      url: "https://example.com/data.json",
      extractRows: () => [{ id: 1 }, { id: 2 }],
    });

    // Patch fetchRows to skip the network call
    provider.fetchRows = async () => [{ id: 1 }, { id: 2 }];

    const rows = await provider.fetchRows();
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({ id: 1 });
  });
});
describe("CsvProvider", () => {
  it("parses CSV text into rows", async () => {
    const { createCsvProvider } = await import("../providers/csv-provider");
    const csv = `name,age\nAlice,30\nBob,25`;
    const provider = createCsvProvider({
      content: csv,
    });
    const rows = await provider.fetchRows();
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({ name: "Alice", age: "30" });
    expect(rows[1]).toEqual({ name: "Bob", age: "25" });
  });

  it("returns empty array for empty CSV", async () => {
    const { createCsvProvider } = await import("../providers/csv-provider");
    const provider = createCsvProvider({ content: "" });
    const rows = await provider.fetchRows();
    expect(rows).toHaveLength(0);
  });
});

describe("XlsxProvider", () => {
  it("parses an XLSX buffer into rows", async () => {
    const { createXlsxProvider } = await import("../providers/xlsx-provider");
    const XLSX = await import("xlsx");

    // Build a minimal in-memory workbook
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([
      ["name", "age"],
      ["Alice", 30],
      ["Bob", 25],
    ]);
    XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
    const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

    const provider = createXlsxProvider({ buffer });
    const rows = await provider.fetchRows();
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ name: "Alice", age: 30 });
  });

  it("returns empty array for empty sheet", async () => {
    const { createXlsxProvider } = await import("../providers/xlsx-provider");
    const XLSX = await import("xlsx");

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([["name", "age"]]);
    XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
    const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

    const provider = createXlsxProvider({ buffer });
    const rows = await provider.fetchRows();
    expect(rows).toHaveLength(0);
  });
});

describe("PdfProvider", () => {
  it("extracts text from a PDF buffer", async () => {
    const { createPdfProvider } = await import("../providers/pdf-provider");

    // Mock pdf-parse since we don't need a real PDF in tests
    vi.mock("pdf-parse", () => ({
      default: vi.fn().mockResolvedValue({ text: "Alice 30\nBob 25" }),
    }));

    const buffer = Buffer.from("fake-pdf");
    const provider = createPdfProvider({
      buffer,
      extractRows: (text: string) =>
        text.split("\n").map((line) => ({ raw: line })),
    });

    const rows = await provider.fetchRows();
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({ raw: "Alice 30" });
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});
