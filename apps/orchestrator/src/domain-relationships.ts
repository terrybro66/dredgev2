/**
 * domain-relationships.ts — Phase C.5
 *
 * Five manually curated DomainRelationship entries used as the initial
 * relationshipWeight inputs to the chip ranker (C.4).
 *
 * These entries adjust the rank of already-valid chips — they do NOT gate
 * chip generation. A chip for "Get directions" appears because the result
 * has_coordinates. The entry for (cinema-listings → transport) boosts that
 * chip's score above other candidates when the current result is cinema data.
 *
 * C.12 (log-based discovery) will eventually auto-promote additional entries
 * from session co-occurrence patterns. Until then these five provide non-zero
 * relationshipWeight for the most common cross-domain transitions.
 *
 * Weight semantics:
 *   0.9 — near-certain relevance (floods always disrupt transport)
 *   0.8 — high relevance (cinema visitors almost always need directions)
 *   0.7 — strong relevance (flood events track weather closely)
 *   0.6 — moderate relevance (transport hubs → nearby entertainment)
 *   0.5 — weak relevance (crime data is one input to journey planning)
 */

import type { DomainRelationship } from "./types/connected";

export const DOMAIN_RELATIONSHIPS: ReadonlyArray<DomainRelationship> = [
  {
    fromDomain:       "flood-risk",
    toDomain:         "transport",
    relationshipType: "complements",
    weight:           0.9,
  },
  {
    fromDomain:       "cinema-listings",
    toDomain:         "transport",
    relationshipType: "complements",
    weight:           0.8,
  },
  {
    fromDomain:       "flood-risk",
    toDomain:         "weather",
    relationshipType: "complements",
    weight:           0.7,
  },
  {
    fromDomain:       "transport",
    toDomain:         "cinema-listings",
    relationshipType: "extends",
    weight:           0.6,
  },
  {
    fromDomain:       "crime-uk",
    toDomain:         "transport",
    relationshipType: "complements",
    weight:           0.5,
  },

  // D.10 — hunting zones → transport (need travel to reach zones)
  {
    fromDomain:       "hunting-zones-gb",
    toDomain:         "transport",
    relationshipType: "complements",
    weight:           0.9,
  },
  // D.10 — hunting zones → weather (conditions affect a day's shoot)
  {
    fromDomain:       "hunting-zones-gb",
    toDomain:         "weather",
    relationshipType: "complements",
    weight:           0.7,
  },
];
