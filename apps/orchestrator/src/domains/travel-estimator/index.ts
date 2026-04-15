/**
 * domains/travel-estimator/index.ts — Phase E.3
 *
 * Travel-time estimator — Haversine distances + mode speed.
 * No external API required. Suitable for planning purposes (±20%).
 *
 * Input (from plan / resolved inputs):
 *   plan.lat, plan.lon          — origin coordinates
 *   plan.transport_mode         — walking | cycling | driving | public_transport
 *   plan.waypoints              — array of { lat, lon, description?, name? }
 *   plan.time_budget_minutes    — optional; if set, filter to reachable waypoints
 *
 * Output: one row per waypoint with travel_time_minutes and distance_km.
 */

import type { DomainConfigV2 } from "@dredge/schemas";
import type { DomainAdapter } from "../registry";

// ── Haversine ─────────────────────────────────────────────────────────────────

function haversineKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ── Speed table (km/h) ────────────────────────────────────────────────────────

const SPEED_KMH: Record<string, number> = {
  walking: 5,
  cycling: 15,
  driving: 70,
  public_transport: 45,
};

// ── Adapter ───────────────────────────────────────────────────────────────────

export const travelEstimatorAdapter: DomainAdapter = {
  config: {
    identity: {
      name: "travel-estimator",
      displayName: "Travel Estimator",
      description: "Haversine travel time estimates between origin and waypoints",
      countries: [],
      intents: ["travel time", "travel estimator", "journey time"],
    },
    source: {
      // "internal:haversine" is an intentional marker — no real HTTP call is made.
      type: "rest",
      endpoint: "internal:haversine",
    },
    template: {
      type: "listings",
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

  async fetchData(plan: unknown): Promise<unknown[]> {
    const p = plan as Record<string, unknown>;
    const originLat = Number(p.lat ?? p.origin_lat ?? 0);
    const originLon = Number(p.lon ?? p.origin_lon ?? 0);
    const mode = String(p.transport_mode ?? "driving");
    const speed = SPEED_KMH[mode] ?? 70;
    const budget =
      p.time_budget_minutes != null ? Number(p.time_budget_minutes) : undefined;

    const waypoints = Array.isArray(p.waypoints) ? p.waypoints : [];
    if (waypoints.length === 0 || originLat === 0) return [];

    return waypoints
      .map((wp: Record<string, unknown>) => {
        const wpLat = Number(wp.lat ?? 0);
        const wpLon = Number(wp.lon ?? 0);
        if (!wpLat || !wpLon) return null;

        const dist = haversineKm(originLat, originLon, wpLat, wpLon);
        const travelMins = Math.round((dist / speed) * 60);

        return {
          name: wp.description ?? wp.name ?? "Zone",
          lat: wpLat,
          lon: wpLon,
          distance_km: Math.round(dist * 10) / 10,
          travel_time_minutes: travelMins,
          transport_mode: mode,
        };
      })
      .filter((r): r is Record<string, unknown> => {
        if (r === null) return false;
        if (budget !== undefined) {
          return (r.travel_time_minutes as number) <= budget;
        }
        return true;
      })
      .sort(
        (a, b) =>
          (a.travel_time_minutes as number) - (b.travel_time_minutes as number),
      );
  },

  flattenRow(row: unknown): Record<string, unknown> {
    return row as Record<string, unknown>;
  },

  async storeResults(): Promise<void> {},
};
