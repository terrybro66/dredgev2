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
      // Step 1 — find candidate sources
      const candidates = await searchAlternativeSources(
        context.intent,
        context.location,
        context.country_code,
        context.date_range,
      );

      if (candidates.length === 0) return null;

      // Step 2 — sample the most confident candidate
      const top = candidates.sort((a, b) => b.confidence - a.confidence)[0];
      const sampled = await sampleAndDetectFormat(top.url);

      if (!sampled || sampled.rows.length === 0) return null;

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
