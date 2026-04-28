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
  /**
   * Layer 3 engagement graph weights, keyed by "fromTemplate:toTemplate".
   * Obtained via getTemplateTransitionWeights() from engagement-graph.ts.
   *
   * Used to compute per-chip ranking multipliers for fetch_domain affinity chips:
   *   - Absent key → multiplier 1.0 (unobserved pair — no change to chip ranking)
   *   - Present key with low weight → multiplier < 1.0 (users rarely follow this path)
   *   - Present key with high weight → multiplier > 1.0 (users frequently follow this path)
   *
   * Requires `adapters` to look up template types for source/target domains.
   * If omitted, no multipliers are computed and all chips rank at their base score.
   */
  templateTransitionWeights?: Map<string, number>;
}

/**
 * Infer capabilities from result rows, generate all valid chips, rank them,
 * and return the top CHIP_DISPLAY_MAX (3) chips ready to send to the frontend.
 */
/**
 * Compute per-chip engagement multipliers for fetch_domain affinity chips.
 *
 * Looks up the (sourceTemplate → targetTemplate) weight from the engagement
 * graph and converts it to a ranking multiplier:
 *   - Unobserved pair (key absent) → no entry in returned map → multiplier 1.0
 *   - Observed pair, weight w → multiplier 0.5 + w  (range [0.5, 1.5])
 *
 * Only fetch_domain chips are scored — other chip types receive multiplier 1.0
 * by default (absent from the returned map).
 *
 * Exported for testing.
 */
export function computeEngagementMultipliers(
  chips: Chip[],
  sourceDomain: string,
  adapters: DomainAdapter[],
  transitionWeights: Map<string, number>,
): Map<string, number> {
  const multipliers = new Map<string, number>();
  if (transitionWeights.size === 0 || adapters.length === 0) return multipliers;

  const sourceAdapter = adapters.find(
    (a) => a.config.identity.name === sourceDomain,
  );
  const sourceTemplate = sourceAdapter?.config.template.type as string | undefined;
  if (!sourceTemplate) return multipliers;

  for (const chip of chips) {
    if (chip.action !== "fetch_domain" || !chip.args.domain) continue;
    const targetAdapter = adapters.find(
      (a) => a.config.identity.name === chip.args.domain,
    );
    const targetTemplate = targetAdapter?.config.template.type as string | undefined;
    if (!targetTemplate) continue;

    const transitionKey = `${sourceTemplate}:${targetTemplate}`;
    const weight = transitionWeights.get(transitionKey);
    if (weight === undefined) continue; // unobserved — leave at 1.0

    // Chip dedupe key must match chip-ranker.ts chipKey()
    const key = `${chip.action}:${chip.args.domain ?? ""}:${chip.args.constraint ?? ""}:${chip.args.field ?? ""}`;
    multipliers.set(key, 0.5 + weight); // range [0.5, 1.5]
  }

  return multipliers;
}

export function suggestFollowups(input: SuggestFollowupsInput): Chip[] {
  const {
    rows, domain, handleId, ephemeral, memory, clickCounts = {},
    domainRelationships = DOMAIN_RELATIONSHIPS as DomainRelationship[],
    adapters = [],
    domainBboxes,
    queryBbox,
    templateTransitionWeights,
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

  // Layer 3: compute engagement multipliers when transition weights are available
  const engagementMultipliers =
    templateTransitionWeights && templateTransitionWeights.size > 0
      ? computeEngagementMultipliers(chips, domain, adapters, templateTransitionWeights)
      : undefined;

  return rankChips({
    chips,
    handle,
    memory,
    domainRelationships,
    clickCounts,
    engagementMultipliers,
  });
}
