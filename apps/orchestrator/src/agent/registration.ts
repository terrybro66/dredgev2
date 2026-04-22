/**
 * apps/orchestrator/src/agent/registration.ts
 *
 * The registration step — converts an approved DomainDiscovery record into a
 * live adapter in the domain registry.
 *
 * Block D — ephemeral path (storeResults: false): implemented.
 * Block F — persistent path (storeResults: true): implemented.
 */

import type { DomainConfigV2, FieldDef } from "@dredge/schemas";
import { registerDomain, getDomainByName } from "../domains/registry";
import { createRestProvider } from "../providers/rest-provider";
import { tagRows } from "../enrichment/source-tag";
import { createPipelineAdapter } from "../domains/generic-adapter";

// ── Public interface ──────────────────────────────────────────────────────────

export interface RegisterOptions {
  discoveryId: string;
  proposedConfig: Record<string, unknown>;
  prisma: any;
}

export interface RegisterResult {
  path: "ephemeral" | "persistent";
  domainName: string;
}

export async function registerDiscoveredDomain(
  opts: RegisterOptions,
): Promise<RegisterResult> {
  const { discoveryId, proposedConfig, prisma } = opts;

  // ── 1. Validate ─────────────────────────────────────────────────────────────

  const name = proposedConfig.name as string | undefined;
  const apiUrl = proposedConfig.apiUrl as string | undefined;

  if (!name || typeof name !== "string" || name.trim() === "") {
    throw new Error("proposedConfig.name is required");
  }
  if (!apiUrl || typeof apiUrl !== "string" || apiUrl.trim() === "") {
    throw new Error("proposedConfig.apiUrl is required");
  }

  // ── 2. Check for duplicates ──────────────────────────────────────────────────

  const existing = getDomainByName(name);
  if (existing) {
    throw new Error(
      `Domain "${name}" is already registered — cannot register again`,
    );
  }

  const storeResults = (proposedConfig.storeResults as boolean) ?? true;

  // ── 3. Branch on storeResults ────────────────────────────────────────────────

  if (!storeResults) {
    return registerEphemeral({
      name,
      apiUrl,
      proposedConfig,
      discoveryId,
      prisma,
    });
  }

  return registerPersistent({
    name,
    apiUrl,
    proposedConfig,
    discoveryId,
    prisma,
  });
}

// ── Shared internal opts type ─────────────────────────────────────────────────

interface PathOpts {
  name: string;
  apiUrl: string;
  proposedConfig: Record<string, unknown>;
  discoveryId: string;
  prisma: any;
}

// ── Ephemeral path ────────────────────────────────────────────────────────────

async function registerEphemeral(opts: PathOpts): Promise<RegisterResult> {
  const { name, apiUrl, proposedConfig, discoveryId, prisma } = opts;

  const intent = (proposedConfig.intent as string) ?? name;
  const country_code = (proposedConfig.country_code as string) ?? "";
  const refreshPolicy = (proposedConfig.refreshPolicy as string) ?? "realtime";
  const fieldMap = (proposedConfig.fieldMap as object) ?? {};
  const providerType = (proposedConfig.providerType as string) ?? "rest";

  // 3a. Create DataSource record
  await prisma.dataSource.create({
    data: {
      domainName: name,
      name,
      url: apiUrl,
      type: providerType,
      fieldMap,
      refreshPolicy,
      storeResults: false,
      discoveredBy: "catalogue",
      enabled: true,
    },
  });

  // 3b. Build and register fetch-and-discard adapter
  const templateType = (proposedConfig.templateType as string) ?? "listings";
  const ephemeralConfig: DomainConfigV2 = {
    identity: {
      name,
      displayName: name,
      description: name,
      countries: country_code ? [country_code] : [],
      intents: [intent],
    },
    source: { type: "rest", endpoint: apiUrl },
    template: { type: templateType as any, capabilities: {} },
    fields: {},
    time: { type: "static" },
    recovery: [],
    storage: {
      storeResults: false,
      tableName: "query_results",
      prismaModel: "queryResult",
      extrasStrategy: "retain_unmapped",
    },
    visualisation: { default: "table", rules: [] },
  };
  registerDomain({
    config: ephemeralConfig,

    async fetchData(_plan: unknown, _locationArg: string): Promise<unknown[]> {
      try {
        const provider = createRestProvider({ url: apiUrl });
        const rows = await provider.fetchRows();
        return tagRows(rows as Record<string, unknown>[], apiUrl);
      } catch {
        return [];
      }
    },

    flattenRow(row: unknown): Record<string, unknown> {
      return row as Record<string, unknown>;
    },

    // Ephemeral: no DB write, no cache, no snapshot.
    async storeResults(
      _queryId: string,
      _rows: unknown[],
      _prisma: unknown,
    ): Promise<void> {
      return;
    },
  });

  // 3c. Mark discovery record as registered
  await prisma.domainDiscovery.update({
    where: { id: discoveryId },
    data: { status: "registered" },
  });

  return { path: "ephemeral", domainName: name };
}

// ── Persistent path ───────────────────────────────────────────────────────────

async function registerPersistent(opts: PathOpts): Promise<RegisterResult> {
  const { name, apiUrl, proposedConfig, discoveryId, prisma } = opts;

  const intent = (proposedConfig.intent as string) ?? name;
  const country_code = (proposedConfig.country_code as string) ?? "";
  const refreshPolicy = (proposedConfig.refreshPolicy as string) ?? "weekly";
  const fieldMap = (proposedConfig.fieldMap as object) ?? {};
  const providerType = (proposedConfig.providerType as string) ?? "rest";

  // 3a. Create DataSource record
  await prisma.dataSource.create({
    data: {
      domainName: name,
      name,
      url: apiUrl,
      type: providerType,
      fieldMap,
      refreshPolicy,
      storeResults: true,
      discoveredBy: "catalogue",
      enabled: true,
    },
  });

  // 3b. Register a full pipeline adapter with storage.
  // Convert the flat fieldMap (source → target) from the discovery proposedConfig
  // into the FieldDef format that createPipelineAdapter expects. All discovered
  // fields are treated as strings; type inference is a Phase 1 enhancement.
  const flatMap = fieldMap as Record<string, string>;
  const fields: Record<string, FieldDef> = {};
  for (const [source, target] of Object.entries(flatMap)) {
    fields[String(target)] = { source: String(source), type: "string", role: "label" };
  }

  const templateType = (proposedConfig.templateType as string) ?? "listings";
  const persistentConfig: DomainConfigV2 = {
    identity: {
      name,
      displayName: name,
      description: name,
      countries: country_code ? [country_code] : [],
      intents: [intent],
    },
    source: { type: "rest", endpoint: apiUrl },
    template: { type: templateType as any, capabilities: {} },
    fields,
    time: { type: "static" },
    recovery: [],
    storage: {
      storeResults: true,
      tableName: "query_results",
      prismaModel: "queryResult",
      extrasStrategy: "retain_unmapped",
    },
    visualisation: { default: "table", rules: [] },
  };
  const adapter = createPipelineAdapter(persistentConfig);

  registerDomain(adapter);

  // 3c. Mark discovery record as registered
  await prisma.domainDiscovery.update({
    where: { id: discoveryId },
    data: { status: "registered" },
  });

  return { path: "persistent", domainName: name };
}
