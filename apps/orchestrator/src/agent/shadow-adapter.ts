import { DomainConfig, FallbackInfo } from "@dredge/schemas";
import {
  searchAlternativeSources,
  sampleAndDetectFormat,
} from "./workflows/shadow-recovery";

export interface ShadowContext {
  intent: string;
  location: string;
  country_code: string;
  date_range: string;
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

export function isValidShapeForDomain(
  config: DomainConfig,
  rows: unknown[],
): boolean {
  if (rows.length === 0) return false;
  const rule = DOMAIN_SHAPE_RULES[config.name];
  if (!rule) return true;
  return rule(rows[0] as Record<string, unknown>);
}

// Known generic/national source hostnames that carry no location signal.
// These should never be rejected on geography grounds.
const NATIONAL_SOURCE_HOSTS = [
  "environment.data.gov.uk",
  "data.police.uk",
  "data.gov.uk",
  "api.open-meteo.com",
  "archive-api.open-meteo.com",
];

export function isGeographicallyRelevant(
  location: string,
  candidate: { url: string; description: string },
): boolean {
  // National sources have no location signal — always accept
  try {
    const host = new URL(candidate.url).hostname;
    if (
      NATIONAL_SOURCE_HOSTS.some((h) => host === h || host.endsWith(`.${h}`))
    ) {
      return true;
    }
  } catch {
    // malformed URL — fall through to token check
  }

  // Tokenise the location into meaningful words (drop short connector words)
  const tokens = location
    .toLowerCase()
    .split(/[\s,]+/)
    .filter((t) => t.length > 2);

  const haystack = (candidate.url + " " + candidate.description).toLowerCase();

  // If any location token appears in the URL or description — accept
  if (tokens.some((t) => haystack.includes(t))) return true;

  // No location signal found in either direction — only reject if the
  // description explicitly names a different place (i.e. contains a long
  // word that looks like a place name but none of our tokens matched).
  // Simple heuristic: if haystack has no overlap with our tokens AND
  // the candidate URL hostname is location-specific (not national), reject.
  return false;
}

export const shadowAdapter = {
  isEnabled(): boolean {
    return process.env.SHADOW_ADAPTER_ENABLED === "true";
  },

  async recover(
    config: DomainConfig,
    context: ShadowContext,
    _prisma: unknown,
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

      // Geography check before sampling — avoids wasting a fetch
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

      const sampled = await sampleAndDetectFormat(top.url);

      if (!sampled || sampled.rows.length === 0) return null;

      if (!isValidShapeForDomain(config, sampled.rows)) {
        console.log(
          JSON.stringify({
            event: "shadow_adapter_shape_rejected",
            url: top.url,
            domain: config.name,
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
        data: sampled.rows,
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
