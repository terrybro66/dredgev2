import {
  discoverSources,
  sampleSource,
  proposeDomainConfig,
} from "./workflows/domain-discovery-workflow";
import { shouldAutoApprove, autoApprovalReason } from "./auto-approval";
import { registerDiscoveredDomain } from "./registration";
import { sendTelegramMessage } from "../notify";

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

      // Shared helper — mark requires_review and notify admin
      const requiresReview = async (reason: string, url?: string) => {
        await prisma.domainDiscovery.update({
          where: { id: record!.id },
          data: { status: "requires_review", completedAt: new Date() },
        });
        await sendTelegramMessage(
          `🔍 *Domain review required*\n\n` +
            `Intent: \`${context.intent}\` (${context.country_code})\n` +
            `ID: \`${record!.id}\`\n` +
            `Reason: ${reason}` +
            (url ? `\nSource: ${url}` : ""),
        );
      };

      // Step 1 — discover candidate sources
      const candidates = await discoverSources(
        context.intent,
        context.country_code,
      );

      if (candidates.length === 0) {
        await requiresReview("No candidate sources found");
        return null;
      }

      // Step 2 — sample the most confident candidate
      const top = candidates.sort((a, b) => b.confidence - a.confidence)[0];
      const sampled = await sampleSource(top.url);

      if (!sampled) {
        console.log(
          JSON.stringify({ event: "discovery_sample_failed", url: top.url }),
        );
        await requiresReview("Could not sample source — may need manual config", top.url);
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
        await requiresReview("LLM failed to propose config", top.url);
        return null;
      }

      // Step 4 — check auto-approval criteria
      const autoApprove = shouldAutoApprove({
        confidence: proposed.confidence,
        providerType: proposed.providerType,
        apiUrl: top.url,
      });

      const reason = autoApprovalReason({
        confidence: proposed.confidence,
        providerType: proposed.providerType,
        apiUrl: top.url,
      });

      if (autoApprove) {
        try {
          await registerDiscoveredDomain({
            discoveryId: record.id,
            proposedConfig: proposed as any,
            prisma,
          });

          await prisma.domainDiscovery.update({
            where: { id: record.id },
            data: {
              status: "registered",
              approved: true,
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
              event: "domain_auto_approved",
              id: record.id,
              proposed_name: proposed.name,
              confidence: proposed.confidence,
              reason,
            }),
          );

          return null;
        } catch (err: any) {
          console.warn(
            JSON.stringify({
              event: "domain_auto_approval_failed",
              id: record.id,
              error: err.message,
            }),
          );
          // Fall through to requires_review on auto-approval failure
        }
      }

      // Store for human review
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
          auto_approve_reason: reason,
        }),
      );

      await sendTelegramMessage(
        `🔍 *Domain review required*\n\n` +
          `Intent: \`${context.intent}\` (${context.country_code})\n` +
          `ID: \`${record.id}\`\n` +
          `Proposed: \`${proposed.name}\`\n` +
          `Confidence: ${proposed.confidence.toFixed(2)}\n` +
          `Source: ${top.url}\n` +
          `Store results: ${proposed.storeResults}\n\n` +
          `curl -X POST http://localhost:3001/admin/discovery/${record.id}/approve \\\n` +
          `  -H "Authorization: Bearer $ADMIN_API_KEY" \\\n` +
          `  -H "Content-Type: application/json" -d '{}'`,
      );

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
