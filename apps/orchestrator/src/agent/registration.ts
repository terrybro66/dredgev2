/**
 * apps/orchestrator/src/agent/registration.ts
 *
 * The registration step — converts an approved DomainDiscovery record into a
 * live adapter in the domain registry.
 *
 * Block D — ephemeral path (storeResults: false): implemented.
 * Block F — persistent path (storeResults: true): not yet implemented.
 */

import { registerDomain, getDomainByName } from "../domains/registry";
import { createRestProvider } from "../providers/rest-provider";
import { tagRows } from "../enrichment/source-tag";

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

  // Persistent path — Block F
  throw new Error(
    "Persistent registration (storeResults: true) not yet implemented — see Block F",
  );
}

// ── Ephemeral path ────────────────────────────────────────────────────────────

async function registerEphemeral(opts: {
  name: string;
  apiUrl: string;
  proposedConfig: Record<string, unknown>;
  discoveryId: string;
  prisma: any;
}): Promise<RegisterResult> {
  const { name, apiUrl, proposedConfig, discoveryId, prisma } = opts;

  const intent = (proposedConfig.intent as string) ?? name;
  const country_code = (proposedConfig.country_code as string) ?? "";
  const refreshPolicy = (proposedConfig.refreshPolicy as string) ?? "realtime";
  const fieldMap = (proposedConfig.fieldMap as object) ?? {};
  const providerType = (proposedConfig.providerType as string) ?? "rest";

  // ── 3a. Create DataSource record ─────────────────────────────────────────────

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

  // ── 3b. Build and register fetch-and-discard adapter ─────────────────────────

  registerDomain({
    config: {
      name,
      tableName: "query_results",
      prismaModel: "queryResult",
      storeResults: false,
      countries: country_code ? [country_code] : [],
      intents: [intent],
      apiUrl,
      apiKeyEnv: null,
      locationStyle: "coordinates",
      params: {},
      flattenRow: fieldMap as Record<string, string>,
      categoryMap: {},
      vizHintRules: { defaultHint: "table", multiMonthHint: "table" },
      cacheTtlHours: null,
    },

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

    // Ephemeral: storeResults is intentionally a no-op.
    // No rows written to query_results, no cache, no snapshot.
    async storeResults(
      _queryId: string,
      _rows: unknown[],
      _prisma: unknown,
    ): Promise<void> {
      return;
    },
  });

  // ── 3c. Mark discovery record as registered ───────────────────────────────────

  await prisma.domainDiscovery.update({
    where: { id: discoveryId },
    data: { status: "registered" },
  });

  return { path: "ephemeral", domainName: name };
}
