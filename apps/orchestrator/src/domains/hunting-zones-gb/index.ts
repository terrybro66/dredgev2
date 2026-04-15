/**
 * hunting-zones-gb/index.ts — Phase 1 migration to DomainConfigV2
 *
 * Track A persistent domain for GB open access / game management land.
 *
 * Intent:  "hunting zones"
 * Source:  Natural England CRoW Open Access Land (ArcGIS REST)
 * Viz:     map (lat/lon present on most rows)
 * Refresh: weekly (land designations change rarely)
 * Countries: GB
 *
 * This domain feeds D.11: the hunting licence → zones → reachable area flow.
 * After the regulatory adapter confirms eligibility, the frontend chips surface
 * "Find zones near me" which resolves to this adapter, then a "How do I get
 * there?" chip triggers the transport / reachable-area workflow.
 *
 * Note: the ArcGIS endpoint is dead (D8) but the config must be valid.
 */

import type { DomainConfigV2 } from "@dredge/schemas";
import type { DomainAdapter } from "../registry";
import { fetchHuntingZones, type HuntingZoneRow } from "./fetcher";

const config: DomainConfigV2 = {
  identity: {
    name: "hunting-zones-gb",
    displayName: "Hunting Zones GB",
    description: "GB open access land and game management areas from Natural England CRoW data",
    countries: ["GB"],
    intents: ["hunting zones", "shooting zones", "game management areas"],
  },
  source: {
    type: "rest",
    endpoint: "https://environment.data.gov.uk/arcgis/rest/services/NE/CRoW_Open_Access_Land/FeatureServer/0/query",
  },
  template: {
    type: "boundaries",
    capabilities: { has_coordinates: true, has_category: true },
  },
  fields: {
    description: { source: "name", type: "string", role: "label" },
    location: { source: "county", type: "string", role: "label" },
    category: { source: "access_type", type: "string", role: "dimension" },
    lat: { source: "lat", type: "number", role: "location_lat" },
    lon: { source: "lon", type: "number", role: "location_lon" },
    value: { source: "area_ha", type: "number", role: "metric" },
  },
  time: { type: "static" },
  recovery: [],
  storage: {
    storeResults: true,
    tableName: "query_results",
    prismaModel: "queryResult",
    extrasStrategy: "retain_unmapped",
  },
  visualisation: { default: "map", rules: [] },
  cache: { ttlHours: 168 },
};

export const huntingZonesGbAdapter: DomainAdapter = {
  config,

  async fetchData(_plan: unknown, poly: string): Promise<unknown[]> {
    return fetchHuntingZones(poly || null);
  },

  flattenRow(row: unknown): Record<string, unknown> {
    const r = row as HuntingZoneRow;
    return {
      description: r.name,
      location:    r.county ?? r.name,
      category:    r.access_type ?? "Open Access Land",
      lat:         r.lat,
      lon:         r.lon,
      value:       r.area_ha,
      extras: {
        area_ha:     r.area_ha,
        access_type: r.access_type,
        source_id:   r.source_id,
        county:      r.county,
      },
    };
  },

  async storeResults(
    queryId: string,
    rows: unknown[],
    prisma: any,
  ): Promise<void> {
    if (rows.length === 0) return;

    const flat = rows.map((r) => huntingZonesGbAdapter.flattenRow(r));
    await prisma.queryResult.createMany({
      data: flat.map((r) => ({
        query_id:    queryId,
        domain:      "hunting-zones-gb",
        description: r.description as string,
        location:    r.location as string,
        category:    r.category as string,
        lat:         r.lat as number | null,
        lon:         r.lon as number | null,
        value:       r.value as number | null,
        extras:      r.extras,
        raw:         {},
      })),
      skipDuplicates: true,
    });
  },
};
