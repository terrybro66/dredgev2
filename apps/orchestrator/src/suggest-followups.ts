/**
 * suggest-followups.ts — Phase C.6
 *
 * suggestFollowups() is the domain-agnostic post-result hook that wires:
 *   C.3 — inferCapabilities + generateChips  (capability-inference.ts)
 *   C.4 — rankChips                          (chip-ranker.ts)
 *   C.5 — DOMAIN_RELATIONSHIPS seed data     (domain-relationships.ts)
 *
 * Call this after every successful query execution and include the returned
 * Chip[] in the response. It replaces the domain-specific generateFollowUps()
 * for domains that do not need bespoke chip logic.
 *
 * Pure function — no I/O, no async. Safe to call in hot-path.
 */

import { inferCapabilities, generateChips } from "./capability-inference";
import { rankChips } from "./chip-ranker";
import { DOMAIN_RELATIONSHIPS } from "./domain-relationships";
import type { Chip, ConversationMemory, DomainRelationship, ResultHandle } from "./types/connected";

export interface SuggestFollowupsInput {
  /** Result rows from the adapter (used for capability inference). */
  rows: unknown[];
  /** Adapter domain name, e.g. "crime-uk", "flood-risk". */
  domain: string;
  /**
   * Stable identifier for this result in the response.
   * Persistent results: "qr_{queryId}"
   * Ephemeral results:  "ephemeral_{uuid}"
   */
  handleId: string;
  /** true for scrape/live results; false for stored query_results. */
  ephemeral: boolean;
  /** Current session memory — used for recency and spatial relevance scoring. */
  memory: ConversationMemory;
}

/**
 * Infer capabilities from result rows, generate all valid chips, rank them,
 * and return the top CHIP_DISPLAY_MAX (3) chips ready to send to the frontend.
 */
export function suggestFollowups(input: SuggestFollowupsInput): Chip[] {
  const { rows, domain, handleId, ephemeral, memory } = input;

  const capabilities = inferCapabilities(rows);

  const handle: ResultHandle = {
    id:           handleId,
    type:         domain,
    domain,
    capabilities,
    ephemeral,
    rowCount:     rows.length,
    data:         ephemeral ? rows : null,
  };

  const chips = generateChips(handle);

  if (chips.length === 0) return [];

  return rankChips({
    chips,
    handle,
    memory,
    domainRelationships: DOMAIN_RELATIONSHIPS as DomainRelationship[],
  });
}
