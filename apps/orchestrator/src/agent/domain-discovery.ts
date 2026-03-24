import {
  discoverSources,
  sampleSource,
  proposeDomainConfig,
} from "./workflows/domain-discovery-workflow";

export interface DiscoveryContext {
  intent: string;
  country_code: string;
}

export interface DiscoveryResult {
  domainName: string;
  config: unknown;
}

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

      console.log(
        JSON.stringify({
          event: "domain_discovery_started",
          intent: context.intent,
          country_code: context.country_code,
          id: record.id,
        }),
      );

      // Step 1 — discover candidate sources
      const candidates = await discoverSources(
        context.intent,
        context.country_code,
      );

      if (candidates.length === 0) {
        await prisma.domainDiscovery.update({
          where: { id: record.id },
          data: { status: "requires_review", completedAt: new Date() },
        });
        return null;
      }

      // Step 2 — sample the most confident candidate
      const top = candidates.sort((a, b) => b.confidence - a.confidence)[0];
      const sampled = await sampleSource(top.url);

      if (!sampled) {
        console.log(
          JSON.stringify({ event: "discovery_sample_failed", url: top.url }),
        );
        await prisma.domainDiscovery.update({
          where: { id: record.id },
          data: { status: "requires_review", completedAt: new Date() },
        });
        return null;
      }

      // Step 3 — propose domain config
      const proposed = await proposeDomainConfig(
        context.intent,
        context.country_code,
        top,
        sampled.rows,
      );

      if (!proposed) {
        console.log(
          JSON.stringify({ event: "discovery_propose_failed", url: top.url }),
        );

        await prisma.domainDiscovery.update({
          where: { id: record.id },
          data: { status: "requires_review", completedAt: new Date() },
        });
        return null;
      }

      // Store for human review — never auto-register
      await prisma.domainDiscovery.update({
        where: { id: record.id },
        data: {
          status: "requires_review",
          proposed_config: proposed as any,
          sample_rows: sampled.rows as any,
          confidence: proposed.confidence,
          store_results: proposed.storeResults,
          refresh_policy: proposed.refreshPolicy,
          ephemeral_rationale: proposed.ephemeralRationale,
          completedAt: new Date(),
        },
      });

      console.log(
        JSON.stringify({
          event: "domain_discovery_complete",
          id: record.id,
          proposed_name: proposed.name,
          confidence: proposed.confidence,
          store_results: proposed.storeResults,
          refresh_policy: proposed.refreshPolicy,
        }),
      );

      return null; // Always null — registration requires human approval via approve()
    } catch (err: any) {
      console.error(
        JSON.stringify({
          event: "domain_discovery_error",
          intent: context.intent,
          country_code: context.country_code,
          error: err.message,
        }),
      );
      if (record) {
        await prisma.domainDiscovery.update({
          where: { id: record.id },
          data: {
            status: "error",
            error_message: err.message,
            completedAt: new Date(),
          },
        });
      }
      return null;
    }
  },

  async approve(id: string, prisma: any): Promise<boolean> {
    const record = await prisma.domainDiscovery.findUnique({ where: { id } });
    if (!record) return false;
    if (record.status !== "requires_review") return false;

    await prisma.domainDiscovery.update({
      where: { id },
      data: { approved: true, status: "approved" },
    });

    return true;
  },
};
