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

export const refreshScheduler = {
  isEnabled(): boolean {
    return process.env.REFRESH_SCHEDULER_ENABLED === "true";
  },

  scheduleRefresh(adapter: DomainAdapter, prisma: unknown): void {
    if (!this.isEnabled()) return;

    const sources = adapter.config.sources ?? [];

    for (const source of sources) {
      const expr = CRON_BY_POLICY[source.refreshPolicy ?? ""];
      if (!expr) continue; // static / realtime / unknown — skip

      cronSchedule(expr, async () => {
        console.log(
          JSON.stringify({
            event: "refresh_triggered",
            domain: adapter.config.name,
            url: source.url,
            policy: source.refreshPolicy,
          }),
        );
        await this.runRefresh(adapter, prisma);
      });

      console.log(
        JSON.stringify({
          event: "refresh_scheduled",
          domain: adapter.config.name,
          url: source.url,
          policy: source.refreshPolicy,
          cron: expr,
        }),
      );
    }
  },

  async runRefresh(adapter: DomainAdapter, prisma: any): Promise<void> {
    if (!this.isEnabled()) return;

    const rows = await adapter.fetchData({} as any, "");

    const sourceSet =
      adapter.config.sources && adapter.config.sources.length > 0
        ? adapter.config.sources.map((s) => s.url)
        : [adapter.config.apiUrl as string];

    await createSnapshot({
      queryId: `refresh:${adapter.config.name}:${Date.now()}`,
      sourceSet,
      schemaVersion: "1.0",
      rows,
      prisma,
    });
  },
};
