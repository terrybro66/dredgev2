import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import type { ProviderSource } from "../providers/types";
import { ProviderFetchError } from "../providers/types";

const csvSource: ProviderSource = {
  url: "https://example.com/data.csv",
  providerType: "csv",
  refreshPolicy: "daily",
};

const xlsxSource: ProviderSource = {
  url: "https://example.com/data.xlsx",
  providerType: "xlsx",
  refreshPolicy: "weekly",
};

const pdfSource: ProviderSource = {
  url: "https://example.com/data.pdf",
  providerType: "pdf",
  refreshPolicy: "static",
};

const restSource: ProviderSource = {
  url: "https://example.com/data.json",
  providerType: "rest",
  refreshPolicy: "realtime",
};

const mockAxiosGet = vi.fn();

vi.mock("axios", () => ({
  default: { get: mockAxiosGet },
}));

vi.mock("pdf-parse", () => ({
  default: vi.fn().mockResolvedValue({ text: "Alice 30\nBob 25" }),
}));

describe("RestProvider", () => {
  beforeEach(() => {
    mockAxiosGet.mockReset();
  });

  it("returns rows extracted from the response", async () => {
    mockAxiosGet.mockResolvedValue({
      data: [{ id: 1 }, { id: 2 }],
    });

    const { createRestProvider } = await import("../providers/rest-provider");
    const provider = createRestProvider({ url: restSource.url });
    const rows = await provider.fetchRows();

    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({ id: 1 });
  });

  it("throws a ProviderFetchError on HTTP error", async () => {
    mockAxiosGet.mockRejectedValue({
      response: { status: 404 },
      message: "Not Found",
    });

    const { createRestProvider } = await import("../providers/rest-provider");
    const provider = createRestProvider({ url: restSource.url });

    await expect(provider.fetchRows()).rejects.toBeInstanceOf(
      ProviderFetchError,
    );
  });
});

describe("CsvProvider", () => {
  beforeEach(() => {
    mockAxiosGet.mockReset();
  });

  it("parses CSV text into rows", async () => {
    mockAxiosGet.mockResolvedValue({
      data: `name,age\nAlice,30\nBob,25`,
    });

    const { createCsvProvider } = await import("../providers/csv-provider");
    const provider = createCsvProvider();

    const result = await provider.fetchData(csvSource);

    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]).toEqual({ name: "Alice", age: "30" });
    expect(result.rows[1]).toEqual({ name: "Bob", age: "25" });
    expect(result.meta.providerType).toBe("csv");
    expect(result.meta.rowCount).toBe(2);
  });

  it("returns empty rows for a headers-only CSV", async () => {
    mockAxiosGet.mockResolvedValue({ data: `name,age` });

    const { createCsvProvider } = await import("../providers/csv-provider");
    const provider = createCsvProvider();

    const result = await provider.fetchData(csvSource);

    expect(result.rows).toHaveLength(0);
  });

  it("returns empty rows for an empty CSV", async () => {
    mockAxiosGet.mockResolvedValue({ data: "" });

    const { createCsvProvider } = await import("../providers/csv-provider");
    const provider = createCsvProvider();

    const result = await provider.fetchData(csvSource);

    expect(result.rows).toHaveLength(0);
  });

  it("throws a ProviderFetchError on HTTP error", async () => {
    mockAxiosGet.mockRejectedValue({
      response: { status: 403 },
      message: "Forbidden",
    });

    const { createCsvProvider } = await import("../providers/csv-provider");
    const provider = createCsvProvider();

    await expect(provider.fetchData(csvSource)).rejects.toBeInstanceOf(
      ProviderFetchError,
    );
  });
});

describe("XlsxProvider", () => {
  beforeEach(() => {
    mockAxiosGet.mockReset();
  });

  it("parses an XLSX buffer into rows", async () => {
    const XLSX = await import("xlsx");
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([
      ["name", "age"],
      ["Alice", 30],
      ["Bob", 25],
    ]);
    XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
    const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

    mockAxiosGet.mockResolvedValue({ data: buffer });

    const { createXlsxProvider } = await import("../providers/xlsx-provider");
    const provider = createXlsxProvider();

    const result = await provider.fetchData(xlsxSource);

    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]).toMatchObject({ name: "Alice", age: 30 });
    expect(result.meta.providerType).toBe("xlsx");
    expect(result.meta.rowCount).toBe(2);
  });

  it("returns empty rows for a sheet with headers only", async () => {
    const XLSX = await import("xlsx");
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([["name", "age"]]);
    XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
    const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

    mockAxiosGet.mockResolvedValue({ data: buffer });

    const { createXlsxProvider } = await import("../providers/xlsx-provider");
    const provider = createXlsxProvider();

    const result = await provider.fetchData(xlsxSource);

    expect(result.rows).toHaveLength(0);
  });

  it("throws a ProviderFetchError on HTTP error", async () => {
    mockAxiosGet.mockRejectedValue({
      response: { status: 500 },
      message: "Internal Server Error",
    });

    const { createXlsxProvider } = await import("../providers/xlsx-provider");
    const provider = createXlsxProvider();

    await expect(provider.fetchData(xlsxSource)).rejects.toBeInstanceOf(
      ProviderFetchError,
    );
  });
});

describe("PdfProvider", () => {
  beforeEach(() => {
    mockAxiosGet.mockReset();
  });

  it("extracts text rows from a PDF buffer", async () => {
    mockAxiosGet.mockResolvedValue({ data: Buffer.from("fake-pdf") });

    const { createPdfProvider } = await import("../providers/pdf-provider");
    const provider = createPdfProvider({
      extractRows: (text: string) =>
        text.split("\n").map((line) => ({ raw: line })),
    });

    const result = await provider.fetchData(pdfSource);

    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]).toEqual({ raw: "Alice 30" });
    expect(result.meta.providerType).toBe("pdf");
    expect(result.meta.rowCount).toBe(2);
  });

  it("throws a ProviderFetchError on HTTP error", async () => {
    mockAxiosGet.mockRejectedValue({
      response: { status: 404 },
      message: "Not Found",
    });

    const { createPdfProvider } = await import("../providers/pdf-provider");
    const provider = createPdfProvider({
      extractRows: (text: string) => [{ raw: text }],
    });

    await expect(provider.fetchData(pdfSource)).rejects.toBeInstanceOf(
      ProviderFetchError,
    );
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});
