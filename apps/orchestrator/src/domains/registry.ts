import { DomainConfig, FallbackInfo } from "@dredge/schemas";
import { crimeUkAdapter } from "./crime-uk/index";
import { weatherAdapter } from "./weather/index";
import { createGenericAdapter } from "./generic-adapter";
import { createRestProvider } from "../providers/rest-provider";
import { tagRows } from "../enrichment/source-tag";
import { prisma } from "../db";

// ── DomainAdapter interface ───────────────────────────────────────────────────

export interface DomainAdapter {
  config: DomainConfig;
  fetchData: (plan: any, locationArg: string) => Promise<unknown[]>;
  flattenRow: (row: unknown) => Record<string, unknown>;
  storeResults: (
    queryId: string,
    rows: unknown[],
    prisma: any,
  ) => Promise<void>;
  recoverFromEmpty?: (
    plan: any,
    locationArg: string,
    prisma: any,
  ) => Promise<{ data: unknown[]; fallback: FallbackInfo } | null>;
  onLoad?: () => void | Promise<void>;
}

// ── Registry ──────────────────────────────────────────────────────────────────

const registry = new Map<string, DomainAdapter>();

export function registerDomain(adapter: DomainAdapter): void {
  registry.set(adapter.config.name, adapter);
}

export function getDomainForQuery(
  countryCode: string,
  intent: string,
): DomainAdapter | undefined {
  for (const adapter of registry.values()) {
    const intentMatch = adapter.config.intents.includes(intent);
    const countryMatch =
      adapter.config.countries.length === 0 ||
      adapter.config.countries.includes(countryCode);
    if (intentMatch && countryMatch) return adapter;
  }
  return undefined;
}

export function getDomainByName(name: string): DomainAdapter | undefined {
  return registry.get(name);
}

export async function loadDomains(): Promise<void> {
  // 1. Built-in static adapters
  const adapters = [crimeUkAdapter, weatherAdapter];
  for (const adapter of adapters) {
    registerDomain(adapter);

    // Seed a DataSource record for each built-in adapter so the DB
    // reflects the static config from day one. Upsert is idempotent —
    // calling loadDomains() twice never creates duplicate records.
    await prisma.dataSource.upsert({
      where: {
        domainName_url: {
          domainName: adapter.config.name,
          url: adapter.config.apiUrl,
        },
      },
      update: {}, // no updates — static adapters don't change at runtime
      create: {
        domainName: adapter.config.name,
        name: adapter.config.name,
        url: adapter.config.apiUrl,
        type: "rest",
        fieldMap: (adapter.config.flattenRow as object) ?? {},
        refreshPolicy:
          adapter.config.cacheTtlHours === 0 ? "realtime" : "weekly",
        storeResults: true,
        discoveredBy: "manual",
        enabled: true,
      },
    });

    if (adapter.onLoad) {
      await adapter.onLoad();
    }
  }

  // 2. Dynamically registered domains — reload from approved DomainDiscovery
  //    records so domains survive server restarts.
  const registered = await prisma.domainDiscovery.findMany({
    where: { status: "registered" },
  });

  for (const record of registered) {
    const config = record.proposed_config as Record<string, unknown> | null;
    if (!config) continue;

    const name = config.name as string | undefined;
    const apiUrl = config.apiUrl as string | undefined;
    if (!name || !apiUrl) continue;

    // Skip if already in registry (built-in takes precedence)
    if (getDomainByName(name)) continue;

    const storeResults = (config.storeResults as boolean) ?? true;
    const intent = (config.intent as string) ?? name;
    const country_code = (config.country_code as string) ?? "";
    const fieldMap = (config.fieldMap as Record<string, string>) ?? {};

    if (storeResults) {
      registerDomain(
        createGenericAdapter({
          name,
          tableName: "query_results",
          prismaModel: "queryResult",
          storeResults: true,
          countries: country_code ? [country_code] : [],
          intents: [intent],
          apiUrl,
          apiKeyEnv: null,
          locationStyle: "coordinates",
          params: {},
          flattenRow: fieldMap,
          categoryMap: {},
          vizHintRules: { defaultHint: "table", multiMonthHint: "table" },
          cacheTtlHours: null,
        }),
      );
    } else {
      const url = apiUrl; // capture for closure
      registerDomain({
        config: {
          name,
          tableName: "query_results",
          prismaModel: "queryResult",
          storeResults: false,
          countries: country_code ? [country_code] : [],
          intents: [intent],
          apiUrl: url,
          apiKeyEnv: null,
          locationStyle: "coordinates",
          params: {},
          flattenRow: fieldMap,
          categoryMap: {},
          vizHintRules: { defaultHint: "table", multiMonthHint: "table" },
          cacheTtlHours: null,
        },
        async fetchData(_plan: unknown, _loc: string): Promise<unknown[]> {
          try {
            const provider = createRestProvider({ url });
            const rows = await provider.fetchRows();
            return tagRows(rows as Record<string, unknown>[], url);
          } catch {
            return [];
          }
        },
        flattenRow: (row: unknown) => row as Record<string, unknown>,
        async storeResults(): Promise<void> {
          return;
        },
      });
    }

    console.log(
      JSON.stringify({
        event: "dynamic_domain_reloaded",
        name,
        intent,
        storeResults,
      }),
    );
  }
}

export function clearRegistry(): void {
  registry.clear();
}
