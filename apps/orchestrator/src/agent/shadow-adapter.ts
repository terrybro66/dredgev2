import { DomainConfig, FallbackInfo } from "@dredge/schemas";

// ── Types ─────────────────────────────────────────────────────────────────────

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

// ── ShadowAdapter ─────────────────────────────────────────────────────────────

export const shadowAdapter = {
  isEnabled(): boolean {
    return process.env.SHADOW_ADAPTER_ENABLED === "true";
  },

  async recover(
    _config: DomainConfig,
    _context: ShadowContext,
    _prisma: unknown,
  ): Promise<ShadowResult | null> {
    // Phase 7b stub — real implementation wires in Mastra + Stagehand
    // Returns null until the agent workflow is connected
    return null;
  },
};
