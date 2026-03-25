import { DomainConfig } from "@dredge/schemas";
import { DomainAdapter } from "./registry";
import { createCsvProvider } from "../providers/csv-provider";
import { createXlsxProvider } from "../providers/xlsx-provider";
import { createPdfProvider } from "../providers/pdf-provider";
import { createRestProvider, restGet } from "../providers/rest-provider";
import { tagRows } from "../enrichment/source-tag";
import { deduplicateRows } from "../enrichment/deduplication";
import { scoreSource } from "../enrichment/source-scoring";
import { prisma } from "../db";

export function createGenericAdapter(
  config: DomainConfig,
  dedupeKeys: string[] = [],
): DomainAdapter {
  return {
    config,

    async fetchData(_plan: unknown, _locationArg: string): Promise<unknown[]> {
      // Load enabled sources from the DB ordered by confidence descending.
      // Higher-confidence sources are fetched first and appear first in results.
      // Fall back to the static config.sources array for adapters that predate
      // the DataSource model.
      const dbSources = await prisma.dataSource.findMany({
        where: { domainName: config.name, enabled: true },
        orderBy: { confidence: "desc" },
      });

      const sources = dbSources.length > 0 ? dbSources : (config.sources ?? []);

      if (sources.length === 0) return [];

      const results = await Promise.all(
        sources.map(async (source) => {
          let rows: unknown[] = [];
          const url = source.url;
          const type = source.type;
          let fetchSuccess = false;

          try {
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
              case "scrape": {
                const { createScrapeProvider } =
                  await import("../providers/scrape-provider");
                const extractionPrompt =
                  (source as any).extractionPrompt ??
                  `Extract all data items from this page at ${url}`;
                const provider = createScrapeProvider({ extractionPrompt });
                rows = await provider.fetchRows(url);
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

            fetchSuccess = true;
          } catch (err) {
            console.warn(
              `[GenericAdapter] fetch failed for ${url}:`,
              (err as Error).message,
            );
            rows = [];
            fetchSuccess = false;
          }

          // Update DataSource scoring after every fetch — non-blocking, never
          // propagates failure. Only applies to DB-backed sources (have an id).
          if ((source as any).id) {
            const newConfidence = scoreSource({
              current: (source as any).confidence ?? 1.0,
              success: fetchSuccess,
              rowCount: rows.length,
            });

            prisma.dataSource
              .update({
                where: { id: (source as any).id },
                data: {
                  confidence: newConfidence,
                  lastFetchedAt: new Date(),
                  lastRowCount: rows.length,
                },
              })
              .catch((err: Error) => {
                console.warn(
                  "[GenericAdapter] score update failed:",
                  err.message,
                );
              });
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
