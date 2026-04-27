/**
 * domain-relationships.ts — Phase C.5
 *
 * Manually curated DomainRelationship seed entries used as the initial
 * relationshipWeight inputs to the chip ranker (C.4).
 *
 * These entries adjust the rank of already-valid chips — they do NOT gate
 * chip generation. A chip for "Food Hygiene Ratings nearby" appears because
 * the cinemas-gb result has a places template with listings affinity. The
 * entry for (cinemas-gb → food-hygiene-gb) boosts that chip's score above
 * other candidates.
 *
 * Weight semantics:
 *   0.9 — near-certain relevance (always go together)
 *   0.8 — high relevance (usually want one after the other)
 *   0.7 — strong relevance
 *   0.6 — moderate relevance
 *   0.5 — weak relevance (one possible input among several)
 *
 * C.12 (log-based discovery) will eventually auto-promote additional entries
 * from session co-occurrence patterns. These provide non-zero
 * relationshipWeight before enough usage data has accumulated.
 */

import type { DomainRelationship } from "./types/connected";

export const DOMAIN_RELATIONSHIPS: ReadonlyArray<DomainRelationship> = [
  // ── Story 2: Friday night ────────────────────────────────────────────────────
  // cinemas → food hygiene: people picking a cinema want nearby food/drink
  {
    fromDomain:       "cinemas-gb",
    toDomain:         "food-hygiene-gb",
    relationshipType: "complements",
    weight:           0.8,
  },
  // cinemas → weather: outdoor travel, open-air venues, evening conditions
  {
    fromDomain:       "cinemas-gb",
    toDomain:         "weather",
    relationshipType: "complements",
    weight:           0.65,
  },

  // ── Story 1 / 5: House move / School run ────────────────────────────────────
  // crime → food hygiene: area safety includes food establishment quality
  {
    fromDomain:       "crime-uk",
    toDomain:         "food-hygiene-gb",
    relationshipType: "complements",
    weight:           0.55,
  },
  // crime → weather: correlating crime spikes with weather conditions
  {
    fromDomain:       "crime-uk",
    toDomain:         "weather",
    relationshipType: "complements",
    weight:           0.45,
  },
  // crime → cinemas: checking what draws footfall to a high-crime area
  {
    fromDomain:       "crime-uk",
    toDomain:         "cinemas-gb",
    relationshipType: "complements",
    weight:           0.4,
  },

  // ── Story 1 / 3 / 4: Flood risk context ─────────────────────────────────────
  // flood-risk → weather: flood events closely track weather
  {
    fromDomain:       "flood-risk-gb",
    toDomain:         "weather",
    relationshipType: "complements",
    weight:           0.8,
  },
  // flood-risk → crime: stress events in flood zones
  {
    fromDomain:       "flood-risk-gb",
    toDomain:         "crime-uk",
    relationshipType: "complements",
    weight:           0.5,
  },

  // ── Story 6: Food entrepreneur ───────────────────────────────────────────────
  // food hygiene → cinemas: footfall proxy for site selection
  {
    fromDomain:       "food-hygiene-gb",
    toDomain:         "cinemas-gb",
    relationshipType: "complements",
    weight:           0.6,
  },
  // food hygiene → crime: site safety assessment
  {
    fromDomain:       "food-hygiene-gb",
    toDomain:         "crime-uk",
    relationshipType: "complements",
    weight:           0.55,
  },
];
