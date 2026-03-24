/**
 * apps/orchestrator/src/agent/registration.ts
 *
 * The registration step — converts an approved DomainDiscovery record into a
 * live adapter in the domain registry.
 *
 * Block D implements the ephemeral path (storeResults: false).
 * Block F implements the persistent path (storeResults: true).
 *
 * This stub is the interface contract. The admin approval endpoint (Block C)
 * calls this function — it must be importable and type-correct before Block D
 * fills in the implementation.
 */

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
  _opts: RegisterOptions,
): Promise<RegisterResult> {
  throw new Error(
    "registerDiscoveredDomain not yet implemented — see Block D (ephemeral path) and Block F (persistent path)",
  );
}
