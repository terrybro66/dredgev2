import { DomainConfig, FallbackInfo } from "@dredge/schemas";
import { crimeUkAdapter } from "./crime-uk";
import { weatherAdapter } from "./weather";

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

export function loadDomains(): void {
  registerDomain(crimeUkAdapter);
  registerDomain(weatherAdapter);
}

export function clearRegistry(): void {
  registry.clear();
}
