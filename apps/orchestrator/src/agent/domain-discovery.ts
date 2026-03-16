// ── Types ─────────────────────────────────────────────────────────────────────

export interface DiscoveryContext {
  intent: string;
  country_code: string;
}

export interface DiscoveryResult {
  domainName: string;
  config: unknown;
}

// ── DomainDiscovery pipeline ──────────────────────────────────────────────────

export const domainDiscovery = {
  isEnabled(): boolean {
    return process.env.DOMAIN_DISCOVERY_ENABLED === "true";
  },

  async run(
    context: DiscoveryContext,
    prisma: any,
  ): Promise<DiscoveryResult | null> {
    if (!this.isEnabled()) return null;

    let record: { id: string } | null = null;

    try {
      record = await prisma.domainDiscovery.create({
        data: {
          intent: context.intent,
          country_code: context.country_code,
          status: "pending",
        },
      });
      if (!record) return null;

      // Phase 8 stub — real implementation wires in Mastra + Stagehand
      // Steps: discover → sample → analyse → (human review) → register
      // Always returns null here — registration only happens after approve()

      await prisma.domainDiscovery.update({
        where: { id: record.id },
        data: {
          status: "requires_review",
          proposed_config: null,
          sample_rows: null,
          confidence: null,
          completedAt: new Date(),
        },
      });

      return null;
    } catch (err: any) {
      console.error(
        JSON.stringify({
          event: "domain_discovery_error",
          intent: context.intent,
          country_code: context.country_code,
          error: err.message,
        }),
      );
      return null;
    }
  },

  async approve(id: string, prisma: any): Promise<boolean> {
    const record = await prisma.domainDiscovery.findUnique({ where: { id } });

    if (!record) return false;
    if (record.status !== "requires_review") return false;

    await prisma.domainDiscovery.update({
      where: { id },
      data: {
        approved: true,
        status: "approved",
      },
    });

    return true;
  },
};
