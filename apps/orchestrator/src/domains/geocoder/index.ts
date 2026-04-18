/**
 * domains/geocoder/index.ts — Phase E.3
 *
 * Geocoder domain adapter — wraps the existing Nominatim geocoder so the
 * workflow executor can call it as a first-class step.
 *
 * fetchData(plan, locationArg) → [{ lat, lon, description, location }]
 * Returns a single-row result. The workflow executor reads
 * step_output.lat and step_output.lon via dot-path resolution on row[0].
 */

import type { DomainConfigV2 } from "@dredge/schemas";
import type { DomainAdapter } from "../registry";
import { geocodeToCoordinates } from "../../geocoder";
import { prisma } from "../../db";

export const geocoderAdapter: DomainAdapter = {
  config: {
    identity: {
      name: "geocoder",
      displayName: "Geocoder",
      description: "Nominatim geocoding — converts place names to coordinates",
      countries: [],
      intents: ["geocode", "geocoder", "locate"],
    },
    source: {
      type: "rest",
      endpoint: "https://nominatim.openstreetmap.org/search",
    },
    template: {
      type: "places",
      capabilities: {},
    },
    fields: {},
    time: { type: "static" },
    recovery: [],
    storage: {
      storeResults: false,
      tableName: "query_results",
      prismaModel: "queryResult",
      extrasStrategy: "discard",
    },
    visualisation: { default: "table", rules: [] },
  } satisfies DomainConfigV2,

  async fetchData(_plan: unknown, locationArg: string): Promise<unknown[]> {
    const location =
      locationArg ||
      ((_plan as Record<string, unknown>)?.location as string) ||
      "";
    if (!location) return [];
    try {
      const result = await geocodeToCoordinates(location, prisma);
      return [result];
    } catch {
      return [];
    }
  },

  flattenRow(row: unknown): Record<string, unknown> {
    const r = row as {
      lat: number;
      lon: number;
      display_name: string;
      country_code: string;
    };
    return {
      lat: r.lat,
      lon: r.lon,
      description: r.display_name,
      location: r.display_name,
      category: r.country_code,
    };
  },

  async storeResults(): Promise<void> {},
};
