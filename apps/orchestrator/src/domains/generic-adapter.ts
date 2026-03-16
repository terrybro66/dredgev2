import { DomainConfig } from "@dredge/schemas";
import { DomainAdapter } from "./registry";
import { createCsvProvider } from "../providers/csv-provider";
import { createXlsxProvider } from "../providers/xlsx-provider";
import { createPdfProvider } from "../providers/pdf-provider";
import { createRestProvider } from "../providers/rest-provider";
import { restGet } from "../providers/rest-provider";

export function createGenericAdapter(config: DomainConfig): DomainAdapter {
  return {
    config,

    async fetchData(_plan: unknown, _locationArg: string): Promise<unknown[]> {
      const sources = config.sources;
      if (!sources || sources.length === 0) return [];

      const results = await Promise.all(
        sources.map(async (source) => {
          switch (source.type) {
            case "rest": {
              const provider = createRestProvider({ url: source.url });
              return provider.fetchRows();
            }
            case "csv": {
              const text = await restGet<string>({ url: source.url });
              const provider = createCsvProvider({ content: text });
              return provider.fetchRows();
            }
            case "xlsx": {
              const buffer = await restGet<Buffer>({ url: source.url });
              const provider = createXlsxProvider({ buffer });
              return provider.fetchRows();
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
              return provider.fetchRows();
            }
            default:
              return [];
          }
        }),
      );

      return results.flat();
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
