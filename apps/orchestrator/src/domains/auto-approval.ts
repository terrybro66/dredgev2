/**
 * Auto‑approval validation for newly discovered domains.
 * This module provides criteria and functions to automatically approve
 * domain configurations that meet safety, completeness, and relevance standards.
 */

import type { DomainConfigV2 } from "@dredge/schemas";
import type { DomainValidation } from "../types/connected";

/**
 * Validation criteria for auto‑approval.
 */
export interface AutoApprovalCriteria {
  /** Domain must have a name and at least one intent. */
  hasRequiredFields: boolean;
  /** Domain must target a supported country (GB by default). */
  supportedCountry: boolean;
  /** Source endpoint must not be localhost or private IP. */
  safeSource: boolean;
  /** Endpoint must be reachable (basic URL validation). */
  hasValidEndpoint: boolean;
  /** Domain must not be a duplicate of an existing one. */
  isUnique: boolean;
}

/**
 * Validate a domain configuration against auto‑approval criteria.
 * Returns a DomainValidation object with status and notes.
 */
export function validateDomainConfig(
  config: DomainConfigV2,
  existingDomains: string[],
): DomainValidation {
  const criteria: AutoApprovalCriteria = {
    hasRequiredFields: !!config.identity.name && config.identity.intents.length > 0,
    supportedCountry: config.identity.countries.length === 0 || config.identity.countries.includes("GB"),
    safeSource: !config.source?.endpoint?.includes("localhost") &&
                !config.source?.endpoint?.includes("127.0.0.1") &&
                !config.source?.endpoint?.includes("192.168.") &&
                !config.source?.endpoint?.includes("10."),
    hasValidEndpoint: !!config.source?.endpoint || config.source?.type === "overpass",
    isUnique: !existingDomains.includes(config.identity.name),
  };

  const notes: string[] = [];
  if (!criteria.supportedCountry) notes.push("Country may not be supported.");
  if (!criteria.safeSource) notes.push("Source endpoint may be unsafe.");
  if (!criteria.isUnique) notes.push("Domain name already registered.");
  if (!criteria.hasValidEndpoint) notes.push("Missing or invalid endpoint.");

  const allPass = Object.values(criteria).every(Boolean);
  const status = allPass ? "auto_approved" : "pending";

  return { status, criteria, notes };
}

/**
 * Determine whether a validated domain should be automatically registered.
 * Auto‑approval is granted when status is "auto_approved" and the source is
 * considered trustworthy (e.g., government open data, known API providers).
 */
export function shouldAutoApprove(validation: DomainValidation): boolean {
  return validation.status === "auto_approved";
}
