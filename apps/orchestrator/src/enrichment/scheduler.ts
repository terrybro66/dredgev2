import { schedule as cronSchedule } from "node-cron";
import { DomainAdapter } from "../domains/registry";
import { createSnapshot } from "../execution-model";

// Cron expressions per refresh policy.
// "realtime" and "static" sources are never scheduled — callers must filter
// these out before calling scheduleRefresh, but the map is intentionally
// absent for those values so any accidental lookup returns undefined.
const CRON_BY_POLICY: Record<string, string> = {
  daily: "0 3 * * *", // 03:00 every day
  weekly: "0 3 * * 0", // 03:00 every Sunday
};

// Derive source URL from DomainConfigV2 — overpass has no endpoint.
function getAdapterSourceUrl(adapter: DomainAdapter): string {
  const source = adapter.config.source;
  if (source.type === "overpass") return "https://overpass-api.de/api/interpreter";
  return (source as { endpoint: string }).endpoint ?? "";
}

export const refreshScheduler = {
  isEnabled(): boolean {
    return process.env.REFRESH_SCHEDULER_ENABLED === "true";
  },

  scheduleRefresh(adapter: DomainAdapter, prisma: unknown): void {
    if (!this.isEnabled()) return;

    // DomainConfigV2 has a single source, not an array.
    // Derive refresh policy from the cache TTL: no cache → realtime, otherwise weekly.
    const domainName = adapter.config.identity.name;
    const refreshPolicy = adapter.config.cache ? "weekly" : "realtime";
    const expr = CRON_BY_POLICY[refreshPolicy];
    if (!expr) return; // static / realtime / unknown — skip

    const sourceUrl = getAdapterSourceUrl(adapter);

    cronSchedule(expr, async () => {
      console.log(
        JSON.stringify({
          event: "refresh_triggered",
          domain: domainName,
          url: sourceUrl,
          policy: refreshPolicy,
        }),
      );
      await this.runRefresh(adapter, prisma);
    });

    console.log(
      JSON.stringify({
        event: "refresh_scheduled",
        domain: domainName,
        url: sourceUrl,
        policy: refreshPolicy,
        cron: expr,
      }),
    );
  },

  async runRefresh(adapter: DomainAdapter, prisma: any): Promise<void> {
    if (!this.isEnabled()) return;

    const rows = await adapter.fetchData({} as any, "");
    const domainName = adapter.config.identity.name;
    const sourceUrl = getAdapterSourceUrl(adapter);

    await createSnapshot({
      queryId: `refresh:${domainName}:${Date.now()}`,
      sourceSet: [sourceUrl],
      schemaVersion: "1.0",
      rows,
      prisma,
    });
  },
};
