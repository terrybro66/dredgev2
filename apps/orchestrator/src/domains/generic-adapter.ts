import { DomainConfig } from "@dredge/schemas";
import { DomainAdapter } from "./registry";
import { createCsvProvider } from "../providers/csv-provider";
import { createXlsxProvider } from "../providers/xlsx-provider";
import { createPdfProvider } from "../providers/pdf-provider";
import { createRestProvider, restGet } from "../providers/rest-provider";
import { tagRows } from "../enrichment/source-tag";
import { deduplicateRows } from "../enrichment/deduplication";
import { prisma } from "../db";

export function createGenericAdapter(
  config: DomainConfig,
  dedupeKeys: string[] = [],
): DomainAdapter {
  return {
    config,

    async fetchData(_plan: unknown, _locationArg: string): Promise<unknown[]> {
      // Load enabled sources from the DB. Fall back to the static config.sources
      // array for adapters that predate the DataSource model.
      const dbSources = await prisma.dataSource.findMany({
        where: { domainName: config.name, enabled: true },
      });

      const sources = dbSources.length > 0 ? dbSources : (config.sources ?? []);

      if (sources.length === 0) return [];

      const results = await Promise.all(
        sources.map(async (source) => {
          let rows: unknown[] = [];
          const url = source.url;
          const type = source.type;

          switch (type) {
            case "rest": {
              const provider = createRestProvider({ url });
              rows = await provider.fetchRows();
              break;
            }
            case "csv": {
              const text = await restGet<string>({ url });
              const provider = createCsvProvider({ content: text });
              rows = await provider.fetchRows();
              break;
            }
            case "xlsx": {
              const buffer = await restGet<Buffer>({ url });
              const provider = createXlsxProvider({ buffer });
              rows = await provider.fetchRows();
              break;
            }
            case "pdf": {
              const buffer = await restGet<Buffer>({ url });
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

          return tagRows(rows, url);
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
      queryId: string,
      rows: unknown[],
      prisma: any,
    ): Promise<void> {
      if (rows.length === 0) return;

      await prisma.queryResult.createMany({
        data: (rows as Record<string, unknown>[]).map((row) => ({
          domain_name: config.name,
          source_tag: (row.source_tag as string) ?? config.name,
          date: row.date ? new Date(row.date as string) : null,
          lat: ((row.lat ?? row.latitude) as number) ?? null,
          lon: ((row.lon ?? row.longitude) as number) ?? null,
          location: (row.location as string) ?? null,
          description: (row.description as string) ?? null,
          category: (row.category as string) ?? null,
          value: (row.value as number) ?? null,
          raw: (row.raw as object) ?? row,
          extras: (row.extras as object) ?? null,
          snapshot_id: (row.snapshot_id as string) ?? null,
        })),
      });
    },
  };
}
