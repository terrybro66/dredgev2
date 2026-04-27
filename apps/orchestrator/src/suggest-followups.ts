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
 * Pass domainRelationships to include learned co-occurrence weights from Redis
 * (getMergedRelationships from relationship-discovery.ts). If omitted, falls
 * back to the static seed data.
 *
 * Pure function — no I/O, no async. Safe to call in hot-path.
 */

import { inferCapabilities, generateChips } from "./capability-inference";
import { rankChips } from "./chip-ranker";
import { DOMAIN_RELATIONSHIPS } from "./domain-relationships";
import { bboxOverlaps } from "./spatial-coverage";
import type { Bbox } from "./poly";
import type { Chip, ConversationMemory, DomainRelationship, ResultHandle } from "./types/connected";
import type { DomainAdapter } from "./domains/registry";

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
  /** Per-action chip click counts from the session (C.8). Empty object is safe. */
  clickCounts?: Record<string, number>;
  /**
   * Merged domain relationships (seeded + learned from Redis co-occurrence).
   * Obtain via getMergedRelationships() from relationship-discovery.ts.
   * Falls back to static DOMAIN_RELATIONSHIPS seed if omitted.
   */
  domainRelationships?: DomainRelationship[];
  /**
   * All currently registered domain adapters.
   * When provided, enables the template affinity engine — cross-domain
   * fetch_domain chips are emitted for compatible target domains.
   * Obtain via getAllAdapters() from domains/registry.ts.
   * Omitting disables cross-domain chip generation (safe default).
   */
  adapters?: DomainAdapter[];
  /**
   * Cached bounding boxes for registered domains, keyed by domain name.
   * Obtained via getDomainBboxes() from spatial-coverage.ts.
   * Used to suppress affinity chips for domains with no data in the current
   * area. If a domain has no entry, its chip is always shown (bootstrap).
   */
  domainBboxes?: Map<string, Bbox>;
  /**
   * Bounding box of the current query polygon.
   * Used alongside domainBboxes to filter out-of-area affinity chips.
   * Obtained via parsePoly(poly).toBbox().
   */
  queryBbox?: Bbox;
}

/**
 * Infer capabilities from result rows, generate all valid chips, rank them,
 * and return the top CHIP_DISPLAY_MAX (3) chips ready to send to the frontend.
 */
export function suggestFollowups(input: SuggestFollowupsInput): Chip[] {
  const {
    rows, domain, handleId, ephemeral, memory, clickCounts = {},
    domainRelationships = DOMAIN_RELATIONSHIPS as DomainRelationship[],
    adapters = [],
    domainBboxes,
    queryBbox,
  } = input;

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

  let allChips = generateChips(handle, adapters);

  // Spatial coverage filter: suppress fetch_domain affinity chips for domains
  // whose cached bbox doesn't overlap the current query area. Domains with no
  // cached bbox are kept (bootstrap — chip shown, may return empty).
  if (domainBboxes && queryBbox && domainBboxes.size > 0) {
    allChips = allChips.filter((chip) => {
      if (chip.action !== "fetch_domain" || !chip.args.domain) return true;
      const targetBbox = domainBboxes.get(chip.args.domain);
      if (!targetBbox) return true; // no cache entry → show the chip
      return bboxOverlaps(targetBbox, queryBbox);
    });
  }

  const chips = allChips;

  if (chips.length === 0) return [];

  return rankChips({
    chips,
    handle,
    memory,
    domainRelationships,
    clickCounts,
  });
}
