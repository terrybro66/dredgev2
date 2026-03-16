import { DomainConfig } from "@dredge/schemas";
import { DomainAdapter } from "./registry";
import { createCsvProvider } from "../providers/csv-provider";
import { createXlsxProvider } from "../providers/xlsx-provider";
import { createPdfProvider } from "../providers/pdf-provider";
import { createRestProvider, restGet } from "../providers/rest-provider";
import { tagRows } from "../enrichment/source-tag";
import { deduplicateRows } from "../enrichment/deduplication";

export function createGenericAdapter(
  config: DomainConfig,
  dedupeKeys: string[] = [],
): DomainAdapter {
  return {
    config,

    async fetchData(_plan: unknown, _locationArg: string): Promise<unknown[]> {
      const sources = config.sources;
      if (!sources || sources.length === 0) return [];

      const results = await Promise.all(
        sources.map(async (source) => {
          let rows: unknown[] = [];

          switch (source.type) {
            case "rest": {
              const provider = createRestProvider({ url: source.url });
              rows = await provider.fetchRows();
              break;
            }
            case "csv": {
              const text = await restGet<string>({ url: source.url });
              const provider = createCsvProvider({ content: text });
              rows = await provider.fetchRows();
              break;
            }
            case "xlsx": {
              const buffer = await restGet<Buffer>({ url: source.url });
              const provider = createXlsxProvider({ buffer });
              rows = await provider.fetchRows();
              break;
            }
            case "pdf": {
              const buffer = await restGet<Buffer>({ url: source.url });
              const provider = createPdfProvider({
                buffer,
                extractRows: (text) =>
                  text
                    .split("\n")
                    .filter(Boolean)
                    .map((line) => ({ raw: line })),
              });
              rows = await provider.fetchRows();
              break;
            }
          }

          return tagRows(rows, source.url);
        }),
      );

      const merged = results.flat() as Record<string, unknown>[];
      return dedupeKeys.length > 0
        ? deduplicateRows(merged, dedupeKeys)
        : merged;
    },

    flattenRow(row: unknown): Record<string, unknown> {
      return row as Record<string, unknown>;
    },

    async storeResults(
      _queryId: string,
      _rows: unknown[],
      _prisma: unknown,
    ): Promise<void> {
      // Generic storage — to be implemented per domain or via Phase 13 envelope
    },
  };
}
