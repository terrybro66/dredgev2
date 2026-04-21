import { DomainConfigV2, FallbackInfo } from "@dredge/schemas";
import { crimeUkAdapter } from "./crime-uk/index";
import { weatherAdapter } from "./weather/index";
import { cinemasGbAdapter } from "./cinemas-gb/index";
import { foodHygieneGbAdapter } from "./food-hygiene-gb/index";
import { createPipelineAdapter } from "./generic-adapter";
import { createRestProvider } from "../providers/rest-provider";
import { tagRows } from "../enrichment/source-tag";
import { prisma } from "../db";
import { geocoderAdapter } from "./geocoder/index";
import { travelEstimatorAdapter } from "./travel-estimator/index";

// ── DomainAdapter interface ───────────────────────────────────────────────────

export interface DomainAdapter {
  config: DomainConfigV2;
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
  normalizePlan?: (plan: any) => any;
  onLoad?: () => void | Promise<void>;
  /**
   * Phase D — resolve a free-text temporal expression to a concrete date range.
   * Adapters that read from the availability cache (e.g. crime-uk) implement
   * this so that "last month" anchors to the latest published data, not the
   * calendar. Optional — the /parse handler falls back to
   * defaultResolveTemporalRange when absent.
   */
  resolveTemporalRange?: (
    temporal: string,
  ) => Promise<{ date_from: string; date_to: string }>;
}

// ── Registry ──────────────────────────────────────────────────────────────────

const registry = new Map<string, DomainAdapter>();

export function registerDomain(adapter: DomainAdapter): void {
  registry.set(adapter.config.identity.name, adapter);
}

export function getDomainForQuery(
  countryCode: string,
  intent: string,
): DomainAdapter | undefined {
  for (const adapter of registry.values()) {
    const intentMatch = adapter.config.identity.intents.includes(intent);
    const countryMatch =
      adapter.config.identity.countries.length === 0 ||
      adapter.config.identity.countries.includes(countryCode);
    if (intentMatch && countryMatch) return adapter;
  }
  return undefined;
}

export function getDomainByName(name: string): DomainAdapter | undefined {
  return registry.get(name);
}

// ── Helper: derive a canonical source URL from a DomainConfigV2 ───────────────

function getSourceEndpoint(config: DomainConfigV2): string {
  if (config.source.type === "overpass") {
    return "https://overpass-api.de/api/interpreter";
  }
  return (config.source as { endpoint: string }).endpoint ?? "";
}

export async function loadDomains(): Promise<void> {
  // 1. Built-in static adapters
  // Data domain adapters — these will be replaced by DB-seeded configs in Phase 0.5.
  // geocoderAdapter and travelEstimatorAdapter are pipeline primitives, not data
  // domains — they stay hardcoded permanently.
  const adapters = [
    crimeUkAdapter,
    weatherAdapter,
    cinemasGbAdapter,
    foodHygieneGbAdapter,
    geocoderAdapter,
    travelEstimatorAdapter,
  ];
  for (const adapter of adapters) {
    registerDomain(adapter);

    const domainName = adapter.config.identity.name;
    const sourceUrl = getSourceEndpoint(adapter.config);

    // Skip upsert for internal/non-URL endpoints (e.g. travel-estimator)
    if (!sourceUrl || sourceUrl.startsWith("internal:")) {
      if (adapter.onLoad) {
        await adapter.onLoad();
      }
      continue;
    }

    // Seed a DataSource record for each built-in adapter so the DB
    // reflects the static config from day one. Upsert is idempotent —
    // calling loadDomains() twice never creates duplicate records.
    await prisma.dataSource.upsert({
      where: {
        domainName_url: {
          domainName: domainName,
          url: sourceUrl,
        },
      },
      update: {}, // no updates — static adapters don't change at runtime
      create: {
        domainName: domainName,
        name: domainName,
        url: sourceUrl,
        type: "rest",
        fieldMap: {},
        refreshPolicy:
          adapter.config.cache?.ttlHours === 0 ? "realtime" : "weekly",
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
    const rawFieldMap = (config.fieldMap as Record<string, string>) ?? {};

    // Convert flat fieldMap (source → target) to FieldDef format so
    // createPipelineAdapter can perform proper row normalisation.
    // All dynamically discovered fields are typed as strings; richer
    // type inference is a future enhancement.
    const fields: DomainConfigV2["fields"] = {};
    for (const [source, target] of Object.entries(rawFieldMap)) {
      fields[String(target)] = { source: String(source), type: "string", role: "label" };
    }

    const dynamicConfig: DomainConfigV2 = {
      identity: {
        name,
        displayName: name,
        description: name,
        countries: country_code ? [country_code] : [],
        intents: [intent],
      },
      source: { type: "rest", endpoint: apiUrl },
      template: { type: "listings", capabilities: {} },
      fields,
      time: { type: "static" },
      recovery: [],
      storage: {
        storeResults,
        tableName: "query_results",
        prismaModel: "queryResult",
        extrasStrategy: "retain_unmapped",
      },
      visualisation: { default: "table", rules: [] },
    };

    if (storeResults) {
      // Use createPipelineAdapter — consistent with registerPersistent() in
      // registration.ts so restart behaviour matches first-registration behaviour.
      registerDomain(createPipelineAdapter(dynamicConfig));
    } else {
      const url = apiUrl; // capture for closure
      registerDomain({
        config: dynamicConfig,
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

export function getAllAdapters(): DomainAdapter[] {
  return [...registry.values()];
}

export function clearRegistry(): void {
  registry.clear();
}
