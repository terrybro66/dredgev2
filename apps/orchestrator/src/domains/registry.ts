import { DomainConfig, FallbackInfo } from "@dredge/schemas";
import { crimeUkAdapter } from "./crime-uk/index";
import { weatherAdapter } from "./weather/index";
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
}

export function clearRegistry(): void {
  registry.clear();
}
