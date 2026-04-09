/**
 * hunting-zones-gb/index.ts — Phase D.10
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
 */

import type { DomainAdapter } from "../registry";
import { fetchHuntingZones, type HuntingZoneRow } from "./fetcher";

export const huntingZonesGbAdapter: DomainAdapter = {
  config: {
    name:          "hunting-zones-gb",
    tableName:     "query_results",
    prismaModel:   "queryResult",
    countries:     ["GB"],
    intents:       ["hunting zones", "shooting zones", "game management areas"],
    apiUrl:        "https://environment.data.gov.uk/arcgis/rest/services/NE/CRoW_Open_Access_Land/FeatureServer/0/query",
    apiKeyEnv:     null,
    locationStyle: "polygon",
    params:        {},
    flattenRow:    {
      name:        "description",
      county:      "location",
      lat:         "lat",
      lon:         "lon",
      area_ha:     "value",
      access_type: "category",
    },
    categoryMap:   {},
    vizHintRules:  { defaultHint: "map", multiMonthHint: "map" },
    cacheTtlHours: 168,   // 1 week — land designations change slowly
    storeResults:  true,
  },

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

    const flat = rows.map((r) => this.flattenRow(r));
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
