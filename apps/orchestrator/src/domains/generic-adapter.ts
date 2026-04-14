import type {
  DomainConfig,
  DomainConfigV2,
  FieldDef,
  FallbackInfo,
} from "@dredge/schemas";
import type { DomainAdapter } from "./registry";
import { createRestProvider, restGet } from "../providers/rest-provider";
import { createCsvProvider } from "../providers/csv-provider";
import { createXlsxProvider } from "../providers/xlsx-provider";
import { createPdfProvider } from "../providers/pdf-provider";
import { tagRows } from "../enrichment/source-tag";
import { deduplicateRows } from "../enrichment/deduplication";
import { scoreSource } from "../enrichment/source-scoring";
import { prisma } from "../db";

// ── Dot-path resolver ─────────────────────────────────────────────────────────

function resolvePath(obj: unknown, path: string): unknown {
  if (obj === null || obj === undefined) return undefined;
  const parts = path.split(".");
  let current: unknown = obj;
  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

// ── Type coercion ─────────────────────────────────────────────────────────────

function coerce(value: unknown, fieldDef: FieldDef): unknown {
  if (value === null || value === undefined) return null;
  if (fieldDef.type === "number") {
    const n = Number(value);
    return isNaN(n) ? null : n;
  }
  if (fieldDef.type === "boolean") {
    if (typeof value === "boolean") return value;
    return value === "true" || value === "1";
  }
  return value;
}

// ── Transforms ────────────────────────────────────────────────────────────────

function applyTransform(value: unknown, transform: string): unknown {
  if (transform === "humanise_category" && typeof value === "string") {
    return value
      .split(/[-_]/)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ");
  }
  return value;
}

// ── Poly centroid ─────────────────────────────────────────────────────────────

function polyCentroid(poly: string): { lat: number; lon: number } | null {
  if (!poly) return null;
  const pts = poly.split(":").map((p) => {
    const [lat, lon] = p.split(",").map(Number);
    return { lat, lon };
  });
  if (pts.length === 0) return null;
  const lat = pts.reduce((s, p) => s + p.lat, 0) / pts.length;
  const lon = pts.reduce((s, p) => s + p.lon, 0) / pts.length;
  return { lat, lon };
}

// ── URL token substitution ────────────────────────────────────────────────────

function buildUrl(endpoint: string, plan: any, poly: string): string {
  let url = endpoint;
  const centroid = polyCentroid(poly);
  if (centroid) {
    url = url
      .replace("{lat}", String(centroid.lat.toFixed(6)))
      .replace("{lon}", String(centroid.lon.toFixed(6)));
  }
  if (plan?.date_from) {
    url = url.replace("{YYYY-MM}", plan.date_from);
  }
  return url;
}

// ── Row normalisation (NORMALISE step) ────────────────────────────────────────

function normaliseRow(
  raw: unknown,
  fields: Record<string, FieldDef>,
  extrasStrategy: "retain_unmapped" | "discard",
): Record<string, unknown> {
  const rawObj = raw as Record<string, unknown>;
  const canonical: Record<string, unknown> = {};
  const mappedSourcePaths = new Set<string>();

  for (const [canonicalName, fieldDef] of Object.entries(fields)) {
    mappedSourcePaths.add(fieldDef.source.split(".")[0]);
    let value = resolvePath(rawObj, fieldDef.source);
    value = coerce(value, fieldDef);
    if (fieldDef.normalise && fieldDef.transform) {
      value = applyTransform(value, fieldDef.transform);
    }
    canonical[canonicalName] = value ?? null;
  }

  // Extras — fields present in raw but not mapped via config.fields
  if (extrasStrategy === "retain_unmapped") {
    const extras: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(rawObj)) {
      if (!mappedSourcePaths.has(key)) {
        extras[key] = val;
      }
    }
    canonical.extras = Object.keys(extras).length > 0 ? extras : null;
  } else {
    canonical.extras = null;
  }

  // Always keep the full raw row for JSONB storage
  canonical.raw = rawObj;

  return canonical;
}

// ── Fetch rows from source ────────────────────────────────────────────────────

async function fetchRawRows(
  config: DomainConfigV2,
  plan: any,
  poly: string,
): Promise<unknown[]> {
  const url = buildUrl(config.source.endpoint, plan, poly);

  try {
    switch (config.source.type) {
      case "rest": {
        const provider = createRestProvider({ url });
        return await provider.fetchRows();
      }
      case "csv": {
        const text = await restGet<string>({ url });
        const provider = createCsvProvider({ content: text });
        return await provider.fetchRows();
      }
      case "xlsx": {
        const buffer = await restGet<Buffer>({ url });
        const provider = createXlsxProvider({ buffer });
        return await provider.fetchRows();
      }
      case "scrape": {
        const { createScrapeProvider } =
          await import("../providers/scrape-provider");
        const provider = createScrapeProvider({
          extractionPrompt: `Extract all data items from this page at ${url}`,
        });
        return await provider.fetchRows(url);
      }
      default:
        return [];
    }
  } catch (err) {
    console.warn(
      JSON.stringify({
        event: "pipeline_fetch_error",
        domain: config.identity.name,
        url,
        error: err instanceof Error ? err.message : String(err),
      }),
    );
    return [];
  }
}

// ── createPipelineAdapter ─────────────────────────────────────────────────────

export function createPipelineAdapter(config: DomainConfigV2): DomainAdapter {
  const domainName = config.identity.name;

  // Compatibility shim — query.ts reads adapter.config.vizHintRules.defaultHint
  // and adapter.config.name / intents / countries from the flat DomainConfig shape.
  // We attach these directly so query.ts needs no changes during migration.
  const compatConfig = {
    // V2 fields
    ...config,
    // Flat compat fields query.ts still reads
    name: domainName,
    intents: config.identity.intents,
    countries: config.identity.countries,
    vizHintRules: {
      defaultHint: config.visualisation.default,
      multiMonthHint:
        config.visualisation.rules.find((r) => r.condition === "multi_month")
          ?.view ?? config.visualisation.default,
    },
    tableName: config.storage.tableName,
    prismaModel: config.storage.prismaModel,
  } as unknown as DomainConfig;

  return {
    config: compatConfig,

    // ── fetchData ───────────────────────────────────────────────────────────
    async fetchData(plan: unknown, poly: string): Promise<unknown[]> {
      const rawRows = await fetchRawRows(config, plan, poly);
      return rawRows.map((row) =>
        normaliseRow(row, config.fields, config.storage.extrasStrategy),
      );
    },

    // ── flattenRow ──────────────────────────────────────────────────────────
    // Always normalises via config.fields — no pass-through guard.
    flattenRow(row: unknown): Record<string, unknown> {
      return normaliseRow(
        row as Record<string, unknown>,
        config.fields,
        config.storage.extrasStrategy,
      );
    },

    // ── storeResults ────────────────────────────────────────────────────────
    async storeResults(
      queryId: string,
      rows: unknown[],
      prismaClient: any,
    ): Promise<void> {
      if (rows.length === 0) return;
      const model = prismaClient[config.storage.prismaModel];
      if (!model) {
        console.warn(
          JSON.stringify({
            event: "pipeline_store_error",
            domain: domainName,
            error: `Prisma model '${config.storage.prismaModel}' not found`,
          }),
        );
        return;
      }
      await model.createMany({
        data: (rows as Record<string, unknown>[]).map((row) => ({
          query_id: queryId,
          domain_name: domainName,
          source_tag: (row.source_tag as string) ?? domainName,
          date: row.date ? new Date(row.date as string) : null,
          lat: (row.lat as number) ?? null,
          lon: (row.lon as number) ?? null,
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

    // ── recoverFromEmpty ────────────────────────────────────────────────────
    async recoverFromEmpty(
      plan: any,
      poly: string,
      _prismaClient: any,
    ): Promise<{ data: unknown[]; fallback: FallbackInfo } | null> {
      if (config.recovery.length === 0) return null;

      for (const strategy of config.recovery) {
        if (strategy.strategy === "shift_time") {
          const maxAttempts = strategy.maxAttempts ?? 3;
          const stepMonths = strategy.step === "1_month" ? 1 : 1;
          let shiftedPlan = { ...plan };

          for (let attempt = 0; attempt < maxAttempts; attempt++) {
            // Shift date back by stepMonths
            const [year, month] = shiftedPlan.date_from.split("-").map(Number);
            const shifted = new Date(year, month - 1 - stepMonths, 1);
            const newDate = `${shifted.getFullYear()}-${String(shifted.getMonth() + 1).padStart(2, "0")}`;
            shiftedPlan = {
              ...shiftedPlan,
              date_from: newDate,
              date_to: newDate,
            };

            const rawRows = await fetchRawRows(config, shiftedPlan, poly);
            if (rawRows.length > 0) {
              const data = rawRows.map((row) =>
                normaliseRow(row, config.fields, config.storage.extrasStrategy),
              );
              return {
                data,
                fallback: {
                  field: "date",
                  original: plan.date_from,
                  used: newDate,
                  explanation: `No data for ${plan.date_from} — showing ${newDate} instead.`,
                },
              };
            }
          }
        }
      }

      return null;
    },
  };
}

// ── createGenericAdapter (legacy — flat DomainConfig) ────────────────────────
// Kept intact so registry.ts dynamic domain loading continues to work
// until Phase 1 migrates discovered domains to DomainConfigV2.

export function createGenericAdapter(
  config: DomainConfig,
  dedupeKeys: string[] = [],
): DomainAdapter {
  return {
    config,

    async fetchData(_plan: unknown, _locationArg: string): Promise<unknown[]> {
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
            fetchSuccess = false;
          }

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
              .catch((err: Error) =>
                console.warn(
                  "[GenericAdapter] score update failed:",
                  err.message,
                ),
              );
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
