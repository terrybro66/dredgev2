import { DomainConfigV2, FallbackInfo } from "@dredge/schemas";
import {
  searchAlternativeSources,
  sampleAndDetectFormat,
} from "./workflows/shadow-recovery";

export interface ShadowContext {
  intent: string;
  location: string;
  country_code: string;
  date_range: string;
  queryPoint?: { lat: number; lon: number } | null;
}

export interface ShadowNewSource {
  sourceUrl: string;
  providerType: string;
  confidence: number;
}

export interface ShadowResult {
  data: unknown[];
  fallback: FallbackInfo;
  newSource: ShadowNewSource;
}

export interface Coverage {
  type: "national" | "regional" | "local" | "unknown";
  region?: string | null;
  locationPolygon?: { type: "Polygon"; coordinates: number[][][] } | null;
}

export interface CandidateWithCoverage {
  url: string;
  description: string;
  coverage?: Coverage | null;
}

const DOMAIN_SHAPE_RULES: Record<
  string,
  (row: Record<string, unknown>) => boolean
> = {
  "crime-uk": (row) => {
    const hasCategory = "category" in row || "type" in row || "offence" in row;
    const hasDate = "month" in row || "date" in row;
    return hasCategory && hasDate;
  },
};

export function applyFieldMap(
  rows: unknown[],
  fieldMap: Record<string, string>,
): unknown[] {
  if (Object.keys(fieldMap).length === 0) return rows;
  return rows.map((row) => {
    if (row == null) return row;
    const r = row as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(r)) {
      const mapped = fieldMap[key];
      out[mapped ?? key] = value;
    }
    return out;
  });
}

export function isValidShapeForDomain(
  config: DomainConfigV2,
  rows: unknown[],
): boolean {
  if (rows.length === 0) return false;
  const rule = DOMAIN_SHAPE_RULES[config.identity.name];
  if (!rule) return true;
  return rule(rows[0] as Record<string, unknown>);
}

export async function checkPointInPolygon(
  point: { lat: number; lon: number },
  polygon: { type: "Polygon"; coordinates: number[][][] },
  prisma: any,
): Promise<boolean> {
  try {
    const result = await prisma.$queryRaw<{ contains: boolean }[]>`
      SELECT ST_Contains(
        ST_GeomFromGeoJSON(${JSON.stringify(polygon)}),
        ST_SetSRID(ST_MakePoint(${point.lon}, ${point.lat}), 4326)
      ) AS contains
    `;
    return result[0]?.contains === true;
  } catch {
    return false;
  }
}

const NATIONAL_SOURCE_HOSTS = [
  "environment.data.gov.uk",
  "data.police.uk",
  "data.gov.uk",
  "api.open-meteo.com",
  "archive-api.open-meteo.com",
];

export function isGeographicallyRelevant(
  location: string,
  candidate: CandidateWithCoverage,
): boolean {
  const coverage = candidate.coverage;

  // national: always accept
  if (coverage?.type === "national") return true;

  // regional: bidirectional token match between location and region name
  if (coverage?.type === "regional" && coverage.region) {
    const locationTokens = location
      .toLowerCase()
      .split(/[\s,]+/)
      .filter((t) => t.length > 2);
    const regionTokens = coverage.region
      .toLowerCase()
      .split(/[\s,]+/)
      .filter((t) => t.length > 2);
    const locationInRegion = locationTokens.some((t) =>
      coverage.region!.toLowerCase().includes(t),
    );
    const regionInLocation = regionTokens.some((t) =>
      location.toLowerCase().includes(t),
    );
    if (locationInRegion || regionInLocation) return true;
    // no token overlap — fall through to token matching on URL/description
  }

  // local with polygon but no prisma: fall through to token matching
  // (checkPointInPolygon is called separately in recover() when prisma is available)

  // known national hosts: always accept
  try {
    const host = new URL(candidate.url).hostname;
    if (
      NATIONAL_SOURCE_HOSTS.some((h) => host === h || host.endsWith(`.${h}`))
    ) {
      return true;
    }
  } catch {
    // malformed URL — fall through
  }

  // token matching on URL + description
  const tokens = location
    .toLowerCase()
    .split(/[\s,]+/)
    .filter((t) => t.length > 2);
  const haystack = (candidate.url + " " + candidate.description).toLowerCase();
  return tokens.some((t) => haystack.includes(t));
}

export const shadowAdapter = {
  isEnabled(): boolean {
    return process.env.SHADOW_ADAPTER_ENABLED === "true";
  },

  async recover(
    config: DomainConfigV2,
    context: ShadowContext,
    prisma: any,
  ): Promise<ShadowResult | null> {
    if (!this.isEnabled()) return null;

    console.log(
      JSON.stringify({
        event: "shadow_adapter_searching",
        intent: context.intent,
        location: context.location,
      }),
    );

    try {
      const candidates = await searchAlternativeSources(
        context.intent,
        context.location,
        context.country_code,
        context.date_range,
      );

      if (candidates.length === 0) return null;

      const top = candidates.sort((a, b) => b.confidence - a.confidence)[0];

      // Stage 1: sync geography check (national / regional / token matching)
      if (!isGeographicallyRelevant(context.location, top)) {
        console.log(
          JSON.stringify({
            event: "shadow_adapter_geography_rejected",
            url: top.url,
            location: context.location,
          }),
        );
        return null;
      }

      // Stage 2: PostGIS point-in-polygon for local sources with a polygon
      const topCoverage = (top as any).coverage as Coverage | null | undefined;
      if (
        topCoverage?.type === "local" &&
        topCoverage.locationPolygon &&
        context.queryPoint
      ) {
        const inside = await checkPointInPolygon(
          context.queryPoint,
          topCoverage.locationPolygon,
          prisma,
        );
        if (!inside) {
          console.log(
            JSON.stringify({
              event: "shadow_adapter_polygon_rejected",
              url: top.url,
              location: context.location,
            }),
          );
          return null;
        }
      }

      const sampled = await sampleAndDetectFormat(top.url);
      if (!sampled || sampled.rows.length === 0) return null;

      const fieldMap: Record<string, string> = (top as any).fieldMap ?? {};
      const mappedRows = applyFieldMap(sampled.rows, fieldMap);

      if (!isValidShapeForDomain(config, mappedRows)) {
        console.log(
          JSON.stringify({
            event: "shadow_adapter_shape_rejected",
            url: top.url,
            domain: config.identity.name,
          }),
        );
        return null;
      }

      console.log(
        JSON.stringify({
          event: "shadow_adapter_found",
          url: top.url,
          format: sampled.format,
          rows: sampled.sampleSize,
        }),
      );

      return {
        data: mappedRows,
        fallback: {
          field: "location",
          original: context.location,
          used: context.location,
          explanation: `Primary source returned no data — found alternative source: ${top.description}`,
        },
        newSource: {
          sourceUrl: top.url,
          providerType: sampled.format,
          confidence: top.confidence,
        },
      };
    } catch (err: any) {
      console.error(
        JSON.stringify({
          event: "shadow_adapter_error",
          error: err.message,
        }),
      );
      return null;
    }
  },
};
